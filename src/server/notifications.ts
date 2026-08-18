import { randomUUID } from "node:crypto";
import { z } from "zod";
import { enqueueInTransaction, QUEUES } from "@/server/jobs";
import { getRuntimeIntegration } from "@/server/runtime-settings";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const notificationTypeSchema = z.enum([
  "qualification_expiry",
  "upgrade_stage_reminder",
  "stage_date_changed",
  "stage_completed",
  "review_returned",
  "review_approved",
  "upgrade_created",
  "upgrade_resumed",
  "delivery_failed",
  "pilot_access_link",
]);

export type DomainNotificationType = z.infer<typeof notificationTypeSchema>;
export type DomainNotificationChannel = "IN_APP" | "SMS" | "FEISHU";

const TYPE_TO_DB = {
  qualification_expiry: "QUALIFICATION_EXPIRY",
  upgrade_stage_reminder: "UPGRADE_STAGE_REMINDER",
  stage_date_changed: "STAGE_DATE_CHANGED",
  stage_completed: "STAGE_COMPLETED",
  review_returned: "REVIEW_RETURNED",
  review_approved: "REVIEW_APPROVED",
  upgrade_created: "UPGRADE_CREATED",
  upgrade_resumed: "UPGRADE_RESUMED",
  delivery_failed: "DELIVERY_FAILED",
  pilot_access_link: "PILOT_ACCESS_LINK",
} as const;

const ROUTE_ALIASES: Partial<Record<DomainNotificationType, string[]>> = {
  stage_date_changed: ["upgrade_rescheduled"],
  stage_completed: ["upgrade_completed"],
  upgrade_resumed: ["upgrade_created"],
};

function normalizedChannels(
  value: unknown,
  type: DomainNotificationType,
): DomainNotificationChannel[] {
  if (!Array.isArray(value)) return ["IN_APP"];
  const keys = new Set([type, ...(ROUTE_ALIASES[type] ?? [])]);
  const route = value.find(
    (item): item is { key?: unknown; channels?: unknown } =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { key?: unknown }).key === "string" &&
      keys.has((item as { key: string }).key),
  );
  const channels = Array.isArray(route?.channels) ? route.channels : [];
  const result = channels.flatMap((channel) => {
    if (channel === "inApp" || channel === "in_app") return ["IN_APP" as const];
    if (channel === "sms") return ["SMS" as const];
    if (channel === "feishu") return ["FEISHU" as const];
    return [];
  });
  return result.length ? [...new Set(result)] : ["IN_APP"];
}

function enabledChannels(value: unknown) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return new Set<DomainNotificationChannel>([
    ...((state as { inApp?: unknown }).inApp !== false ? (["IN_APP"] as const) : []),
    ...((state as { sms?: unknown }).sms === true ? (["SMS"] as const) : []),
    ...((state as { feishu?: unknown }).feishu === true ? (["FEISHU"] as const) : []),
  ]);
}

async function configuredRetryLimit(channel: DomainNotificationChannel) {
  if (channel === "IN_APP") return 0;
  const integration = await getRuntimeIntegration(channel === "SMS" ? "sms" : "feishu");
  return Math.max(0, integration.retryLimit);
}

export type PilotNotificationInput = {
  eventKey: string;
  type: DomainNotificationType;
  pilotId: string;
  summary: string;
  message: string;
  channels?: DomainNotificationChannel[];
};

export type QualificationReminderRecipient = "PERSON" | "ADMIN" | "SUPER_ADMIN";

export type QualificationReminderInput = PilotNotificationInput & {
  recipients: QualificationReminderRecipient[];
};

export type DeliveryFailureAlertInput = {
  deliveryId: string;
  pilotId: string | null;
  channel: DomainNotificationChannel;
  summary: string;
  errorCategory: string | null;
  finalFailureReason: string;
  failedAt: Date;
};

/**
 * Persist a terminal delivery failure as a separate, deduplicated admin alert.
 *
 * The alert stays scoped through the original pilot so unit administrators can
 * see it in the notification log. Pilot inbox endpoints explicitly exclude
 * DELIVERY_FAILED because this is an operational alert, not a user message.
 */
export async function emitDeliveryFailureAlert(tx: any, input: DeliveryFailureAlertInput) {
  const id = randomUUID();
  const inserted = await tx.notificationDelivery.createMany({
    data: [
      {
        id,
        dedupeKey: `delivery-failed:${input.deliveryId}:in_app`,
        type: TYPE_TO_DB.delivery_failed,
        channel: "IN_APP",
        status: "SENT",
        pilotId: input.pilotId,
        target: "ADMIN_NOTIFICATION_LOG",
        summary: `通知投递失败：${input.summary}`,
        message: `${input.channel} 投递已达到重试上限（${input.errorCategory ?? "unknown"}）：${input.finalFailureReason}`,
        retryLimit: 0,
        sentAt: input.failedAt,
      },
    ],
    skipDuplicates: true,
  });
  return { created: inserted.count, alertId: inserted.count === 1 ? id : null };
}

