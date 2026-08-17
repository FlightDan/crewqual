CREATE TYPE "NotificationType" AS ENUM (
  'QUALIFICATION_EXPIRY',
  'UPGRADE_STAGE_REMINDER',
  'STAGE_DATE_CHANGED',
  'STAGE_COMPLETED',
  'REVIEW_RETURNED',
  'REVIEW_APPROVED',
  'UPGRADE_CREATED',
  'UPGRADE_RESUMED',
  'DELIVERY_FAILED',
  'PILOT_ACCESS_LINK'
);

ALTER TABLE "OrganizationUnit"
  ADD COLUMN "notificationChannelState" JSONB NOT NULL
  DEFAULT '{"inApp":true,"sms":false,"feishu":false}'::jsonb;

ALTER TABLE "NotificationDelivery"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING upper("type")::"NotificationType",
  ADD COLUMN "readAt" TIMESTAMP(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retryLimit" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "retryCycle" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastErrorCategory" TEXT,
  ADD COLUMN "finalFailureReason" TEXT,
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "securePayloadCiphertext" TEXT,
  ADD COLUMN "securePayloadExpiresAt" TIMESTAMP(3);

ALTER TABLE "NotificationAttempt"
  ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "retryCycle" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "errorCategory" TEXT;

CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx"
  ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_pilotId_readAt_createdAt_idx"
  ON "NotificationDelivery"("pilotId", "readAt", "createdAt");
