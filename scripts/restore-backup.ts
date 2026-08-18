import { restoreBackupRun } from "../src/server/backup-runner";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const runId = process.argv[2];
const confirmation = process.argv[3];
if (!runId || confirmation !== "恢复") {
  throw new Error("用法：tsx scripts/restore-backup.ts <runId> 恢复");
}
if (!process.env.RESTORE_DATABASE_URL) {
  throw new Error("离线恢复必须提供 RESTORE_DATABASE_URL");
}
if (process.env.RESTORE_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error("RESTORE_DATABASE_URL 不得指向在线数据库");
}
const restoreBucket = process.env.RESTORE_S3_BUCKET?.trim();
if (!restoreBucket) throw new Error("离线恢复必须提供新的 RESTORE_S3_BUCKET");
if (restoreBucket === process.env.S3_BUCKET) {
  throw new Error("RESTORE_S3_BUCKET 不得与在线证据 bucket 相同");
}
process.env.S3_BUCKET = restoreBucket;
process.env.CREWQUAL_OFFLINE_RESTORE = "1";

async function assertEmptyRestoreDatabase() {
  if (process.env.RESTORE_DATABASE_EMPTY_CHECK === "0") return;
  const db = new PrismaClient({ adapter: new PrismaPg(process.env.RESTORE_DATABASE_URL!) });
  try {
    const tables = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    if (tables.length)
      throw new Error(`恢复目标数据库非空：${tables.map((item) => item.tablename).join(", ")}`);
  } finally {
    await db.$disconnect();
  }
}

void assertEmptyRestoreDatabase()
  .then(() => restoreBackupRun(runId, confirmation))
  .then((result) => console.log(JSON.stringify({ event: "offline_restore_complete", ...result })))
  .catch((error: unknown) => {
    console.error(JSON.stringify({ event: "offline_restore_failed", error: String(error) }));
    process.exitCode = 1;
  });
