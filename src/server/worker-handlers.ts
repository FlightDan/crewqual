import { evaluateStoredQualification } from "@/lib/qualification-date-status";
import { pilotQualificationTimezone } from "@/lib/qualification-timezone";
import type { FeishuAdapter, SmsAdapter } from "@/server/providers";
import { reminderWindow as calculateReminderWindow } from "@/lib/qualification-rules";
import {
  emitDeliveryFailureAlert,
  emitPilotNotification,
  emitQualificationReminder,
} from "@/server/notifications";
import { parseReminderRule } from "@/lib/qualification-rules";
import { dateOnlyForTimezone } from "@/lib/date-only";
import { renderNotificationContent } from "@/lib/notification-i18n";
import { decryptSettingSecret } from "@/server/crypto";
import { getServerConfig } from "@/server/config";
import { persistVerificationForEvidence } from "@/server/qualification-verification";
import {
  convertJpegToLosslessAvif,
  deletePrivateEvidence,
  putPrivateObject,
  readVerifiedEvidence,
} from "@/server/storage";
import {
  assertEvidenceOwner,
  assertEvidenceProvenance,
  evidenceUnavailable,
  EVIDENCE_STORAGE_ENCODING_VERSION,
  type EvidenceProvenance,
} from "@/server/evidence-provenance";

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
  recognize: (objectKey: string, evidence: EvidenceProvenance) => Promise<RecognitionResult>,
  now = new Date(),
) {
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  await db.recognitionTask.updateMany({
    where: { status: "RUNNING", startedAt: { lt: staleBefore } },
    data: { status: "QUEUED", startedAt: null },
  });
  const initial = await db.recognitionTask.findUnique({
    where: { id: payload.recognitionId },
    include: { evidenceImage: { include: { pilot: true } } },
  });
  if (!initial) return { status: "ignored" as const };
  // A malformed queue payload must not change the real task it happens to name.
  if (initial.evidenceImageId !== payload.evidenceImageId) throw evidenceUnavailable();
  const checkTaskEvidence = (task: any) => {
    if (
      task.evidenceImageId !== payload.evidenceImageId ||
      task.evidenceImage?.id !== task.evidenceImageId ||
      !task.evidenceImage?.pilot?.active
    ) {
      throw evidenceUnavailable();
    }
    assertEvidenceProvenance(task.evidenceImage);
    assertEvidenceOwner(task.evidenceImage, task.evidenceImage.pilot);
  };
  try {
    checkTaskEvidence(initial);
  } catch (error) {
    // Invalid sources require reconciliation, not provider retries; leaving an
    // invalid task QUEUED would indefinitely block idle gallery optimization.
    await db.recognitionTask.updateMany({
      where: { id: initial.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", errorCode: "EVIDENCE_SOURCE_INVALID", completedAt: now },
    });
    throw error;
  }
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
    const existing = await db.recognitionTask.findUnique({
      where: { id: payload.recognitionId },
      include: { evidenceImage: { include: { pilot: true } } },
    });
    if (existing?.status === "COMPLETED" && existing.result) {
      checkTaskEvidence(existing);
      await db.$transaction((tx: any) =>
        persistVerificationForEvidence(tx, payload.evidenceImageId, existing.result),
      );
      return { status: "reused" as const, result: existing.result };
    }
    return { status: "ignored" as const };
  }
  const task = await db.recognitionTask.findUniqueOrThrow({
    where: { id: payload.recognitionId },
    include: { evidenceImage: { include: { pilot: true } } },
  });
  try {
    checkTaskEvidence(task);
    const result = await recognize(task.evidenceImage.objectKey, task.evidenceImage);
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
  let providerMessageId: string | null = null;
  let detail = "in-app delivery";
  let errorCategory: string | null = null;
  try {
    let runtimeTemplateParams = delivery.templateParams;
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
      runtimeTemplateParams = {
        ...(delivery.templateParams && typeof delivery.templateParams === "object"
          ? delivery.templateParams
          : {}),
        accessUrl: `${getServerConfig().APP_ORIGIN}/pilot/access/${securePayload.token}`,
        ttlMinutes: securePayload.ttlMinutes,
      };
    }
    const { message } = renderNotificationContent({
      templateKey: delivery.templateKey,
      templateParams: runtimeTemplateParams,
      locale: delivery.locale,
    });
    const idempotencyKey = delivery.dedupeKey ?? delivery.id;
    if (delivery.channel === "SMS") {
      const result = await adapters.sms.send({
        mobile: delivery.target,
        message,
        idempotencyKey,
      });
      accepted = result.accepted;
      providerMessageId = result.providerId ?? null;
      detail = result.providerId ? `provider=${result.providerId}` : "sms adapter response";
    } else if (delivery.channel === "FEISHU") {
      const result = await adapters.feishu.send({
        target: delivery.target,
        message,
        idempotencyKey,
      });
      accepted = result.accepted;
      providerMessageId = result.providerId ?? null;
      detail = result.providerId ? `provider=${result.providerId}` : "feishu adapter response";
    }
  } catch (error) {
    accepted = false;
    const message = error instanceof Error ? error.message : "notification adapter failed";
    errorCategory =
      message === "PROVIDER_PROTOCOL_ERROR"
        ? "provider_protocol"
        : message.includes("Timeout")
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
    !accepted &&
    attemptNumber <= retryLimit &&
    errorCategory !== "payload_expired" &&
    errorCategory !== "provider_protocol";
  const retryDelaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, attemptNumber - 1));
  const retryAt = shouldRetry ? new Date(now.getTime() + retryDelaySeconds * 1000) : null;
  const unknownOutcome =
    !accepted && !shouldRetry && ["timeout", "provider_protocol"].includes(errorCategory ?? "");
  // IN_APP is delivered locally.  An external provider response only proves
  // acceptance; a later receipt (when supported) is required to mark it
  // delivered.  Keep the worker return value backward compatible while the
  // persisted state is explicit.
  const finalStatus = accepted
    ? delivery.channel === "IN_APP"
      ? "SENT"
      : "PROVIDER_ACCEPTED"
    : shouldRetry
      ? "QUEUED"
      : unknownOutcome
        ? "UNKNOWN"
        : "FAILED";
  await db.$transaction(async (tx: any) => {
    await tx.notificationAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber,
        retryCycle: delivery.retryCycle ?? 0,
        status: accepted
          ? delivery.channel === "IN_APP"
            ? "SENT"
            : "PROVIDER_ACCEPTED"
          : unknownOutcome
            ? "UNKNOWN"
            : "FAILED",
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
        providerMessageId,
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
        locale: delivery.locale,
        sourceTemplateKey: delivery.templateKey,
        sourceTemplateParams: delivery.templateParams ?? {},
        errorCategory,
        finalFailureReason: detail,
        failedAt: now,
      });
    }
  });
  if (shouldRetry) return { status: "retrying" as const, retryAt: retryAt! };
  return {
    status: accepted ? "sent" : (finalStatus.toLowerCase() as "failed" | "unknown"),
  };
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
    where: { status: "ACTIVE", pilot: { active: true } },
    select: {
      id: true,
      pilotId: true,
      expiryDate: true,
      qualificationRuleSnapshot: true,
      pilot: {
        select: {
          displayName: true,
          mobile: true,
          employeeNumber: true,
          unitId: true,
          unit: {
            select: { id: true, organizationId: true, timezone: true, notificationRouting: true },
          },
          person: {
            select: {
              organizationId: true,
              unitId: true,
              unit: { select: { id: true, organizationId: true, timezone: true } },
            },
          },
        },
      },
      qualificationType: { select: { name: true, reminders: true } },
      qualificationDefinition: { select: { name: true, reminders: true } },
    },
  });
  let created = 0;
  let manualReviewCount = 0;
  for (const record of records) {
    const timezone = pilotQualificationTimezone(record.pilot);
    const state = evaluateStoredQualification(record, { now: () => now }, timezone);
    if (state.status === "incomplete") {
      manualReviewCount += 1;
      continue;
    }
    if (state.daysRemaining === null) continue;
    const rule = parseReminderRule(
      record.qualificationDefinition?.reminders ?? record.qualificationType.reminders,
    );
    const window = calculateReminderWindow(record.expiryDate, now, rule, timezone!);
    if (!window) continue;
    const recipients = window.kind === "expired" ? rule.expiredRecipients : rule.dueRecipients;
    if (recipients.length === 0) continue;
    const result = await db.$transaction((tx: any) => {
      const input = {
        eventKey: `qualification-expiry:${record.id}:${window.kind}`,
        type: "qualification_expiry" as const,
        pilotId: record.pilotId,
        templateKey:
          window.kind === "expired"
            ? ("qualification.expiry.expired" as const)
            : window.kind === "today"
              ? ("qualification.expiry.today" as const)
              : ("qualification.expiry.due" as const),
        templateParams: {
          qualificationName: record.qualificationType.name,
          qualificationTranslations: record.qualificationType.translations,
          pilotName: record.pilot.displayName,
          daysRemaining: window.daysRemaining,
        },
      };
      return recipients.every((recipient) => recipient === "PERSON")
        ? emitPilotNotification(tx, input)
        : emitQualificationReminder(tx, { ...input, recipients });
    });
    created += result.created;
  }
  let upgradeCreated = 0;
  if (typeof db.upgradePlan?.findMany === "function") {
    const plans = await db.upgradePlan.findMany({
      where: { lifecycleStatus: { in: ["ACTIVE", "PAUSED"] }, pilot: { active: true } },
      select: {
        id: true,
        title: true,
        pilotId: true,
        pilot: { select: { displayName: true, unit: { select: { timezone: true } } } },
        stages: {
          where: { status: { not: "COMPLETED" } },
          select: { id: true, code: true, order: true, plannedStart: true, status: true },
        },
      },
    });
    for (const plan of plans) {
      const timezone = plan.pilot.unit?.timezone ?? "Asia/Shanghai";
      const today = dateOnlyForTimezone(now, timezone);
      for (const stage of plan.stages) {
        const planned = stage.plannedStart.toISOString().slice(0, 10);
        const todayMs = Date.parse(`${today}T00:00:00Z`);
        const plannedMs = Date.parse(`${planned}T00:00:00Z`);
        const days = Math.round((plannedMs - todayMs) / 86_400_000);
        if (days < 0 || days > 7) continue;
        await db.notificationDelivery?.updateMany?.({
          where: {
            type: "UPGRADE_STAGE_REMINDER",
            status: "QUEUED",
            pilotId: plan.pilotId,
            dedupeKey: { startsWith: `upgrade-stage-reminder:${stage.id}:` },
            NOT: { dedupeKey: `upgrade-stage-reminder:${stage.id}:${planned}` },
          },
          data: { status: "FAILED", finalFailureReason: "计划日期已变更" },
        });
        const result = await db.$transaction((tx: any) =>
          emitPilotNotification(tx, {
            eventKey: `upgrade-stage-reminder:${stage.id}:${planned}`,
            type: "upgrade_stage_reminder",
            pilotId: plan.pilotId,
            templateKey: "upgrade.stage.upcoming",
            templateParams: {
              pilotName: plan.pilot.displayName,
              planTitle: plan.title,
              stageCode: stage.code,
              stageOrder: stage.order,
              days,
            },
          }),
        );
        upgradeCreated += result.created;
      }
    }
  }
  return {
    scannedAt: now.toISOString(),
    scanned: records.length,
    scannedCount: records.length,
    manualReviewCount,
    created: created + upgradeCreated,
  };
}

