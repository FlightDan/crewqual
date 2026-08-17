import type { FeishuAdapter, SmsAdapter } from "@/server/providers";
import { reminderWindow as calculateReminderWindow } from "@/lib/qualification-rules";
import { emitDeliveryFailureAlert, emitPilotNotification } from "@/server/notifications";
import { decryptSettingSecret } from "@/server/crypto";
import { getServerConfig } from "@/server/config";
import { persistVerificationForEvidence } from "@/server/qualification-verification";
import {
  convertJpegToLosslessAvif,
  deletePrivateEvidence,
  putPrivateObject,
  readPrivateEvidence,
} from "@/server/storage";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type RecognitionJobPayload = {
  recognitionId: string;
  updateRequestId?: string;
  evidenceImageId: string;
};

export type NotificationJobPayload = { deliveryId?: string; pilotId: string; type: string };
export type ImageOptimizationJobPayload = { batchSize?: number };

export type RecognitionResult = {
  available: boolean;
  provider: string;
  [key: string]: unknown;
};

export async function processRecognitionJob(
  db: any,
  payload: RecognitionJobPayload,
  recognize: (objectKey: string) => Promise<RecognitionResult>,
  now = new Date(),
) {
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  await db.recognitionTask.updateMany({
    where: { status: "RUNNING", startedAt: { lt: staleBefore } },
    data: { status: "QUEUED", startedAt: null },
  });
  const initial = await db.recognitionTask.findUnique({ where: { id: payload.recognitionId } });
  if (!initial) return { status: "ignored" as const };
  if (initial.status === "COMPLETED" && initial.result) {
    await db.$transaction((tx: any) =>
      persistVerificationForEvidence(tx, payload.evidenceImageId, initial.result),
    );
    return { status: "reused" as const, result: initial.result };
  }
  if (initial.attemptCount > initial.retryLimit) return { status: "ignored" as const };
  const claimed = await db.recognitionTask.updateMany({
    where: {
      id: payload.recognitionId,
      status: "QUEUED",
      attemptCount: initial.attemptCount,
    },
    data: { status: "RUNNING", startedAt: now, attemptCount: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    const existing = await db.recognitionTask.findUnique({ where: { id: payload.recognitionId } });
    if (existing?.status === "COMPLETED" && existing.result) {
      await db.$transaction((tx: any) =>
        persistVerificationForEvidence(tx, payload.evidenceImageId, existing.result),
      );
      return { status: "reused" as const, result: existing.result };
    }
    return { status: "ignored" as const };
  }
  const task = await db.recognitionTask.findUniqueOrThrow({
    where: { id: payload.recognitionId },
    include: { evidenceImage: true },
  });
  try {
    const result = await recognize(task.evidenceImage.objectKey);
    await db.$transaction(async (tx: any) => {
      const completed = await tx.recognitionTask.updateMany({
        where: { id: task.id, status: "RUNNING" },
        data: { status: "COMPLETED", result, completedAt: now },
      });
      if (completed.count !== 1) throw new Error("RECOGNITION_CLAIM_LOST");
      await persistVerificationForEvidence(tx, payload.evidenceImageId, result);
    });
    return { status: "completed" as const, result };
  } catch (error) {
    const retry = task.attemptCount <= task.retryLimit;
    await db.recognitionTask.updateMany({
      where: { id: task.id, status: "RUNNING" },
      data: {
        status: retry ? "QUEUED" : "FAILED",
        errorCode: error instanceof Error ? error.name : "UNKNOWN",
        startedAt: null,
        completedAt: retry ? null : now,
      },
    });
    throw error;
  }
}

export async function processNotificationJob(
  db: any,
  payload: NotificationJobPayload,
  adapters: { sms: SmsAdapter; feishu: FeishuAdapter },
  now = new Date(),
) {
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  await db.notificationDelivery.updateMany({
    where: { status: "SENDING", startedAt: { lt: staleBefore } },
    data: { status: "QUEUED", startedAt: null },
  });
  const candidate = await db.notificationDelivery.findFirst({
    where: payload.deliveryId
      ? {
          id: payload.deliveryId,
          status: "QUEUED",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        }
      : {
          pilotId: payload.pilotId,
          type: payload.type,
          status: "QUEUED",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
    orderBy: { createdAt: "desc" },
  });
  if (!candidate) return { status: "ignored" as const };

  const claimed = await db.notificationDelivery.updateMany({
    where: { id: candidate.id, status: "QUEUED" },
    data: {
      status: "SENDING",
      startedAt: now,
      nextAttemptAt: null,
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return { status: "ignored" as const };
  const attemptNumber = (candidate.attemptCount ?? 0) + 1;
  const delivery = { ...candidate, status: "SENDING", attemptCount: attemptNumber };

  let accepted = delivery.channel === "IN_APP";
  let detail = "in-app delivery";
  let errorCategory: string | null = null;
  try {
    let message = delivery.message;
    if (delivery.type === "PILOT_ACCESS_LINK" && delivery.securePayloadCiphertext) {
      if (
        !delivery.securePayloadExpiresAt ||
        new Date(delivery.securePayloadExpiresAt).getTime() <= now.getTime()
      ) {
        throw new Error("SECURE_PAYLOAD_EXPIRED");
      }
      const securePayload = JSON.parse(decryptSettingSecret(delivery.securePayloadCiphertext)) as {
        token: string;
        ttlMinutes: number;
      };
      message = `CrewQual 访问链接：${getServerConfig().APP_ORIGIN}/pilot/access/${securePayload.token}（${securePayload.ttlMinutes}分钟内有效）`;
    }
    const idempotencyKey = delivery.dedupeKey ?? delivery.id;
    if (delivery.channel === "SMS") {
      const result = await adapters.sms.send({
        mobile: delivery.target,
        message,
        idempotencyKey,
      });
      accepted = result.accepted;
      detail = result.providerId ? `provider=${result.providerId}` : "sms adapter response";
    } else if (delivery.channel === "FEISHU") {
      const result = await adapters.feishu.send({
        target: delivery.target,
        message,
        idempotencyKey,
      });
      accepted = result.accepted;
      detail = result.providerId ? `provider=${result.providerId}` : "feishu adapter response";
    }
  } catch (error) {
    accepted = false;
    const message = error instanceof Error ? error.message : "notification adapter failed";
    errorCategory = message.includes("Timeout")
      ? "timeout"
      : message.includes("HTTP")
        ? "provider_http"
        : message === "SECURE_PAYLOAD_EXPIRED"
          ? "payload_expired"
          : "provider_error";
    detail = errorCategory;
  }

  if (!accepted && !errorCategory) errorCategory = "provider_rejected";
  const retryLimit = Math.max(0, delivery.retryLimit ?? 0);
  const shouldRetry =
    !accepted && attemptNumber <= retryLimit && errorCategory !== "payload_expired";
  const retryDelaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, attemptNumber - 1));
  const retryAt = shouldRetry ? new Date(now.getTime() + retryDelaySeconds * 1000) : null;
  const finalStatus = accepted ? "SENT" : shouldRetry ? "QUEUED" : "FAILED";
  await db.$transaction(async (tx: any) => {
    await tx.notificationAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber,
        retryCycle: delivery.retryCycle ?? 0,
        status: accepted ? "SENT" : "FAILED",
        errorCategory,
        detail: delivery.channel === "IN_APP" ? "站内通知已投递到 Pilot 收件箱" : detail,
      },
    });
    await tx.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: finalStatus,
        startedAt: null,
        sentAt: accepted ? now : null,
        nextAttemptAt: retryAt,
        lastErrorCategory: errorCategory,
        finalFailureReason: !accepted && !shouldRetry ? detail : null,
        ...(accepted || errorCategory === "payload_expired"
          ? { securePayloadCiphertext: null, securePayloadExpiresAt: null }
          : {}),
      },
    });
    if (!accepted && !shouldRetry && delivery.type !== "DELIVERY_FAILED") {
      await emitDeliveryFailureAlert(tx, {
        deliveryId: delivery.id,
        pilotId: delivery.pilotId ?? payload.pilotId ?? null,
        channel: delivery.channel,
        summary: delivery.summary ?? "未命名通知",
        errorCategory,
        finalFailureReason: detail,
        failedAt: now,
      });
    }
  });
  if (shouldRetry) return { status: "retrying" as const, retryAt: retryAt! };
  return { status: finalStatus.toLowerCase() as "sent" | "failed" };
}

