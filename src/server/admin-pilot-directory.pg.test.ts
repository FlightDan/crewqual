// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminPilotDirectorySql } from "@/server/admin-pilot-directory";
import { evaluateStoredQualification } from "@/lib/qualification-date-status";
import { memberQualificationStatus, summarizeMemberQualifications } from "@/lib/member-health";

const url = process.env.DIRECTORY_TEST_DATABASE_URL;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const clock = { now: () => new Date("2026-09-07T12:00:00Z") };
const snapshot = (kind: string) => ({ version: 1, validityRule: { kind } });

describe.skipIf(!url)("PostgreSQL directory/domain contract (temporary tables)", () => {
  let db: Client;
  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query(`
      CREATE TEMP TABLE "OrganizationUnit" (id uuid PRIMARY KEY, "organizationId" uuid);
      CREATE TEMP TABLE "Person" (id uuid PRIMARY KEY, "unitId" uuid, "organizationId" uuid);
      CREATE TEMP TABLE "Pilot" (id uuid PRIMARY KEY, "personId" uuid, "unitId" uuid, "displayName" text, "employeeNumber" text, active boolean);
      CREATE TEMP TABLE "UpgradePlan" ("pilotId" uuid, "lifecycleStatus" text);
      CREATE TEMP TABLE "QualificationDefinition" (id uuid PRIMARY KEY, code text, "legacyQualificationTypeId" uuid, active boolean);
      CREATE TEMP TABLE "QualificationAssignment" ("personId" uuid, "qualificationDefinitionId" uuid, "requirementId" uuid, "positionAssignmentId" uuid, active boolean);
      CREATE TEMP TABLE "QualificationRequirement" (id uuid PRIMARY KEY, "positionId" uuid, required boolean, active boolean);
      CREATE TEMP TABLE "Position" (id uuid PRIMARY KEY, active boolean);
      CREATE TEMP TABLE "PersonPositionAssignment" (id uuid PRIMARY KEY, "positionId" uuid, status text, "effectiveFrom" date, "effectiveTo" date);
      CREATE TEMP TABLE "QualificationType" (id uuid PRIMARY KEY, code text);
      CREATE TEMP TABLE "QualificationRecord" (id uuid PRIMARY KEY, "personId" uuid, "pilotId" uuid, "qualificationDefinitionId" uuid, "qualificationTypeId" uuid, status text, "expiryDate" date, "qualificationRuleSnapshot" jsonb);
      CREATE INDEX ON "QualificationRecord" ("personId", "qualificationDefinitionId", status);
      CREATE INDEX ON "QualificationRecord" ("pilotId", status);
      CREATE INDEX ON "QualificationAssignment" ("personId", active, "qualificationDefinitionId");
    `);
  });
  afterAll(async () => {
    await db?.end();
  });

  async function reset() {
    await db.query(
      `TRUNCATE "OrganizationUnit", "Person", "Pilot", "QualificationDefinition", "QualificationAssignment", "QualificationRequirement", "Position", "PersonPositionAssignment", "QualificationType", "QualificationRecord", "UpgradePlan"`,
    );
    await db.query('INSERT INTO "OrganizationUnit" VALUES ($1, $2), ($3, $2)', [
      id(1),
      id(2),
      id(3),
    ]);
    await db.query('INSERT INTO "QualificationDefinition" VALUES ($1, $2, $3, TRUE)', [
      id(10),
      "CHECK",
      id(11),
    ]);
    await db.query('INSERT INTO "QualificationType" VALUES ($1, $2)', [id(11), "CHECK"]);
  }
  async function person(n: number, assigned = true) {
    await db.query('INSERT INTO "Person" VALUES ($1, $2, $3)', [id(n), id(1), id(2)]);
    await db.query('INSERT INTO "Pilot" VALUES ($1, $2, $3, $4, $5, TRUE)', [
      id(n + 1000),
      id(n),
      id(1),
      "Same",
      String(n),
    ]);
    if (assigned)
      await db.query('INSERT INTO "QualificationAssignment" VALUES ($1, $2, NULL, NULL, TRUE)', [
        id(n),
        id(10),
      ]);
  }
  async function record(
    n: number,
    evidence: unknown,
    expiry: string | null,
    offset = 0,
    canonical = true,
  ) {
    await db.query(
      'INSERT INTO "QualificationRecord" VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
      [
        id(n + 2000 + offset),
        canonical ? id(n) : null,
        id(n + 1000),
        canonical ? id(10) : null,
        id(11),
        "ACTIVE",
        expiry,
        JSON.stringify(evidence),
      ],
    );
  }
  async function projected(
    query = {},
    page = 1,
    pageSize = 100,
    today: string | null = "2026-09-07",
    unitId: string | null = null,
  ) {
    const sql = adminPilotDirectorySql({
      query,
      page,
      pageSize,
      unitId,
      unitDays: [
        { id: id(1), today },
        { id: id(3), today },
      ],
    });
    return (await db.query(sql.text, sql.values)).rows[0] as {
      total: number;
      rows: Array<{ id: string; health: string }>;
    };
  }

  it("matches stored evidence domain decisions, including malformed nested JSON and day boundaries", async () => {
    await reset();
    const cases = [
      { evidence: snapshot("manual_expiry"), expiry: "2026-09-06" },
      { evidence: snapshot("manual_expiry"), expiry: "2026-09-07" },
      { evidence: snapshot("manual_expiry"), expiry: "2026-12-06" },
      { evidence: snapshot("manual_expiry"), expiry: "2026-12-07" },
      { evidence: snapshot("manual_expiry"), expiry: null },
      { evidence: snapshot("non_expiring"), expiry: null },
      { evidence: snapshot("non_expiring"), expiry: "2027-01-01" },
      { evidence: null, expiry: "2027-01-01" },
      { evidence: [], expiry: "2027-01-01" },
      { evidence: { version: "1", validityRule: { kind: "manual_expiry" } }, expiry: "2027-01-01" },
      { evidence: { version: 1.5, validityRule: { kind: "manual_expiry" } }, expiry: "2027-01-01" },
      { evidence: { version: 0, validityRule: { kind: "manual_expiry" } }, expiry: "2027-01-01" },
      {
        evidence: { ...snapshot("manual_expiry"), snapshotSource: "inferred_backfill" },
        expiry: "2027-01-01",
      },
      { evidence: { ...snapshot("manual_expiry"), snapshotSource: null }, expiry: "2027-01-01" },
      {
        evidence: {
          ...snapshot("manual_expiry"),
          snapshotSource: "reviewer_confirmed",
          reminders: "irrelevant",
        },
        expiry: "2027-01-01",
      },
      ...[0, 1, 120, 121, 1.5, "12", {}, null].map((months) => ({
        evidence: {
          version: 1,
          validityRule: { kind: "fixed_months", baseDateField: "issueDate", months },
        },
        expiry: "2027-01-01",
      })),
      { evidence: { version: 1, validityRule: [] }, expiry: "2027-01-01" },
      { evidence: { version: {}, validityRule: { kind: "manual_expiry" } }, expiry: "2027-01-01" },
    ];
    for (const [index, entry] of cases.entries()) {
      await person(index + 100);
      await record(index + 100, entry.evidence, entry.expiry);
    }
    const actual = await projected();
    expect(actual.total).toBe(cases.length);
    for (const [index, entry] of cases.entries()) {
      const status = evaluateStoredQualification(
        { expiryDate: entry.expiry, qualificationRuleSnapshot: entry.evidence },
        clock,
        "UTC",
      ).status;
      const domainHealth = summarizeMemberQualifications([
        { required: true, status: memberQualificationStatus(status) },
      ]).health;
      const expected =
        domainHealth === "valid" ? "normal" : domainHealth === "due" ? "expiring" : domainHealth;
      expect(actual.rows.find((row) => row.id === id(index + 1100))?.health, `case ${index}`).toBe(
        expected,
      );
    }
    const invalidZone = await projected({}, 1, 100, null);
    expect(invalidZone.rows.every((row) => row.health === "incomplete")).toBe(true);
  });

  it("matches JavaScript numeric parsing without throwing for huge JSON numbers", async () => {
    await reset();
    const rawEvidence = [
      '{"version":1.00000000000000001,"validityRule":{"kind":"manual_expiry"}}',
      '{"version":1e999,"validityRule":{"kind":"manual_expiry"}}',
      '{"version":9007199254740991.1,"validityRule":{"kind":"manual_expiry"}}',
      '{"version":9007199254740992,"validityRule":{"kind":"manual_expiry"}}',
      '{"version":1,"validityRule":{"kind":"fixed_months","baseDateField":"trainingDate","months":1.00000000000000001}}',
      '{"version":1,"validityRule":{"kind":"fixed_months","baseDateField":"trainingDate","months":1e999}}',
    ];
    for (const [index, evidence] of rawEvidence.entries()) {
      await person(index + 100);
      await record(index + 100, null, "2027-01-01");
      await db.query(
        'UPDATE "QualificationRecord" SET "qualificationRuleSnapshot" = $1::jsonb WHERE id = $2',
        [evidence, id(index + 2100)],
      );
    }
    const actual = await projected();
    expect(actual.rows.map((row) => row.health)).toEqual(
      rawEvidence.map((evidence) => {
        const state = evaluateStoredQualification(
          { expiryDate: "2027-01-01", qualificationRuleSnapshot: JSON.parse(evidence) },
          clock,
          "UTC",
        );
        return state.status === "valid" ? "normal" : state.status;
      }),
    );
  });

  it("prefers canonical records, flags duplicates, and filters before stable paging/count", async () => {
    await reset();
    await person(100);
    await record(100, snapshot("manual_expiry"), "2026-01-01", 0, false);
    await record(100, snapshot("non_expiring"), null, 100, true);
    await person(101);
    await record(101, snapshot("non_expiring"), null);
    await record(101, snapshot("non_expiring"), null, 100);
    await person(102); // missing
    await person(103, false); // unconfigured
    await person(104);
    await record(104, snapshot("non_expiring"), null, 0, false); // legacy fallback
    expect((await projected()).rows.map((row) => row.health)).toEqual([
      "normal",
      "incomplete",
      "missing",
      "unconfigured",
      "normal",
    ]);
    expect(await projected({ health: "normal" }, 2, 1)).toEqual({
      total: 2,
      rows: [{ id: id(1104), health: "normal" }],
    });
    expect(await projected({ health: "normal" }, 3, 1)).toEqual({ total: 2, rows: [] });
    await db.query('UPDATE "Pilot" SET "unitId" = $1 WHERE id = $2', [id(3), id(1104)]);
    expect((await projected({}, 1, 100, "2026-09-07", id(1))).total).toBe(4);
    expect((await projected({ health: "incomplete" })).rows.map((row) => row.id)).toEqual([
      id(1101),
      id(1104),
    ]);
  });

  it("keeps a 10,000-person health-filtered page at 20 rows and records a query baseline", async () => {
    await reset();
    await db.query(
      `INSERT INTO "Person" SELECT md5('person-' || n)::uuid, $1::uuid, $2::uuid FROM generate_series(1, 10000) n`,
      [id(1), id(2)],
    );
    await db.query(
      `INSERT INTO "Pilot" SELECT md5('pilot-' || n)::uuid, md5('person-' || n)::uuid, $1::uuid, 'Same', n::text, TRUE FROM generate_series(1, 10000) n`,
      [id(1)],
    );
    await db.query(
      `INSERT INTO "QualificationAssignment" SELECT id, $1::uuid, NULL, NULL, TRUE FROM "Person"`,
      [id(10)],
    );
    await db.query(
      `INSERT INTO "QualificationRecord" SELECT md5('record-' || n)::uuid, md5('person-' || n)::uuid, md5('pilot-' || n)::uuid, $1::uuid, $2::uuid, 'ACTIVE', NULL, $3::jsonb FROM generate_series(1, 5000) n`,
      [id(10), id(11), JSON.stringify(snapshot("non_expiring"))],
    );
    await db.query(
      'ANALYZE "Person"; ANALYZE "Pilot"; ANALYZE "QualificationAssignment"; ANALYZE "QualificationRecord"',
    );
    const sql = adminPilotDirectorySql({
      unitId: id(1),
      query: { health: "missing" },
      unitDays: [{ id: id(1), today: "2026-09-07" }],
      page: 100,
      pageSize: 20,
    });
    const result = (await db.query(sql.text, sql.values)).rows[0];
    expect(result.total).toBe(5000);
    expect(result.rows).toHaveLength(20);
    expect(result.rows.every((row: { health: string }) => row.health === "missing")).toBe(true);
    const explanation = (
      await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql.text}`, sql.values)
    ).rows[0]["QUERY PLAN"][0];
    console.info(
      JSON.stringify({
        directoryBaseline: {
          persons: 10000,
          matched: result.total,
          transferredIds: result.rows.length,
          executionMs: explanation["Execution Time"],
          planningMs: explanation["Planning Time"],
        },
      }),
    );
  }, 30000);

  it("applies effective assignments, optional requirements, and required OR on shared definitions", async () => {
    await reset();
    await db.query('INSERT INTO "Position" VALUES ($1, TRUE)', [id(20)]);
    await db.query(
      'INSERT INTO "QualificationRequirement" VALUES ($1, $2, FALSE, TRUE), ($3, $2, TRUE, TRUE)',
      [id(21), id(20), id(22)],
    );
    await db.query('INSERT INTO "PersonPositionAssignment" VALUES ($1, $2, $3, $4, NULL)', [
      id(23),
      id(20),
      "ACTIVE",
      "2026-09-08",
    ]);
    await person(100);
    await person(101);
    await person(102);
    await db.query('UPDATE "QualificationAssignment" SET "requirementId" = $1', [id(21)]);
    await db.query('INSERT INTO "QualificationAssignment" VALUES ($1, $2, $3, NULL, TRUE)', [
      id(101),
      id(10),
      id(22),
    ]);
    await db.query(
      'UPDATE "QualificationAssignment" SET "positionAssignmentId" = $1 WHERE "personId" = $2',
      [id(23), id(102)],
    );
    expect((await projected()).rows.map((row) => row.health)).toEqual([
      "normal",
      "missing",
      "unconfigured",
    ]);
    expect((await projected({}, 1, 100, "2026-09-08")).rows.map((row) => row.health)).toEqual([
      "normal",
      "missing",
      "normal",
    ]);
  });
});
