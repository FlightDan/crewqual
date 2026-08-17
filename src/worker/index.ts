import { createBoss, ensureQueues, QUEUES } from "@/server/jobs";
import { getServerConfig } from "@/server/config";
import { getPrisma } from "@/server/prisma";
import { recognizeEvidence } from "@/server/vlm";
import { deletePrivateEvidence } from "@/server/storage";
import { getFeishuAdapter, getSmsAdapter } from "@/server/providers";
import {
  processCleanupJob,
  processNotificationJob,
  processRecognitionJob,
  processReminderJob,
  processImageOptimizationJob,
  type NotificationJobPayload,
  type RecognitionJobPayload,
} from "@/server/worker-handlers";
import { processQueuedBackupRuns } from "@/server/backup-runner";
import { createShutdownHandler } from "@/worker/lifecycle";

async function main() {
  if (getServerConfig().SERVICE_MODE === "mock") {
    console.log(JSON.stringify({ event: "worker_disabled", mode: "mock" }));
    return;
  }
  const boss = createBoss();
  const db = getPrisma();

  await boss.start();
  await ensureQueues(boss);
  const workerStartedAt = new Date();
  const writeHeartbeat = () =>
    db.workerHeartbeat.upsert({
      where: { name: "primary" },
      update: { lastSeenAt: new Date(), version: process.env.npm_package_version ?? "unknown" },
      create: {
        name: "primary",
        startedAt: workerStartedAt,
        lastSeenAt: new Date(),
        version: process.env.npm_package_version ?? "unknown",
      },
    });
  await writeHeartbeat();
  const heartbeatTimer = setInterval(() => {
    void writeHeartbeat().catch((error) =>
      console.error(JSON.stringify({ event: "worker_heartbeat_failed", error: String(error) })),
    );
  }, 15_000);
  heartbeatTimer.unref();

  await boss.work<RecognitionJobPayload>(QUEUES.recognition, async (jobs) => {
    const payload = jobs[0]?.data;
    if (!payload) return;
    await processRecognitionJob(db, payload, recognizeEvidence);
  });

  await boss.work<NotificationJobPayload>(QUEUES.notifications, async (jobs) => {
    const payload = jobs[0]?.data;
    if (!payload) return;
    const result = await processNotificationJob(db, payload, {
      sms: getSmsAdapter(),
      feishu: getFeishuAdapter(),
    });
    if (result.status === "retrying") {
      await boss.sendAfter(QUEUES.notifications, payload, null, result.retryAt);
    }
  });

  await boss.work(QUEUES.reminders, async () => processReminderJob(db));

  await boss.work(QUEUES.cleanup, async () => processCleanupJob(db, deletePrivateEvidence));
  await boss.work(QUEUES.mediaOptimization, async (jobs) =>
    processImageOptimizationJob(db, jobs[0]?.data ?? { batchSize: 5 }),
  );
  await boss.work(QUEUES.backups, async () => processQueuedBackupRuns());

  await boss.schedule(QUEUES.cleanup, "0 3 * * *", {});
  await boss.schedule(QUEUES.reminders, "0 8 * * *", {});
  await boss.schedule(QUEUES.mediaOptimization, "*/5 * * * *", { batchSize: 5 });
  await boss.schedule(QUEUES.backups, "* * * * *", {});

  const shutdown = createShutdownHandler({
    stop: async () => {
      clearInterval(heartbeatTimer);
      await boss.stop();
    },
    disconnect: () => db.$disconnect(),
    exit: (code) => process.exit(code),
    onError: (error) =>
      console.error(JSON.stringify({ event: "worker_shutdown_failed", error: String(error) })),
  });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  console.log(JSON.stringify({ event: "worker_started", queues: Object.values(QUEUES) }));
}

void main().catch((error) => {
  console.error(JSON.stringify({ event: "worker_failed", error: String(error) }));
  process.exitCode = 1;
});
