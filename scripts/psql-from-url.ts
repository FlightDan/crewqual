import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  minimalSubprocessEnvironment,
  postgresEnvironmentFromUrl,
} from "../src/server/postgres-client-environment";

function main(): void {
  const [, , sourceEnvironmentName, ...psqlArguments] = process.argv;
  if (sourceEnvironmentName !== "DIRECT_URL" && sourceEnvironmentName !== "DATABASE_URL") {
    throw new Error("usage: psql-from-url.ts <DIRECT_URL|DATABASE_URL> [psql arguments ...]");
  }

  const rawUrl = process.env[sourceEnvironmentName];
  if (!rawUrl) throw new Error(`${sourceEnvironmentName} is required`);

  const result = spawnSync("psql", psqlArguments, {
    env: postgresEnvironmentFromUrl(
      rawUrl,
      minimalSubprocessEnvironment(process.env, ["POSTGRES_APP_PASSWORD"]),
    ),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
