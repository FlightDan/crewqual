// @vitest-environment node
// Both URLs must point to distinct disposable test databases with schema creation rights.
// Requires pg_dump and pg_restore (PostgreSQL 16 for release acceptance) on PATH.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertRestoreIsolation,
  postgresClientEnvironment,
  restorePostgresArchive,
} from "./backup-runner";

const sourceUrl = process.env.CREWQUAL_BACKUP_RESTORE_SOURCE_DATABASE_URL;
const targetUrl = process.env.CREWQUAL_BACKUP_RESTORE_TARGET_DATABASE_URL;
const execute = promisify(execFile);
let source: Client;
let target: Client;
let directory = "";
const schema = `restore_command_${randomUUID().replaceAll("-", "")}`;

describe.skipIf(!sourceUrl || !targetUrl)("real isolated PostgreSQL archive restore", () => {
  beforeAll(async () => {
    assertRestoreIsolation({
      sourceDatabaseUrl: sourceUrl!,
      restoreDatabaseUrl: targetUrl!,
      sourceBucket: "source",
      restoreBucket: "target",
    });
    source = new Client({ connectionString: sourceUrl });
    target = new Client({ connectionString: targetUrl });
    await source.connect();
    await target.connect();
    const sourceIdentity = await source.query("SELECT current_database() AS name");
    const targetIdentity = await target.query("SELECT current_database() AS name");
    // Stronger than URL comparison: distinct names also exclude aliases to the same DB.
    expect(sourceIdentity.rows[0].name).not.toBe(targetIdentity.rows[0].name);
    directory = await mkdtemp(join(tmpdir(), "crewqual-restore-command-test-"));
    await source.query(`CREATE SCHEMA "${schema}"`);
    await source.query(`CREATE TABLE "${schema}".parent (id integer PRIMARY KEY)`);
    await source.query(
      `CREATE TABLE "${schema}".child (id integer PRIMARY KEY, parent_id integer REFERENCES "${schema}".parent(id))`,
    );
    await source.query(`INSERT INTO "${schema}".parent VALUES (1)`);
    await source.query(`INSERT INTO "${schema}".child VALUES (2, 1)`);
  });

  afterAll(async () => {
    for (const client of [source, target]) {
      if (!client) continue;
      try {
        if (directory) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await client.end();
      }
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("restores rows and relationships and rolls back a subsequent SQL failure", async () => {
    const archive = join(directory, "backup.dump");
    const dump = () =>
      execute("pg_dump", ["--format=custom", "--schema", schema, "--file", archive], {
        env: postgresClientEnvironment(sourceUrl!),
      });
    await dump();
    await restorePostgresArchive(targetUrl!, archive);
    const rows = () =>
      target.query(
        `SELECT c.id, p.id AS parent_id FROM "${schema}".child c JOIN "${schema}".parent p ON p.id = c.parent_id`,
      );
    expect((await rows()).rows).toEqual([{ id: 2, parent_id: 1 }]);

    const sourceName = String(
      (await source.query("SELECT current_database() AS name")).rows[0].name,
    ).replaceAll("'", "''");
    await source.query(
      `CREATE TABLE "${schema}".reject_target (id integer CHECK (current_database() = '${sourceName}'))`,
    );
    await source.query(`INSERT INTO "${schema}".reject_target VALUES (3)`);
    await dump();
    await expect(restorePostgresArchive(targetUrl!, archive)).rejects.toThrow();
    expect((await rows()).rows).toEqual([{ id: 2, parent_id: 1 }]);
    expect(
      (await target.query("SELECT to_regclass($1) AS relation", [`${schema}.reject_target`]))
        .rows[0].relation,
    ).toBeNull();
    expect((await source.query(`SELECT id FROM "${schema}".reject_target`)).rows).toEqual([
      { id: 3 },
    ]);

    const corrupt = join(directory, "corrupt.dump");
    await writeFile(corrupt, "not a PostgreSQL archive");
    await expect(restorePostgresArchive(targetUrl!, corrupt)).rejects.toThrow();
    expect((await rows()).rows).toEqual([{ id: 2, parent_id: 1 }]);
  });
});
