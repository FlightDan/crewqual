-- Preserve the legacy description as help text while making the executable
-- policy explicit. Legacy `enabled` never silently becomes an enforced rule.
UPDATE "QualificationType"
SET "parameterRestriction" = "parameterRestriction" || jsonb_build_object(
  'version', 1,
  'enforcement', jsonb_build_object(
    'mode', 'none',
    'allowedValues', jsonb_build_array(),
    'pattern', ''
  )
)
WHERE NOT ("parameterRestriction" ? 'version');

UPDATE "QualificationRecord"
SET "qualificationRuleSnapshot" = jsonb_set(
  "qualificationRuleSnapshot",
  '{parameterRestriction}',
  ("qualificationRuleSnapshot"->'parameterRestriction') || jsonb_build_object(
    'version', 1,
    'enforcement', jsonb_build_object(
      'mode', 'none',
      'allowedValues', jsonb_build_array(),
      'pattern', ''
    )
  )
)
WHERE NOT (("qualificationRuleSnapshot"->'parameterRestriction') ? 'version');

UPDATE "QualificationUpdateRequest"
SET "qualificationRuleSnapshot" = jsonb_set(
  "qualificationRuleSnapshot",
  '{parameterRestriction}',
  ("qualificationRuleSnapshot"->'parameterRestriction') || jsonb_build_object(
    'version', 1,
    'enforcement', jsonb_build_object(
      'mode', 'none',
      'allowedValues', jsonb_build_array(),
      'pattern', ''
    )
  )
)
WHERE NOT (("qualificationRuleSnapshot"->'parameterRestriction') ? 'version');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "QualificationType"
    WHERE NOT ("parameterRestriction" ? 'version')
  ) THEN
    RAISE EXCEPTION 'parameter restriction version backfill incomplete';
  END IF;
END $$;
