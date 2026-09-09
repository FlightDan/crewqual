import { PgBoss, fromPrisma } from "pg-boss";
import type { PrismaTransactionLike } from "pg-boss";
import { getServerConfig } from "@/server/config";

export const QUEUES = {
  recognition: "crewqual.recognition",
  notifications: "crewqual.notifications",
  reminders: "crewqual.reminders",
  cleanup: "crewqual.cleanup",
  mediaOptimization: "crewqual.media-optimization",
  backups: "crewqual.backups",
  securityDetection: "crewqual.security-detection",
  securityCleanup: "crewqual.security-cleanup",
} as const;

export function createBoss() {
  const config = getServerConfig();
  if (config.SERVICE_MODE === "mock") {
    throw new Error("Queue access is disabled in mock mode");
  }
  if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required for pg-boss");
  return new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: "pgboss",
    supervise: true,
    // Queue DDL is applied by the privileged migration container. The
    // long-running Web/Worker role must never need database CREATE rights.
    migrate: false,
    monitorIntervalSeconds: 30,
  });
}

export async function enqueueInTransaction(
  tx: PrismaTransactionLike,
  queue: string,
  payload: Record<string, unknown>,
) {
  if (getServerConfig().SERVICE_MODE === "mock") {
    throw new Error("Queue access is disabled in mock mode");
  }
  const boss = new PgBoss({ db: fromPrisma(tx), schema: "pgboss" });
  return boss.send(queue, payload);
}

export async function ensureQueues(boss: PgBoss) {
  if (getServerConfig().SERVICE_MODE === "mock") {
    throw new Error("Queue access is disabled in mock mode");
  }
  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue, { retryLimit: 5, retryDelay: 30, expireInSeconds: 900 });
  }
}
