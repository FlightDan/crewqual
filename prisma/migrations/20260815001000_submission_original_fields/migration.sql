ALTER TABLE "QualificationUpdateRequest"
  ADD COLUMN "submittedFields" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Existing rows were created before the immutable submission snapshot existed.
-- Backfill them from the values currently stored on the request so the new
-- contract is valid for every row without inventing user data.
UPDATE "QualificationUpdateRequest"
SET "submittedFields" = jsonb_build_object(
  'credentialNumber', "credentialNumber",
  'issueDate', to_char("issueDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
  'expiryDate', CASE WHEN "expiryDate" IS NULL THEN '' ELSE to_char("expiryDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD') END,
  'issuingAuthority', "issuingAuthority",
  'levelOrParameter', "levelOrParameter"
)
WHERE "submittedFields" = '{}'::jsonb;
