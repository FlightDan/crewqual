import { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { createOpaqueToken, encryptSettingSecret, safeEqualHex, sha256 } from "@/server/crypto";
import { getServerConfig } from "@/server/config";
import { getPrisma } from "@/server/prisma";
import { enqueuePilotAccessSms, shouldSendPilotAccessSms } from "@/server/sms-outbox";
import { consumeRateLimit, requestAddress } from "@/server/rate-limit";
import { getRuntimeIntegration, getRuntimeSecurityPolicy } from "@/server/runtime-settings";
import { enqueueInTransaction, QUEUES } from "@/server/jobs";

const schema = z.object({
  employeeNumber: z.string().trim().min(1).max(64),
  mobile: z.string().regex(/^\d{11}$/),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const allowed = await consumeRateLimit(
      `pilot-access:${requestAddress(request)}`,
      5,
      15 * 60 * 1000,
    );
    const input = await parseJson(request, schema);
    const policy = await getRuntimeSecurityPolicy();
    if (!allowed) return jsonData({ accepted: true, retryAfterSeconds: 900 }, requestId, 202);
    const db = getPrisma();
    const pilot = await db.pilot.findUnique({ where: { employeeNumber: input.employeeNumber } });
    const matches = Boolean(
      pilot && pilot.active && safeEqualHex(sha256(pilot.mobile), sha256(input.mobile)),
    );
    if (matches && pilot) {
      const existingToken = await db.pilotAccessToken.findFirst({
        where: { pilotId: pilot.id, consumedAt: null, expiresAt: { gt: new Date() } },
      });
      // Keep a previously issued link valid; repeated requests must not silently
      // invalidate a link that may already be queued at the SMS provider.
      if (existingToken) return jsonData({ accepted: true }, requestId, 202);
      const rawToken = createOpaqueToken();
      const expiresAt = new Date(Date.now() + policy.pilotAccessLinkTtlMinutes * 60 * 1000);
      const sms = await getRuntimeIntegration("sms");
      await db.$transaction(async (tx) => {
        await tx.pilotAccessToken.deleteMany({
          where: { pilotId: pilot.id, consumedAt: null, expiresAt: { lte: new Date() } },
        });
        const accessToken = await tx.pilotAccessToken.create({
          data: { pilotId: pilot.id, tokenHash: sha256(rawToken), expiresAt },
        });
        await tx.auditEvent.create({
          data: {
            actorType: "pilot",
            pilotId: pilot.id,
            action: "pilot_access_token.issued",
            entityType: "PilotAccessToken",
            entityId: accessToken.id,
            detail: { expiresAt: expiresAt.toISOString() },
            requestId,
          },
        });
        const delivery = await tx.notificationDelivery.create({
          data: {
            dedupeKey: `pilot-access:${accessToken.id}:sms`,
            type: "PILOT_ACCESS_LINK",
            channel: "SMS",
            status: "QUEUED",
            pilotId: pilot.id,
            target: pilot.mobile,
            summary: "Pilot 访问链接",
            message: "CrewQual 一次性访问链接",
            retryLimit: sms.retryLimit,
            securePayloadCiphertext: encryptSettingSecret(
              JSON.stringify({ token: rawToken, ttlMinutes: policy.pilotAccessLinkTtlMinutes }),
            ),
            securePayloadExpiresAt: expiresAt,
          },
        });
        await enqueueInTransaction(tx, QUEUES.notifications, {
          deliveryId: delivery.id,
          pilotId: pilot.id,
          type: "pilot_access_link",
        });
      });
      if (await shouldSendPilotAccessSms()) {
        const config = getServerConfig();
        if (config.SMS_ADAPTER === "fake") enqueuePilotAccessSms(pilot.mobile, rawToken);
      }
    }
    return jsonData(
      { accepted: true, ...(allowed ? {} : { retryAfterSeconds: 900 }) },
      requestId,
      202,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
