import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { PgBoss } from "pg-boss";
import { ensureQueues } from "../src/server/jobs";
import { minimalSubprocessEnvironment } from "../src/server/postgres-client-environment";

const PGBOSS_SCHEMA = "pgboss";

/** Keep unrelated application credentials out of the pg-boss migration CLI. */
export function pgBossMigrationEnvironment(
  directUrl: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...minimalSubprocessEnvironment(source),
    PGBOSS_DATABASE_URL: directUrl,
    PGBOSS_SCHEMA,
  };
}

export async function migratePgBoss(): Promise<void> {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error("DIRECT_URL is required for pg-boss migrations");

  // The CLI performs migrations synchronously and inlines concurrent-index
  // work, so the runtime never starts against a partially migrated queue.
  const cli = resolve("node_modules/pg-boss/dist/cli.js");
  const migration = spawnSync(process.execPath, [cli, "migrate", "--schema", PGBOSS_SCHEMA], {
    env: pgBossMigrationEnvironment(directUrl),
    stdio: "inherit",
  });
  if (migration.error) throw migration.error;
  if (migration.signal) process.kill(process.pid, migration.signal);
  if (migration.status !== 0) {
    throw new Error(`pg-boss migration failed with status ${migration.status ?? "unknown"}`);
  }

  // Queue definitions are deployment state, not runtime DDL. Create/update
  // them while still connected as the owner before grants are tightened.
  const boss = new PgBoss({
    connectionString: directUrl,
    schema: PGBOSS_SCHEMA,
    migrate: false,
    supervise: false,
    schedule: false,
  });
  try {
    await boss.start();
    await ensureQueues(boss);
  } finally {
    await boss.stop();
  }
  console.log(JSON.stringify({ event: "pgboss_migration_complete", schema: PGBOSS_SCHEMA }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void migratePgBoss().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "pgboss_migration_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}
