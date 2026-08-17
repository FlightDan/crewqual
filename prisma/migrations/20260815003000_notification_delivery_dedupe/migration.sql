ALTER TABLE "NotificationDelivery" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "NotificationDelivery_dedupeKey_key"
  ON "NotificationDelivery"("dedupeKey");