/**
 * Unified transactional outbox. Each channel is inserted independently with
 * createMany(skipDuplicates), so one existing channel never aborts creation of
 * newly enabled channels in PostgreSQL.
 */
export async function emitPilotNotification(tx: any, input: PilotNotificationInput) {
  const type = notificationTypeSchema.parse(input.type);
  const pilot = await tx.pilot.findUnique({
    where: { id: input.pilotId },
    select: {
      id: true,
      employeeNumber: true,
      mobile: true,
      active: true,
      unit: { select: { notificationRouting: true, notificationChannelState: true } },
    },
  });
  if (!pilot?.active) return { created: 0, queued: 0, deliveryIds: [] as string[] };

  const configuredChannels =
    input.channels ?? normalizedChannels(pilot.unit.notificationRouting, type);
  const enabled = enabledChannels(pilot.unit.notificationChannelState);
  const channels = configuredChannels.filter((channel) => enabled.has(channel));
  let created = 0;
  let queued = 0;
  const deliveryIds: string[] = [];
  for (const channel of [...new Set(channels)]) {
    const target =
      channel === "SMS" ? pilot.mobile : channel === "FEISHU" ? pilot.employeeNumber : pilot.id;
    if (!target) continue;
    const id = randomUUID();
    const now = new Date();
    const retryLimit = await configuredRetryLimit(channel);
    const inserted = await tx.notificationDelivery.createMany({
      data: [
        {
          id,
          dedupeKey: `${input.eventKey}:${pilot.id}:${channel.toLowerCase()}`,
          type: TYPE_TO_DB[type],
          channel,
          status: channel === "IN_APP" ? "SENT" : "QUEUED",
          pilotId: pilot.id,
          target,
          summary: input.summary,
          message: input.message,
          retryLimit,
          sentAt: channel === "IN_APP" ? now : null,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count !== 1) continue;
    created += 1;
    deliveryIds.push(id);
    if (channel !== "IN_APP") {
      await enqueueInTransaction(tx, QUEUES.notifications, {
        deliveryId: id,
        pilotId: pilot.id,
        type,
      });
      queued += 1;
    }
  }
  return { created, queued, deliveryIds };
}

/**
 * Qualification reminders have a separate recipient policy from upgrade
 * notifications.  PERSON uses the unit's configured channels; role
 * recipients are always persisted as independent in-app deliveries so an
 * administrator can acknowledge the alert without exposing a pilot's
 * contact information to another adapter.
 */
export async function emitQualificationReminder(tx: any, input: QualificationReminderInput) {
  const recipients = [...new Set(input.recipients)];
  let created = 0;
  let queued = 0;
  const deliveryIds: string[] = [];
  if (recipients.includes("PERSON")) {
    const result = await emitPilotNotification(tx, input);
    created += result.created;
    queued += result.queued;
    deliveryIds.push(...result.deliveryIds);
  }
  if (!recipients.some((item) => item === "ADMIN" || item === "SUPER_ADMIN")) {
    return { created, queued, deliveryIds };
  }
  if (typeof tx.adminUser?.findMany !== "function") return { created, queued, deliveryIds };
  const pilot = await tx.pilot.findUnique({
    where: { id: input.pilotId },
    select: { id: true, unitId: true, unit: { select: { organizationId: true } } },
  });
  if (!pilot) return { created, queued, deliveryIds };
  let admins = await tx.adminUser.findMany({
    where: {
      active: true,
      OR: [
        ...(recipients.includes("ADMIN") && pilot.unitId
          ? [{ unitId: pilot.unitId, roles: { some: { role: { code: "ADMIN" } } } }]
          : []),
        ...(recipients.includes("SUPER_ADMIN") && pilot.unit.organizationId
          ? [
              {
                organizationId: pilot.unit.organizationId,
                roles: { some: { role: { code: "SUPER_ADMIN" } } },
              },
            ]
          : []),
      ],
    },
    select: { id: true },
  });
  if (recipients.includes("ADMIN") && pilot.unit.organizationId && admins.length === 0) {
    // A unit can temporarily have no active ADMIN. Escalate to an active
    // organization SUPER_ADMIN and keep the routing gap visible in the
    // notification/audit stream rather than silently dropping the alert.
    admins = await tx.adminUser.findMany({
      where: {
        active: true,
        organizationId: pilot.unit.organizationId,
        roles: { some: { role: { code: "SUPER_ADMIN" } } },
      },
      select: { id: true },
    });
  }
  for (const admin of admins) {
    const id = randomUUID();
    const inserted = await tx.notificationDelivery.createMany({
      data: [
        {
          id,
          dedupeKey: `${input.eventKey}:admin:${admin.id}:in_app`,
          type: TYPE_TO_DB[input.type],
          channel: "IN_APP",
          status: "SENT",
          pilotId: input.pilotId,
          adminUserId: admin.id,
          target: admin.id,
          summary: input.summary,
          message: input.message,
          retryLimit: 0,
          sentAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 1) {
      created += 1;
      deliveryIds.push(id);
    }
  }
  return { created, queued, deliveryIds };
}

export function dbNotificationType(type: DomainNotificationType) {
  return TYPE_TO_DB[type];
}