/**
 * Scan active qualifications and enqueue at most one in-app reminder per record
 * and reminder window. The unique dedupe key makes retries and two workers
 * racing on the same schedule safe at the database boundary.
 */
export async function processReminderJob(dbOrNow: any = new Date(), requestedNow = new Date()) {
  if (!dbOrNow || typeof dbOrNow.qualificationRecord?.findMany !== "function") {
    const now = dbOrNow instanceof Date ? dbOrNow : requestedNow;
    return { scannedAt: now.toISOString() };
  }
  const db = dbOrNow;
  const now = requestedNow;
  const records = await db.qualificationRecord.findMany({
    where: { status: "ACTIVE", expiryDate: { not: null }, pilot: { active: true } },
    select: {
      id: true,
      pilotId: true,
      expiryDate: true,
      pilot: {
        select: {
          displayName: true,
          mobile: true,
          employeeNumber: true,
          unit: { select: { timezone: true, notificationRouting: true } },
        },
      },
      qualificationType: { select: { name: true, reminders: true } },
    },
  });
  let created = 0;
  for (const record of records) {
    if (!record.expiryDate) continue;
    const window = calculateReminderWindow(
      record.expiryDate,
      now,
      record.qualificationType.reminders,
      record.pilot.unit.timezone,
    );
    if (!window) continue;
    const summary = `${record.qualificationType.name}${window.kind === "expired" ? "已过期" : "即将到期"}`;
    const message =
      window.kind === "expired"
        ? `${record.pilot.displayName} 的${record.qualificationType.name}已过期，请尽快处理。`
        : `${record.pilot.displayName} 的${record.qualificationType.name}将在 ${window.daysRemaining} 天后到期。`;
    const result = await db.$transaction((tx: any) =>
      emitPilotNotification(tx, {
        eventKey: `qualification-expiry:${record.id}:${window.kind}`,
        type: "qualification_expiry",
        pilotId: record.pilotId,
        summary,
        message,
      }),
    );
    created += result.created;
  }
  return { scannedAt: now.toISOString(), scanned: records.length, created };
}

