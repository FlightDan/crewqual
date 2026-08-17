-- Abort before changing data if one image currently participates in multiple
-- evidence relations. An operator must merge those rows deliberately first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "QualificationEvidence"
    GROUP BY "evidenceImageId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate QualificationEvidence rows found for one EvidenceImage';
  END IF;
END $$;

-- Historical rows predate immutable snapshots. They are explicitly marked as
-- inferred so a pending request cannot be mistaken for a captured submission
-- snapshot and auto-approved.
UPDATE "QualificationRecord" AS record
SET "qualificationRuleSnapshot" = jsonb_build_object(
  'snapshotSource', 'inferred_backfill',
  'version', type."version",
  'validityRule', type."validityRule",
  'reminders', type."reminders",
  'parameterRestriction', type."parameterRestriction",
  'ocrChecks', type."ocrChecks"
)
FROM "QualificationType" AS type
WHERE record."qualificationTypeId" = type."id"
  AND record."qualificationRuleSnapshot" IS NULL;

UPDATE "QualificationUpdateRequest" AS request
SET "qualificationRuleSnapshot" = jsonb_build_object(
  'snapshotSource', 'inferred_backfill',
  'version', type."version",
  'validityRule', type."validityRule",
  'reminders', type."reminders",
  'parameterRestriction', type."parameterRestriction",
  'ocrChecks', type."ocrChecks"
)
FROM "QualificationType" AS type
WHERE request."qualificationTypeId" = type."id"
  AND request."qualificationRuleSnapshot" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "QualificationRecord" WHERE "qualificationRuleSnapshot" IS NULL)
     OR EXISTS (
       SELECT 1 FROM "QualificationUpdateRequest" WHERE "qualificationRuleSnapshot" IS NULL
     ) THEN
    RAISE EXCEPTION 'qualification rule snapshot backfill incomplete';
  END IF;
END $$;

ALTER TABLE "QualificationRecord"
  ALTER COLUMN "qualificationRuleSnapshot" SET NOT NULL;

ALTER TABLE "QualificationUpdateRequest"
  ALTER COLUMN "qualificationRuleSnapshot" SET NOT NULL;

CREATE UNIQUE INDEX "QualificationEvidence_evidenceImageId_key"
  ON "QualificationEvidence"("evidenceImageId");
