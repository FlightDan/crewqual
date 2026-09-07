-- Deployment prerequisite: stop ALL reminder and notification workers, drain
-- in-flight sends, apply this migration, then start only the updated workers.
-- A mixed-version worker rollout can recreate the obsolete expired key.
-- No broad key version bump: genuine expired/first/second windows stay deduped.
BEGIN;
LOCK TABLE "NotificationDelivery" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE qualification_same_day_reminders ON COMMIT DROP AS
SELECT "id", "dedupeKey", "templateKey", "templateParams", "status",
       regexp_replace("dedupeKey", '^(qualification-expiry:[^:]+):expired:', '\1:today:') AS "newKey"
FROM "NotificationDelivery"
WHERE "dedupeKey" ~ '^qualification-expiry:[^:]+:expired:'
  AND "templateKey" = 'qualification.expiry.expired'
  AND "templateParams"->'daysRemaining' = '0'::jsonb;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM qualification_same_day_reminders WHERE "status" = 'SENDING') THEN
    RAISE EXCEPTION 'Same-day reminder repair requires drained notification workers (SENDING rows remain)';
  END IF;
  -- Do not merge/delete attempts or guess which duplicate reached a provider.
  -- Fail atomically for operator review if an earlier/manual rollout made both.
  IF EXISTS (
    SELECT 1 FROM qualification_same_day_reminders old
    JOIN "NotificationDelivery" target ON target."dedupeKey" = old."newKey"
  ) THEN
    RAISE EXCEPTION 'Same-day reminder repair found existing today keys; reconcile conflicting deliveries before retrying';
  END IF;
END $$;

INSERT INTO "AuditEvent" ("id", "actorType", "action", "entityType", "entityId", "detail", "requestId")
SELECT gen_random_uuid(), 'system', 'qualification_reminder_same_day_rekey',
       'NotificationDelivery', "id"::text,
       jsonb_build_object('oldDedupeKey', "dedupeKey", 'newDedupeKey', "newKey",
         'oldTemplateKey', "templateKey", 'oldTemplateParams', "templateParams",
         'oldStatus', "status", 'queuedTemplateUpdated', "status" = 'QUEUED'),
       'migration:20260907010000_qualification_reminder_today'
FROM qualification_same_day_reminders;

UPDATE "NotificationDelivery" delivery
SET "dedupeKey" = old."newKey",
    "templateKey" = CASE WHEN delivery."status" = 'QUEUED'
      THEN 'qualification.expiry.today' ELSE delivery."templateKey" END
FROM qualification_same_day_reminders old
WHERE delivery."id" = old."id";
-- Keep IDs, attempts, provider idempotency keys, sent history and retry state.
COMMIT;
