-- trainingDate is a civil business date and deliberately uses PostgreSQL DATE.
-- Existing rows remain NULL; no timestamp-to-date conversion is required.
ALTER TABLE "QualificationRecord"
  ADD COLUMN "trainingDate" DATE;

ALTER TABLE "QualificationUpdateRequest"
  ADD COLUMN "trainingDate" DATE;

-- Post-migration verification (must return zero invalid rows):
-- SELECT count(*) FROM "QualificationRecord"
-- WHERE "trainingDate" IS NOT NULL
--   AND "trainingDate"::text !~ '^\d{4}-\d{2}-\d{2}$';
