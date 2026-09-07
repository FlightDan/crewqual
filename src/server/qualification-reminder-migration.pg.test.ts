// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const connectionString = process.env.CREWQUAL_AUDIT_TEST_DATABASE_URL;
const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260907010000_qualification_reminder_today/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

async function withTemporaryTables(run: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // No public fallback: migration SQL can only resolve these session-local
    // tables. LIKE copies actual column types/defaults/indexes, but no FK or
    // trigger capable of writing shared tables. Closing the session drops them.
    await client.query("SET search_path = pg_temp, pg_catalog");
    await client.query(
      'CREATE TEMP TABLE "NotificationDelivery" (LIKE public."NotificationDelivery" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)',
    );
    await client.query(
      'CREATE TEMP TABLE "AuditEvent" (LIKE public."AuditEvent" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)',
    );
    const resolution = await client.query<{ temporary: boolean }>(`
      SELECT bool_and(c.relpersistence = 't') AS temporary
      FROM pg_class c WHERE c.oid IN ('"NotificationDelivery"'::regclass, '"AuditEvent"'::regclass)
    `);
    expect(resolution.rows[0]?.temporary).toBe(true);
    await run(client);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

async function insertDelivery(
  client: Client,
  input: {
    record?: string;
    status?: "QUEUED" | "SENT" | "SENDING";
    days?: number;
    stage?: "expired" | "today";
  },
) {
  const id = randomUUID();
  const dedupeKey = `qualification-expiry:${input.record ?? id}:${input.stage ?? "expired"}:2026-09-07:IN_APP:person`;
  await client.query(
    `
    INSERT INTO "NotificationDelivery" (
      id, "dedupeKey", type, channel, status, target, "templateKey", "templateParams",
      "attemptCount", "retryCycle", "providerMessageId", "sentAt", "nextAttemptAt", version
    ) VALUES ($1, $2, 'QUALIFICATION_EXPIRY', 'IN_APP', $3, 'fixture-target', $4, $5::jsonb,
      2, 1, 'fixture-provider-id', '2026-09-07T00:00:00Z', '2026-09-08T00:00:00Z', 7)
  `,
    [
      id,
      dedupeKey,
      input.status ?? "QUEUED",
      `qualification.expiry.${input.stage ?? "expired"}`,
      JSON.stringify({ daysRemaining: input.days ?? 0, qualificationName: "fixture" }),
    ],
  );
  return id;
}

async function snapshot(client: Client) {
  const deliveries = await client.query('SELECT * FROM "NotificationDelivery" ORDER BY id');
  const audit = await client.query('SELECT * FROM "AuditEvent" ORDER BY id');
  return { deliveries: deliveries.rows, audit: audit.rows };
}

describe.skipIf(!connectionString)("same-day reminder forward migration (real PostgreSQL)", () => {
  it("rekeys queued and sent same-day reminders, preserves sent history and genuine expiry, and is idempotent", async () => {
    await withTemporaryTables(async (client) => {
      const queuedId = await insertDelivery(client, {});
      const sentId = await insertDelivery(client, { status: "SENT" });
      const expiredId = await insertDelivery(client, { days: -1 });
      const before = await snapshot(client);
      await client.query(migration);
      const after = await snapshot(client);
      expect(after.deliveries).toEqual(
        before.deliveries.map((row) => {
          if (row.id === expiredId) return row;
          return {
            ...row,
            dedupeKey: row.dedupeKey.replace(":expired:", ":today:"),
            templateKey: row.id === queuedId ? "qualification.expiry.today" : row.templateKey,
          };
        }),
      );
      expect(after.audit).toHaveLength(2);
      for (const id of [queuedId, sentId]) {
        const old = before.deliveries.find((row) => row.id === id)!;
        expect(after.audit.find((row) => row.entityId === id)).toMatchObject({
          actorType: "system",
          action: "qualification_reminder_same_day_rekey",
          entityType: "NotificationDelivery",
          requestId: "migration:20260907010000_qualification_reminder_today",
          detail: {
            oldDedupeKey: old.dedupeKey,
            newDedupeKey: old.dedupeKey.replace(":expired:", ":today:"),
            oldTemplateKey: old.templateKey,
            oldTemplateParams: old.templateParams,
            oldStatus: old.status,
            queuedTemplateUpdated: id === queuedId,
          },
        });
      }
      await client.query(migration);
      expect(await snapshot(client)).toEqual(after);
    });
  });

  it.each(["SENDING", "today-key collision"] as const)(
    "rejects %s atomically without partially repairing other rows",
    async (scenario) => {
      await withTemporaryTables(async (client) => {
        await insertDelivery(client, {}); // An otherwise repairable row must stay unchanged.
        if (scenario === "SENDING") {
          await insertDelivery(client, { status: "SENDING" });
        } else {
          const record = randomUUID();
          await insertDelivery(client, { record });
          await insertDelivery(client, { record, stage: "today" });
        }
        const before = await snapshot(client);
        await expect(client.query(migration)).rejects.toThrow(
          scenario === "SENDING"
            ? "requires drained notification workers"
            : "found existing today keys",
        );
        await client.query("ROLLBACK");
        expect(await snapshot(client)).toEqual(before);
        const temp = await client.query(
          "SELECT to_regclass('pg_temp.qualification_same_day_reminders') AS relation",
        );
        expect(temp.rows[0]?.relation).toBeNull();
      });
    },
  );
});
