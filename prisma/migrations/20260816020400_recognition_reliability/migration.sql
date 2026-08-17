CREATE TYPE "RecognitionTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "RecognitionTaskType" AS ENUM ('EXTRACTION');

-- Preflight: old upload and submission paths could create duplicate tasks.
-- Preserve the oldest task and abort if more than one duplicate already has a
-- completed result, because choosing one automatically would lose evidence.
DO $$
BEGIN
  IF EXISTS (
    SELECT "evidenceImageId"
    FROM "RecognitionTask"
    WHERE status = 'completed'
    GROUP BY "evidenceImageId"
    HAVING count(DISTINCT result::text) > 1
  ) THEN
    RAISE EXCEPTION 'divergent completed recognition results exist for one evidence image';
  END IF;
END $$;

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY "evidenceImageId"
      ORDER BY (status = 'completed') DESC, "createdAt" ASC, id ASC
    ) AS position
  FROM "RecognitionTask"
)
DELETE FROM "RecognitionTask"
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

ALTER TABLE "RecognitionTask"
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE "RecognitionTaskStatus"
    USING upper(status)::"RecognitionTaskStatus",
  ALTER COLUMN status SET DEFAULT 'QUEUED',
  ADD COLUMN "taskType" "RecognitionTaskType" NOT NULL DEFAULT 'EXTRACTION',
  ADD COLUMN "retryLimit" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'unconfigured';

CREATE UNIQUE INDEX "RecognitionTask_evidenceImageId_taskType_key"
  ON "RecognitionTask"("evidenceImageId", "taskType");
CREATE INDEX "RecognitionTask_status_startedAt_idx"
  ON "RecognitionTask"(status, "startedAt");
DROP INDEX IF EXISTS "RecognitionTask_status_createdAt_idx";

-- Keep only the latest verification per request before adding the uniqueness
-- guarantee used by worker replay/upsert.
DELETE FROM "VerificationResult" older
USING "VerificationResult" newer
WHERE older."requestId" = newer."requestId"
  AND (older."createdAt", older.id) < (newer."createdAt", newer.id);

CREATE UNIQUE INDEX "VerificationResult_requestId_key"
  ON "VerificationResult"("requestId");
