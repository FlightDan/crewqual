ALTER TABLE "OrganizationUnit"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  ADD COLUMN "contactName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "contactEmail" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "contactPhone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "notificationRouting" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "AdminUser"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "SystemIntegrationSetting" (
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "endpoint" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "secretCiphertext" TEXT,
  "timeoutSeconds" INTEGER NOT NULL DEFAULT 10,
  "retryLimit" INTEGER NOT NULL DEFAULT 3,
  "lastTestStatus" TEXT,
  "lastTestMessage" TEXT NOT NULL DEFAULT '',
  "lastTestedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemIntegrationSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "SecurityPolicy" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "requireTotp" BOOLEAN NOT NULL DEFAULT true,
  "adminSessionTtlHours" INTEGER NOT NULL DEFAULT 8,
  "pilotAccessLinkTtlMinutes" INTEGER NOT NULL DEFAULT 15,
  "pilotSessionTtlMinutes" INTEGER NOT NULL DEFAULT 60,
  "maxFailedAttempts" INTEGER NOT NULL DEFAULT 5,
  "lockoutMinutes" INTEGER NOT NULL DEFAULT 15,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityPolicy_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SecurityPolicy" (
  "id", "requireTotp", "adminSessionTtlHours", "pilotAccessLinkTtlMinutes",
  "pilotSessionTtlMinutes", "maxFailedAttempts", "lockoutMinutes", "updatedAt"
) VALUES ('global', true, 8, 15, 60, 5, 15, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

