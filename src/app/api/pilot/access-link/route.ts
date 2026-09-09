import { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { createOpaqueToken, encryptSettingSecret, safeEqualHex, sha256 } from "@/server/crypto";
import { getServerConfig } from "@/server/config";
import { getPrisma } from "@/server/prisma";
import { enqueuePilotAccessSms } from "@/server/sms-outbox";
import { consumeRateLimit, requestAddress } from "@/server/rate-limit";
import { getRuntimeIntegration, getRuntimeSecurityPolicy } from "@/server/runtime-settings";
import { enqueueInTransaction, QUEUES } from "@/server/jobs";
import { normalizeAppLocale } from "@/lib/domain-i18n";
import { pilotHasFactors } from "@/server/auth";
import { recordPublicSecuritySignal } from "@/server/security-request";

const schema = z.object({
  employeeNumber: z.string().trim().min(1).max(64),
  mobile: z.string().regex(/^\d{11}$/),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const input = await parseJson(request, schema);
    const accountIdentifier = `member:${input.employeeNumber.trim().toLowerCase()}`;
    const address = requestAddress(request);
    const [addressAllowed, employeeAllowed, mobileAllowed] = await Promise.all([
      consumeRateLimit(`pilot-access:address:${address}`, 5, 15 * 60 * 1000),
      consumeRateLimit(
        `pilot-access:employee:${input.employeeNumber.toLowerCase()}`,
        3,
        15 * 60 * 1000,
      ),
      consumeRateLimit(`pilot-access:mobile:${sha256(input.mobile)}`, 3, 15 * 60 * 1000),
    ]);
    const allowed = addressAllowed && employeeAllowed && mobileAllowed;
    const policy = await getRuntimeSecurityPolicy();
    if (!allowed) {
      await recordPublicSecuritySignal(request, {
        kind: "AUTH_RATE_LIMIT",
        accountIdentifier,
        outcome: "RATE_LIMITED",
      }).catch(() => undefined);
      return jsonData({ accepted: true, retryAfterSeconds: 900 }, requestId, 202);
    }
    const db = getPrisma();
    const pilot = await db.pilot.findUnique({
      where: { employeeNumber: input.employeeNumber },
      include: { unit: { include: { organization: true } } },
    });
    const matches = Boolean(
      pilot && pilot.active && safeEqualHex(sha256(pilot.mobile), sha256(input.mobile)),
    );
    if (!matches) {
      await recordPublicSecuritySignal(request, {
        kind: "AUTH_FAILURE",
        accountIdentifier,
        identity: pilot
          ? {
              pilotId: pilot.id,
              personId: pilot.personId,
              unitId: pilot.unitId,
              organizationId: pilot.unit.organizationId,
            }
          : undefined,
        outcome: "INVALID_CREDENTIALS",
      }).catch(() => undefined);
    }
    if (matches && pilot) {
      // A magic link is only an enrollment bootstrap for accounts that have no
      // existing factors. Once a member has a password, TOTP, or FIDO key,
      // SMS must never become a recovery or downgrade path.
      if (
        policy.memberLoginMode &&
        policy.memberLoginMode !== "SMS_LINK" &&
        (await pilotHasFactors(pilot.id)).any
      ) {
        return jsonData({ accepted: true }, requestId, 202);
      }
      const sms = await getRuntimeIntegration("sms");
      if (!sms.enabled || sms.adapter === "disabled") {
        return jsonData({ accepted: true }, requestId, 202);
      }
      const existingToken = await db.pilotAccessToken.findFirst({
        where: {
          pilotId: pilot.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          policyVersion: policy.policyVersion,
        },
      });
      // Keep a previously issued link valid; repeated requests must not silently
      // invalidate a link that may already be queued at the SMS provider.
      if (existingToken) return jsonData({ accepted: true }, requestId, 202);
      const rawToken = createOpaqueToken();
      const ttlMinutes = Math.min(policy.pilotAccessLinkTtlMinutes, 10);
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
      await db.$transaction(async (tx) => {
        await tx.pilotAccessToken.deleteMany({
          where: { pilotId: pilot.id, consumedAt: null, expiresAt: { lte: new Date() } },
        });
        const accessToken = await tx.pilotAccessToken.create({
          data: {
            pilotId: pilot.id,
            tokenHash: sha256(rawToken),
            expiresAt,
            policyVersion: policy.policyVersion,
          },
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
            locale: normalizeAppLocale(pilot.unit.organization?.defaultLocale),
            templateKey: "pilot.access_link",
            templateParams: { ttlMinutes },
            retryLimit: sms.retryLimit,
            securePayloadCiphertext: encryptSettingSecret(
              JSON.stringify({ token: rawToken, ttlMinutes }),
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
      const config = getServerConfig();
      if (config.SMS_ADAPTER === "fake") enqueuePilotAccessSms(pilot.mobile, rawToken);
    }
    return jsonData(
      { accepted: true, ...(allowed ? {} : { retryAfterSeconds: 900 }) },
      requestId,
      202,
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
    ) {
      return jsonData({ accepted: true }, requestId, 202);
    }
    return jsonError(error, requestId, request);
  }
}
