-- Persist stable domain identifiers and locale-aware notification templates.

UPDATE "Pilot"
SET "role" = CASE
  WHEN "role" IN ('机长', 'CAPTAIN') THEN 'CAPTAIN'
  WHEN "role" IN ('副驾驶', 'FIRST_OFFICER') THEN 'FIRST_OFFICER'
  ELSE "role"
END;
ALTER TABLE "Pilot" RENAME COLUMN "role" TO "roleCode";

UPDATE "PilotProfile"
SET "dutyLabel" = CASE
  WHEN "dutyLabel" IN ('机长', 'CAPTAIN') THEN 'CAPTAIN'
  WHEN "dutyLabel" IN ('副驾驶', 'FIRST_OFFICER') THEN 'FIRST_OFFICER'
  ELSE "dutyLabel"
END;

ALTER TABLE "PilotProfile" RENAME COLUMN "dutyLabel" TO "dutyCode";

ALTER TABLE "UpgradeStage" RENAME COLUMN "name" TO "code";
UPDATE "UpgradeStage"
SET "code" = CASE "order"
  WHEN 0 THEN 'THEORY_ORAL'
  WHEN 1 THEN 'SQUADRON_ASSESSMENT'
  WHEN 2 THEN 'GROUP_ASSESSMENT'
  WHEN 3 THEN 'SIMULATOR_CHECK'
  WHEN 4 THEN 'LINE_CHECK'
  WHEN 5 THEN 'PRACTICAL_EXAM'
  ELSE "code"
END;

ALTER TABLE "Pilot"
  ADD CONSTRAINT "Pilot_role_code_check"
  CHECK ("roleCode" IN ('CAPTAIN', 'FIRST_OFFICER'));
ALTER TABLE "PilotProfile"
  ADD CONSTRAINT "PilotProfile_dutyCode_check"
  CHECK ("dutyCode" IN ('CAPTAIN', 'FIRST_OFFICER'));
ALTER TABLE "UpgradeStage"
  ADD CONSTRAINT "UpgradeStage_code_check"
  CHECK ("code" IN (
    'THEORY_ORAL',
    'SQUADRON_ASSESSMENT',
    'GROUP_ASSESSMENT',
    'SIMULATOR_CHECK',
    'LINE_CHECK',
    'PRACTICAL_EXAM'
  ));
CREATE UNIQUE INDEX "UpgradeStage_planId_code_key"
  ON "UpgradeStage"("planId", "code");

ALTER TABLE "NotificationDelivery"
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'zh-CN',
  ADD COLUMN "templateKey" TEXT,
  ADD COLUMN "templateParams" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "NotificationDelivery"
SET
  "templateKey" = 'legacy.raw',
  "templateParams" = jsonb_build_object('summary', "summary", 'message', "message");

ALTER TABLE "NotificationDelivery" ALTER COLUMN "templateKey" SET NOT NULL;
ALTER TABLE "NotificationDelivery" DROP COLUMN "summary";
ALTER TABLE "NotificationDelivery" DROP COLUMN "message";

CREATE INDEX "NotificationDelivery_templateKey_createdAt_idx"
  ON "NotificationDelivery"("templateKey", "createdAt");
