ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TABLE "NotificationDelivery" ADD COLUMN "startedAt" TIMESTAMP(3);
CREATE INDEX "NotificationDelivery_status_startedAt_idx"
  ON "NotificationDelivery" ("status", "startedAt");
