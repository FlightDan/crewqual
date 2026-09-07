// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// This tests only the identity migration helper, never the whole database scan.
const url = process.env.MIGRATION_TEST_DATABASE_URL;
const organizationIds = [randomUUID(), randomUUID()];
const unitIds = [randomUUID(), randomUUID()];
const pilotIds: string[] = [];
const personIds: string[] = [];

describe.skipIf(!url)("canonical identity migration on PostgreSQL", () => {
  let db: PrismaClient;
  let ensureMigrationPerson: typeof import("../../scripts/migrate-member-architecture").ensureMigrationPerson;
  beforeAll(async () => {
    // The script's top-level client is lazy; the helper receives our transaction.
    process.env.DIRECT_URL ??= url;
    ({ ensureMigrationPerson } = await import("../../scripts/migrate-member-architecture"));
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url, max: 2 }),
    });
    for (const [index, id] of organizationIds.entries()) {
      await db.organization.create({
        data: { id, code: `migration-${id}`, name: "Migration fixture" },
      });
      await db.organizationUnit.create({
        data: {
          id: unitIds[index]!,
          organizationId: id,
          code: `migration-${unitIds[index]}`,
          name: "Migration fixture",
        },
      });
    }
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.$transaction(async (tx) => {
        await tx.pilotProfile.deleteMany({ where: { personId: { in: personIds } } });
        await tx.pilot.deleteMany({ where: { id: { in: pilotIds } } });
        await tx.person.deleteMany({ where: { id: { in: personIds } } });
        await tx.organizationUnit.deleteMany({ where: { id: { in: unitIds } } });
        await tx.organization.deleteMany({ where: { id: { in: organizationIds } } });
      });
    } finally {
      await db.$disconnect();
    }
  });
  async function fixture(linked: boolean, personOrganizationIndex = 0) {
    const pilotId = randomUUID();
    const personId = randomUUID();
    pilotIds.push(pilotId);
    personIds.push(personId);
    const employeeNumber = `migration-${pilotId}`;
    const person = await db.person.create({
      data: {
        id: personId,
        organizationId: organizationIds[personOrganizationIndex]!,
        unitId: unitIds[personOrganizationIndex]!,
        employeeNumber,
        mobile: "canonical-mobile",
        displayName: "Canonical name",
        initials: "CN",
        version: 9,
        active: false,
      },
    });
    const pilot = await db.pilot.create({
      data: {
        id: pilotId,
        personId: linked ? personId : null,
        unitId: unitIds[0]!,
        employeeNumber,
        mobile: "legacy-mobile",
        displayName: "Legacy name",
        initials: "LN",
        roleCode: "CAPTAIN",
        aircraftType: "A320",
        rankLabel: "CAPTAIN",
        version: 2,
      },
    });
    return { pilot, person };
  }
  it("reruns against a different canonical Person ID without P2002 or changing canonical data", async () => {
    const { pilot, person } = await fixture(true);
    for (let run = 0; run < 2; run += 1) {
      const migrated = await db.$transaction((tx) =>
        ensureMigrationPerson(tx, pilot, organizationIds[0]!),
      );
      expect(migrated.id).toBe(person.id);
    }
    expect(await db.person.findUnique({ where: { id: person.id } })).toEqual(person);
    expect(await db.person.findUnique({ where: { id: pilot.id } })).toBeNull();
    expect(await db.pilot.findUnique({ where: { id: pilot.id } })).toMatchObject({
      personId: person.id,
    });
  });
  it("rejects a version changed after the outside-transaction pilot snapshot", async () => {
    const { pilot, person } = await fixture(true);
    await db.pilot.update({
      where: { id: pilot.id },
      data: { aircraftType: "B787", version: { increment: 1 } },
    });
    await expect(
      db.$transaction((tx) => ensureMigrationPerson(tx, pilot, organizationIds[0]!)),
    ).rejects.toThrow("pilot snapshot changed during migration");
    expect(await db.person.findUnique({ where: { id: person.id } })).toEqual(person);
    expect(await db.pilot.findUnique({ where: { id: pilot.id } })).toMatchObject({
      aircraftType: "B787",
      version: 3,
    });
  });
  it("holds the Pilot lock through projection writes and serializes concurrent edits", async () => {
    const { pilot, person } = await fixture(true);
    await db.pilotProfile.create({
      data: {
        personId: person.id,
        legacyPilotId: pilot.id,
        aircraftType: pilot.aircraftType,
        dutyCode: pilot.roleCode,
        rankLabel: pilot.rankLabel,
      },
    });
    let unlock!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const releaseTimeout = setTimeout(() => unlock(), 3000);
    const migration = db.$transaction(async (tx) => {
      await ensureMigrationPerson(tx, pilot, organizationIds[0]!);
      acquired();
      await held;
      // This mirrors the later migration projection, still using its original
      // snapshot. The lock must last through this write and outer commit.
      await tx.pilotProfile.update({
        where: { personId: person.id },
        data: { aircraftType: pilot.aircraftType },
      });
    });
    try {
      await Promise.race([locked, migration]);
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '150ms'`;
          await tx.pilot.update({
            where: { id: pilot.id },
            data: { aircraftType: "B787", version: { increment: 1 } },
          });
          await tx.person.update({ where: { id: person.id }, data: { version: { increment: 1 } } });
          await tx.pilotProfile.update({
            where: { personId: person.id },
            data: { aircraftType: "B787" },
          });
        }),
      ).rejects.toThrow(/lock timeout/);
      expect(await db.pilot.findUnique({ where: { id: pilot.id } })).toMatchObject({
        aircraftType: "A320",
        version: 2,
      });
      expect(await db.person.findUnique({ where: { id: person.id } })).toMatchObject({
        version: 9,
      });
    } finally {
      clearTimeout(releaseTimeout);
      unlock();
      await migration;
    }
    await db.$transaction(async (tx) => {
      await tx.pilot.update({
        where: { id: pilot.id },
        data: { aircraftType: "B787", version: { increment: 1 } },
      });
      await tx.person.update({ where: { id: person.id }, data: { version: { increment: 1 } } });
      await tx.pilotProfile.update({
        where: { personId: person.id },
        data: { aircraftType: "B787" },
      });
    });
    expect(await db.pilotProfile.findUnique({ where: { personId: person.id } })).toMatchObject({
      aircraftType: "B787",
    });
  });
  it("rejects an unlinked employee-number collision without binding the unrelated Person", async () => {
    const { pilot, person } = await fixture(false);
    await expect(
      db.$transaction((tx) => ensureMigrationPerson(tx, pilot, organizationIds[0]!)),
    ).rejects.toThrow("employee number belongs to a different canonical identity");
    expect(await db.person.findUnique({ where: { id: person.id } })).toEqual(person);
    expect(await db.person.findUnique({ where: { id: pilot.id } })).toBeNull();
    expect(await db.pilot.findUnique({ where: { id: pilot.id } })).toMatchObject({
      personId: null,
    });
  });
  it("fails closed for a linked canonical person in another organization", async () => {
    const { pilot, person } = await fixture(true, 1);
    await expect(
      db.$transaction((tx) => ensureMigrationPerson(tx, pilot, organizationIds[0]!)),
    ).rejects.toThrow("canonical organization differs");
    expect(await db.person.findUnique({ where: { id: person.id } })).toEqual(person);
    expect(await db.pilot.findUnique({ where: { id: pilot.id } })).toMatchObject({
      personId: person.id,
    });
  });
});
