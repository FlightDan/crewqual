import { restoreBackupRun } from "../src/server/backup-runner";

const runId = process.argv[2];
const confirmation = process.argv[3];
if (!runId || confirmation !== "恢复") {
  throw new Error("用法：tsx scripts/restore-backup.ts <runId> 恢复");
}
if (!process.env.RESTORE_DATABASE_URL) {
  throw new Error("离线恢复必须提供 RESTORE_DATABASE_URL");
}
process.env.CREWQUAL_OFFLINE_RESTORE = "1";

void restoreBackupRun(runId, confirmation)
  .then((result) => console.log(JSON.stringify({ event: "offline_restore_complete", ...result })))
  .catch((error: unknown) => {
    console.error(JSON.stringify({ event: "offline_restore_failed", error: String(error) }));
    process.exitCode = 1;
  });
