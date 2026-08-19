import { spawnSync } from "node:child_process";

const command = process.argv[2];

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (result.signal) process.kill(process.pid, result.signal);
}

switch (command) {
  case "migrate":
    runNode(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
    break;
  case "bootstrap":
    runNode(["--import", "tsx", "scripts/migrate-member-architecture.ts"]);
    runNode(["--import", "tsx", "scripts/bootstrap-production.ts"]);
    break;
  case "db-check":
    runNode(["--import", "tsx", "scripts/release/verify.ts", "db-check"]);
    break;
  default:
    console.error("Usage: node scripts/container-entrypoint.mjs <migrate|bootstrap|db-check>");
    process.exit(2);
}
