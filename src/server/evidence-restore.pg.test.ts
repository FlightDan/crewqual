// @vitest-environment node
// Requires an isolated PostgreSQL database account allowed to create temporary schemas.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetRestoredEvidenceTrust } from "@/server/evidence-restore";

const url = process.env.CREWQUAL_SECURITY_TEST_DATABASE_URL;
let client: Client;
let schema = "";

describe.skipIf(!url)("legacy evidence restore migration compatibility", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    schema = `evidence_restore_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
  });

  afterAll(async () => {
    if (!client) return;
    if (schema) {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await client.end();
  });

  it("runs the pending migration after restore trust reset added the provenance columns", async () => {
    await client.query('CREATE TABLE "AdminUser" ("id" UUID PRIMARY KEY)');
    await client.query('CREATE TABLE "AdminSession" ("id" UUID PRIMARY KEY)');
    await client.query('CREATE TABLE "EvidenceImage" ("id" UUID PRIMARY KEY)');
    const imageId = randomUUID();
    await client.query('INSERT INTO "EvidenceImage" ("id") VALUES ($1)', [imageId]);

    const db = {
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (values.length) throw new Error("Unexpected parameterized restore bootstrap query");
        const result = await client.query(strings.join(""));
        return result.rowCount ?? 0;
      },
    } as unknown as Parameters<typeof resetRestoredEvidenceTrust>[0];
    await resetRestoredEvidenceTrust(db);

    const migration = await readFile(
      new URL(
        "../../prisma/migrations/20260908100000_security_monitoring_access_boundaries/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await expect(client.query(migration)).resolves.toBeDefined();

    const restored = await client.query<{
      storageEncodingVersion: number;
      sanitizedAt: Date | null;
    }>('SELECT "storageEncodingVersion", "sanitizedAt" FROM "EvidenceImage" WHERE "id" = $1', [
      imageId,
    ]);
    expect(restored.rows).toEqual([{ storageEncodingVersion: 0, sanitizedAt: null }]);
  });
});