export async function processCleanupJob(
  db: any,
  deleteEvidence: (objectKey: string) => Promise<unknown>,
  now = new Date(),
) {
  const orphaned = await db.evidenceImage.findMany({
    where: { status: "orphaned", expiresAt: { lt: now } },
    take: 100,
  });
  let deleted = 0;
  for (const image of orphaned) {
    try {
      await deleteEvidence(image.objectKey);
      await db.evidenceImage.delete({ where: { id: image.id } });
      deleted += 1;
    } catch {
      // Keep the row for a later retry. Deleting it after an object-storage
      // failure would permanently orphan the remote object.
    }
  }
  return { deleted };
}

export async function processImageOptimizationJob(
  db: any,
  payload: ImageOptimizationJobPayload = {},
  now = new Date(),
) {
  const setting = await db.mediaOptimizationSetting?.findUnique?.({ where: { id: "global" } });
  if (!setting?.enabled) return { status: "disabled" as const };
  const activeRecognition = await db.recognitionTask.count({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (activeRecognition > 0) return { status: "idle" as const, activeRecognition };
  const batchSize = Math.min(20, Math.max(1, payload.batchSize ?? 5));
  const idleBefore = new Date(now.getTime() - setting.idleMinutes * 60 * 1000);
  await db.imageOptimizationTask.updateMany({
    where: { status: "FAILED", attemptCount: { lt: 3 }, createdAt: { lt: idleBefore } },
    data: { status: "QUEUED", errorMessage: null },
  });
  const candidates = await db.evidenceImage.findMany({
    select: { id: true, objectKey: true },
    where: {
      mimeType: "image/jpeg",
      status: { not: "orphaned" },
      createdAt: { lt: idleBefore },
      optimizationTask: null,
    },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });
  for (const image of candidates) {
    await db.imageOptimizationTask
      .create({
        data: { evidenceImageId: image.id, sourceObjectKey: image.objectKey },
      })
      .catch(() => undefined);
  }
  const tasks = await db.imageOptimizationTask.findMany({
    where: { status: "QUEUED" },
    include: { evidenceImage: true },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });
  let converted = 0;
  for (const task of tasks) {
    const claim = await db.imageOptimizationTask.updateMany({
      where: { id: task.id, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: now, attemptCount: { increment: 1 } },
    });
    if (claim.count !== 1) continue;
    let targetObjectKey = "";
    try {
      const sourceBytes = await readPrivateEvidence(task.sourceObjectKey);
      const convertedImage = await convertJpegToLosslessAvif(sourceBytes);
      targetObjectKey = await putPrivateObject(
        convertedImage.storageBytes,
        convertedImage.sha256,
        "image/avif",
        "avif",
      );
      await db.$transaction(async (tx: any) => {
        const updated = await tx.evidenceImage.updateMany({
          where: {
            id: task.evidenceImageId,
            objectKey: task.sourceObjectKey,
            mimeType: "image/jpeg",
          },
          data: {
            objectKey: targetObjectKey,
            mimeType: "image/avif",
            width: convertedImage.width,
            height: convertedImage.height,
            byteSize: convertedImage.byteSize,
            sha256: convertedImage.sha256,
          },
        });
        if (updated.count !== 1) throw new Error("IMAGE_CHANGED_DURING_CONVERSION");
        await tx.imageOptimizationTask.update({
          where: { id: task.id },
          data: { status: "COMPLETED", targetObjectKey, completedAt: now, errorMessage: null },
        });
      });
      await deletePrivateEvidence(task.sourceObjectKey).catch(() => undefined);
      converted += 1;
    } catch (error) {
      if (targetObjectKey) await deletePrivateEvidence(targetObjectKey).catch(() => undefined);
      await db.imageOptimizationTask.updateMany({
        where: { id: task.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : "AVIF conversion failed",
        },
      });
    }
  }
  return { status: "completed" as const, converted, scanned: candidates.length };
}
