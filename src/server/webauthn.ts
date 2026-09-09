import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/server/api";
import { getServerConfig } from "@/server/config";
import { getPrisma } from "@/server/prisma";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function transports(value: unknown): AuthenticatorTransportFuture[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<AuthenticatorTransportFuture>([
    "ble",
    "hybrid",
    "internal",
    "nfc",
    "smart-card",
    "usb",
  ]);
  const result = value.filter(
    (item): item is AuthenticatorTransportFuture =>
      typeof item === "string" && allowed.has(item as AuthenticatorTransportFuture),
  );
  return result.length ? result : undefined;
}

function relyingParty() {
  const origin = getServerConfig().APP_ORIGIN;
  const url = new URL(origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new ApiError("WEBAUTHN_REQUIRES_HTTPS", "FIDO2 登录需要 HTTPS 安全上下文", 422);
  }
  return { origin, rpID: url.hostname };
}

function userId(value: string) {
  return new TextEncoder().encode(value);
}

export async function createRegistrationOptions(input: {
  kind: "ADMIN_REGISTRATION" | "PILOT_REGISTRATION";
  ownerId: string;
  userName: string;
  displayName: string;
  existingCredentialIds?: string[];
}) {
  const { origin, rpID } = relyingParty();
  const db = getPrisma();
  const options = await generateRegistrationOptions({
    rpName: "CrewQual",
    rpID,
    userID: userId(input.ownerId),
    userName: input.userName,
    userDisplayName: input.displayName,
    timeout: 60_000,
    attestationType: "none",
    preferredAuthenticatorType: "securityKey",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
      authenticatorAttachment: "cross-platform",
    },
    excludeCredentials: (input.existingCredentialIds ?? []).map((id) => ({ id })),
  });
  const challengeId = randomUUID();
  await db.webAuthnChallenge.create({
    data: {
      id: challengeId,
      challenge: options.challenge,
      kind: input.kind,
      adminUserId: input.kind === "ADMIN_REGISTRATION" ? input.ownerId : undefined,
      pilotId: input.kind === "PILOT_REGISTRATION" ? input.ownerId : undefined,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return { options, challengeId, origin };
}

export async function verifyRegistration(input: {
  kind: "ADMIN_REGISTRATION" | "PILOT_REGISTRATION";
  ownerId: string;
  challengeId: string;
  response: RegistrationResponseJSON;
  label?: string;
}) {
  const { origin, rpID } = relyingParty();
  const db = getPrisma();
  const challenge = await db.webAuthnChallenge.findFirst({
    where: {
      id: input.challengeId,
      kind: input.kind,
      ...(input.kind === "ADMIN_REGISTRATION"
        ? { adminUserId: input.ownerId }
        : { pilotId: input.ownerId }),
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) throw new ApiError("WEBAUTHN_CHALLENGE_INVALID", "FIDO2 注册请求已失效", 401);
  const options = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!options.verified)
    throw new ApiError("WEBAUTHN_REGISTRATION_FAILED", "FIDO2 注册验证失败", 422);
  const info = options.registrationInfo;
  if (info.credentialDeviceType !== "singleDevice" || info.credentialBackedUp) {
    throw new ApiError("WEBAUTHN_HARDWARE_REQUIRED", "增强认证只接受不可同步的单设备安全钥匙", 422);
  }
  await db.$transaction(async (tx) => {
    const consumed = await tx.webAuthnChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new ApiError("WEBAUTHN_CHALLENGE_REPLAYED", "FIDO2 注册请求已使用", 401);
    }
    await tx.fidoCredential.create({
      data: {
        id: randomUUID(),
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: info.credential.counter,
        userVerified: info.userVerified,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        label: input.label?.trim().slice(0, 128) ?? "",
        adminUserId: input.kind === "ADMIN_REGISTRATION" ? input.ownerId : undefined,
        pilotId: input.kind === "PILOT_REGISTRATION" ? input.ownerId : undefined,
      },
    });
  });
  return { verified: true, credentialId: info.credential.id };
}

export async function createAuthenticationOptions(input: {
  kind: "ADMIN_AUTHENTICATION" | "PILOT_AUTHENTICATION";
  ownerId?: string;
  sessionId?: string;
}) {
  const { rpID } = relyingParty();
  const db = getPrisma();
  const credentials = input.ownerId
    ? await db.fidoCredential.findMany({
        where:
          input.kind === "ADMIN_AUTHENTICATION"
            ? { adminUserId: input.ownerId }
            : { pilotId: input.ownerId },
        select: { credentialId: true, transports: true },
      })
    : [];
  if (!credentials.length) throw new ApiError("FIDO2_NOT_REGISTERED", "尚未绑定 FIDO2 验证器", 422);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    timeout: 60_000,
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: transports(credential.transports),
    })),
  });
  const challengeId = randomUUID();
  await db.webAuthnChallenge.create({
    data: {
      id: challengeId,
      challenge: options.challenge,
      kind: input.kind,
      adminUserId: input.kind === "ADMIN_AUTHENTICATION" ? input.ownerId : undefined,
      pilotId: input.kind === "PILOT_AUTHENTICATION" ? input.ownerId : undefined,
      sessionId: input.sessionId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return { options, challengeId };
}

export async function verifyAuthentication(input: {
  kind: "ADMIN_AUTHENTICATION" | "PILOT_AUTHENTICATION";
  ownerId: string;
  challengeId: string;
  sessionId?: string;
  response: AuthenticationResponseJSON;
}) {
  const { origin, rpID } = relyingParty();
  const db = getPrisma();
  const credentialId = input.response.id;
  const credential = await db.fidoCredential.findFirst({
    where: {
      credentialId,
      ...(input.kind === "ADMIN_AUTHENTICATION"
        ? { adminUserId: input.ownerId }
        : { pilotId: input.ownerId }),
    },
  });
  if (!credential) throw new ApiError("WEBAUTHN_CREDENTIAL_INVALID", "FIDO2 验证器未绑定", 401);
  const challenge = await db.webAuthnChallenge.findFirst({
    where: {
      id: input.challengeId,
      kind: input.kind,
      challenge: { not: "" },
      ...(input.kind === "ADMIN_AUTHENTICATION"
        ? { adminUserId: input.ownerId }
        : { pilotId: input.ownerId }),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) throw new ApiError("WEBAUTHN_CHALLENGE_INVALID", "FIDO2 验证请求已失效", 401);
  const verified = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: credential.credentialId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: transports(credential.transports),
    },
  });
  if (!verified.verified)
    throw new ApiError("WEBAUTHN_AUTHENTICATION_FAILED", "FIDO2 验证失败", 401);
  await db.$transaction(async (tx) => {
    const consumed = await tx.webAuthnChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new ApiError("WEBAUTHN_CHALLENGE_REPLAYED", "FIDO2 验证请求已使用", 401);
    await tx.fidoCredential.update({
      where: { id: credential.id },
      data: {
        counter: verified.authenticationInfo.newCounter,
        userVerified: verified.authenticationInfo.userVerified,
        lastUsedAt: new Date(),
      },
    });
  });
  return verified.authenticationInfo;
}
