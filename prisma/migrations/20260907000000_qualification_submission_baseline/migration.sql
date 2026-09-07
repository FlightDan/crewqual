-- Do not infer historical submission baselines from current records.
ALTER TABLE "QualificationUpdateRequest"
  ADD COLUMN IF NOT EXISTS "expectedQualificationRecordId" UUID,
  ADD COLUMN IF NOT EXISTS "baselineCapturedAt" TIMESTAMPTZ(3);

-- Old installs may have a standalone unique index, not a table constraint.
-- Evidence can be shared across revisions; pair-level uniqueness remains intact.
ALTER TABLE "QualificationEvidence"
  DROP CONSTRAINT IF EXISTS "QualificationEvidence_evidenceImageId_key";
DROP INDEX IF EXISTS "QualificationEvidence_evidenceImageId_key";

-- The original three-column key allows duplicates when either link is null.
-- Fail for manual reconciliation if an install already has duplicate links.
CREATE UNIQUE INDEX IF NOT EXISTS "QualificationEvidence_image_record_key"
  ON "QualificationEvidence" ("evidenceImageId", "qualificationRecordId");
CREATE UNIQUE INDEX IF NOT EXISTS "QualificationEvidence_image_request_key"
  ON "QualificationEvidence" ("evidenceImageId", "updateRequestId");