export async function processCleanupJob(
  db: any,
  deleteEvidence: (objectKey: string) => Promise<unknown>,
  now = new Date(),
) {
  let deleted = 0;
  // Continue paging until the backlog is drained (or a safe per-run ceiling
  // is reached) so a fixed daily `take: 100` cannot leave an unbounded queue.
  for (let page = 0; page < 20; page += 1) {
    const orphaned = await db.evidenceImage.findMany({
      where: { status: "orphaned", expiresAt: { lt: now } },
      take: 100,
    });
    if (!orphaned.length) break;
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
    if (orphaned.length < 100) break;
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
      storageEncodingVersion: EVIDENCE_STORAGE_ENCODING_VERSION,
      sanitizedAt: { not: null },
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
    include: { evidenceImage: { include: { pilot: true } } },
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
      assertEvidenceProvenance(task.evidenceImage);
      if (
        task.sourceObjectKey !== task.evidenceImage.objectKey ||
        task.evidenceImageId !== task.evidenceImage.id ||
        !task.evidenceImage.pilot?.active
      )
        throw evidenceUnavailable();
      assertEvidenceOwner(task.evidenceImage, task.evidenceImage.pilot);
      const sourceBytes = await readVerifiedEvidence(task.evidenceImage);
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
            storageEncodingVersion: EVIDENCE_STORAGE_ENCODING_VERSION,
            sanitizedAt: task.evidenceImage.sanitizedAt,
            sha256: task.evidenceImage.sha256,
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
      // Keep the original immutable evidence object.  Historical revisions
      // and backup manifests may still reference it; a later GC pass may
      // delete it only after every reference and retention window expires.
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
