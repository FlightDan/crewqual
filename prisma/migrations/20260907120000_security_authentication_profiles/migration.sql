CREATE TYPE "AuthenticationPreset" AS ENUM ('ENHANCED_L3', 'COMBINED_L2', 'CONVENIENCE');
CREATE TYPE "MemberLoginMode" AS ENUM ('PASSWORD_TOTP', 'PASSWORD_FIDO2', 'SMS_LINK');
CREATE TYPE "WebAuthnChallengeKind" AS ENUM ('ADMIN_REGISTRATION', 'ADMIN_AUTHENTICATION', 'PILOT_REGISTRATION', 'PILOT_AUTHENTICATION');

ALTER TABLE "Pilot"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordSetAt" TIMESTAMPTZ(3),
  ADD COLUMN "totpSecretCiphertext" TEXT,
  ADD COLUMN "totpVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastTotpCounter" BIGINT,
  ADD COLUMN "antiphishingCodeHash" TEXT;

ALTER TABLE "AdminUser"
  ADD COLUMN "antiphishingCodeHash" TEXT;

ALTER TABLE "PilotSession"
  ADD COLUMN "authState" TEXT NOT NULL DEFAULT 'AUTHENTICATED',
  ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PilotAccessToken"
  ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "AdminSession"
  ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SecurityPolicy"
  ADD COLUMN "authenticationPreset" "AuthenticationPreset" NOT NULL DEFAULT 'CONVENIENCE',
  ADD COLUMN "memberLoginMode" "MemberLoginMode" NOT NULL DEFAULT 'SMS_LINK',
  ADD COLUMN "adminFido2Required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "memberFido2Required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "highRiskReauthEnabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "SecurityPolicy" SET "pilotAccessLinkTtlMinutes" = LEAST("pilotAccessLinkTtlMinutes", 10);

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
JOIN "Permission" permission ON permission."code" = 'audit.read'
WHERE role."code" IN ('ADMIN', 'REVIEWER', 'VIEWER')
ON CONFLICT DO NOTHING;

CREATE TABLE "FidoCredential" (
  "id" UUID NOT NULL,
  "credentialId" TEXT NOT NULL,
  "publicKey" BYTEA NOT NULL,
  "counter" INTEGER NOT NULL DEFAULT 0,
  "transports" JSONB,
  "deviceType" TEXT NOT NULL DEFAULT 'singleDevice',
  "backedUp" BOOLEAN NOT NULL DEFAULT false,
  "userVerified" BOOLEAN NOT NULL DEFAULT false,
  "label" TEXT NOT NULL DEFAULT '',
  "adminUserId" UUID,
  "pilotId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMPTZ(3),
  CONSTRAINT "FidoCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FidoCredential_credentialId_key" UNIQUE ("credentialId"),
  CONSTRAINT "FidoCredential_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FidoCredential_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FidoCredential_adminUserId_idx" ON "FidoCredential"("adminUserId");
CREATE INDEX "FidoCredential_pilotId_idx" ON "FidoCredential"("pilotId");

CREATE TABLE "WebAuthnChallenge" (
  "id" UUID NOT NULL,
  "challenge" TEXT NOT NULL,
  "kind" "WebAuthnChallengeKind" NOT NULL,
  "adminUserId" UUID,
  "pilotId" UUID,
  "sessionId" TEXT,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebAuthnChallenge_challenge_key" UNIQUE ("challenge"),
  CONSTRAINT "WebAuthnChallenge_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WebAuthnChallenge_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WebAuthnChallenge_adminUserId_expiresAt_idx" ON "WebAuthnChallenge"("adminUserId", "expiresAt");
CREATE INDEX "WebAuthnChallenge_pilotId_expiresAt_idx" ON "WebAuthnChallenge"("pilotId", "expiresAt");
CREATE INDEX "WebAuthnChallenge_expiresAt_idx" ON "WebAuthnChallenge"("expiresAt");

CREATE TABLE "AdminPasswordResetToken" (
  "id" UUID NOT NULL,
  "adminUserId" UUID NOT NULL,
  "createdById" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenCiphertext" TEXT,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "policyVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminPasswordResetToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminPasswordResetToken_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "AdminPasswordResetToken_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AdminPasswordResetToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AdminPasswordResetToken_adminUserId_expiresAt_idx" ON "AdminPasswordResetToken"("adminUserId", "expiresAt");
CREATE INDEX "AdminPasswordResetToken_createdById_createdAt_idx" ON "AdminPasswordResetToken"("createdById", "createdAt");
