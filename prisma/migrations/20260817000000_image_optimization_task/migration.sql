CREATE TYPE "ImageOptimizationTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "ImageOptimizationTask" (
  "id" UUID NOT NULL,
  "evidenceImageId" UUID NOT NULL,
  "sourceObjectKey" TEXT NOT NULL,
  "targetObjectKey" TEXT,
  "status" "ImageOptimizationTaskStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ImageOptimizationTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImageOptimizationTask_evidenceImageId_key" UNIQUE ("evidenceImageId"),
  CONSTRAINT "ImageOptimizationTask_evidenceImageId_fkey" FOREIGN KEY ("evidenceImageId") REFERENCES "EvidenceImage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ImageOptimizationTask_status_createdAt_idx" ON "ImageOptimizationTask"("status", "createdAt");
