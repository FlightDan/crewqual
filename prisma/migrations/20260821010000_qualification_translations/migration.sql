ALTER TABLE "QualificationType" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';

UPDATE "QualificationType"
SET "translations" = jsonb_build_object('zh-CN', "name")
WHERE "translations" = '{}'::jsonb;

WITH core_translations (code, english_name) AS (
  VALUES
    ('medical-certificate', 'Civil Aviation Personnel Medical Certificate'),
    ('annual-recurrent-training', 'Annual Recurrent Training Certificate'),
    ('dangerous-goods-training', 'Dangerous Goods Transportation Training Certificate'),
    ('icao-english-endorsement', 'ICAO English Language Proficiency Endorsement'),
    ('chinese-language-assessment', 'ICAO Chinese Language Proficiency Endorsement'),
    ('simulator-recurrent-training', 'Simulator Recurrent Training (Every 6 Months)')
)
UPDATE "QualificationType" AS qualification
SET "translations" = jsonb_set(
  CASE
    WHEN jsonb_typeof(qualification."translations") = 'object' THEN qualification."translations"
    ELSE '{}'::jsonb
  END,
  '{en-US}',
  to_jsonb(core.english_name),
  true
)
FROM core_translations AS core
WHERE qualification."code" = core.code
  AND NOT (qualification."translations" ? 'en-US');

WITH core_translations (code, english_name) AS (
  VALUES
    ('medical-certificate', 'Civil Aviation Personnel Medical Certificate'),
    ('annual-recurrent-training', 'Annual Recurrent Training Certificate'),
    ('dangerous-goods-training', 'Dangerous Goods Transportation Training Certificate'),
    ('icao-english-endorsement', 'ICAO English Language Proficiency Endorsement'),
    ('chinese-language-assessment', 'ICAO Chinese Language Proficiency Endorsement'),
    ('simulator-recurrent-training', 'Simulator Recurrent Training (Every 6 Months)')
)
UPDATE "QualificationDefinition" AS qualification
SET "translations" = jsonb_set(
  jsonb_set(
    CASE
      WHEN jsonb_typeof(qualification."translations") = 'object' THEN qualification."translations"
      ELSE '{}'::jsonb
    END,
    '{zh-CN}',
    to_jsonb(qualification."name"),
    true
  ),
  '{en-US}',
  to_jsonb(core.english_name),
  true
)
FROM core_translations AS core
WHERE qualification."code" = core.code
  AND (
    NOT (qualification."translations" ? 'zh-CN')
    OR NOT (qualification."translations" ? 'en-US')
  );
