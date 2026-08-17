CREATE TYPE "BackupSource" AS ENUM ('GALLERY', 'DATABASE');
CREATE TYPE "BackupMode" AS ENUM ('FULL', 'INCREMENTAL');
CREATE TYPE "BackupTargetType" AS ENUM ('LOCAL', 'SMB', 'FTP', 'WEBDAV', 'S3');
CREATE TYPE "BackupRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "BackupTarget" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "type" "BackupTargetType" NOT NULL,
  "endpoint" TEXT NOT NULL,
  "basePath" TEXT NOT NULL,
  "secretCiphertext" TEXT,
  "encryptionEnabled" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "lastTestedAt" TIMESTAMPTZ(3),
  "lastTestMessage" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BackupTarget_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BackupPlan" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "source" "BackupSource" NOT NULL,
  "mode" "BackupMode" NOT NULL,
  "targetId" UUID NOT NULL,
  "cron" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "retentionCount" INTEGER NOT NULL DEFAULT 30,
  "retentionDays" INTEGER NOT NULL DEFAULT 90,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "lastSuccessfulAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BackupPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackupPlan_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "BackupTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BackupPlan_enabled_source_idx" ON "BackupPlan"("enabled", "source");
CREATE TABLE "BackupRun" (
  "id" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "status" "BackupRunStatus" NOT NULL DEFAULT 'QUEUED',
  "mode" "BackupMode" NOT NULL,
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "artifactPath" TEXT,
  "manifestSha256" TEXT,
  "bytesWritten" BIGINT NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackupRun_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BackupPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BackupRun_planId_createdAt_idx" ON "BackupRun"("planId", "createdAt");
CREATE INDEX "BackupRun_status_createdAt_idx" ON "BackupRun"("status", "createdAt");
