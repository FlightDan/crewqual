CREATE TYPE "SecuritySignalKind" AS ENUM (
  'AUTH_FAILURE',
  'AUTH_RATE_LIMIT',
  'AUTH_SUCCESS',
  'AUTHORIZATION_DENIED',
  'CSRF_DENIED',
  'KNOWN_PROBE',
  'UNKNOWN_ROUTE',
  'INVALID_METHOD',
  'RESOURCE_NOT_FOUND',
  'PUBLIC_ACCESS_DENIED'
);

CREATE TYPE "SecurityDetectionCategory" AS ENUM (
  'PUBLIC_SCAN',
  'CREDENTIAL_STUFFING',
  'DISTRIBUTED_LOGIN_ATTEMPT'
);

ALTER TABLE "AdminUser"
  ADD COLUMN "lastSuccessfulLoginAt" TIMESTAMPTZ(3);

ALTER TABLE "AdminSession"
  ADD COLUMN "securitySummarySince" TIMESTAMPTZ(3),
  ADD COLUMN "securitySummaryUntil" TIMESTAMPTZ(3);

ALTER TABLE "EvidenceImage"
  ADD COLUMN IF NOT EXISTS "storageEncodingVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sanitizedAt" TIMESTAMPTZ(3);

CREATE TABLE "SecuritySignalBucket" (
  "id" UUID NOT NULL,
  "kind" "SecuritySignalKind" NOT NULL,
  "bucketStart" TIMESTAMPTZ(3) NOT NULL,
  "keyVersion" INTEGER NOT NULL DEFAULT 1,
  "dimensionKey" TEXT NOT NULL,
  "sourceHash" TEXT,
  "maskedSource" TEXT NOT NULL DEFAULT '来源不可判定',
  "accountHash" TEXT,
  "adminUserId" UUID,
  "pilotId" UUID,
  "personId" UUID,
  "unitId" UUID,
  "organizationId" UUID,
  "routeClass" TEXT,
  "pathHash" TEXT,
  "outcome" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "sampleRequestId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SecuritySignalBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecuritySignalBucket_bucketStart_kind_keyVersion_dimensionKey_key"
  ON "SecuritySignalBucket"("bucketStart", "kind", "keyVersion", "dimensionKey");
CREATE INDEX "SecuritySignalBucket_bucketStart_idx" ON "SecuritySignalBucket"("bucketStart");
CREATE INDEX "SecuritySignalBucket_kind_bucketStart_idx" ON "SecuritySignalBucket"("kind", "bucketStart");
CREATE INDEX "SecuritySignalBucket_sourceHash_bucketStart_idx" ON "SecuritySignalBucket"("sourceHash", "bucketStart");
CREATE INDEX "SecuritySignalBucket_accountHash_bucketStart_idx" ON "SecuritySignalBucket"("accountHash", "bucketStart");

CREATE TABLE "SecuritySignalReceipt" (
  "id" UUID NOT NULL,
  "requestKey" TEXT NOT NULL,
  "signalBucketId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecuritySignalReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SecuritySignalReceipt_signalBucketId_fkey" FOREIGN KEY ("signalBucketId")
    REFERENCES "SecuritySignalBucket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SecuritySignalReceipt_requestKey_key" ON "SecuritySignalReceipt"("requestKey");
CREATE INDEX "SecuritySignalReceipt_expiresAt_idx" ON "SecuritySignalReceipt"("expiresAt");

CREATE TABLE "SecurityDetectionBucket" (
  "id" UUID NOT NULL,
  "category" "SecurityDetectionCategory" NOT NULL,
  "ruleVersion" INTEGER NOT NULL DEFAULT 1,
  "groupKey" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "windowStart" TIMESTAMPTZ(3) NOT NULL,
  "windowEnd" TIMESTAMPTZ(3) NOT NULL,
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "sourceCount" INTEGER NOT NULL DEFAULT 0,
  "accountCount" INTEGER NOT NULL DEFAULT 0,
  "pathCount" INTEGER NOT NULL DEFAULT 0,
  "truncatedByRetention" BOOLEAN NOT NULL DEFAULT false,
  "sample" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SecurityDetectionBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityDetectionBucket_dedupeKey_key" ON "SecurityDetectionBucket"("dedupeKey");
CREATE INDEX "SecurityDetectionBucket_category_firstSeenAt_idx" ON "SecurityDetectionBucket"("category", "firstSeenAt");
CREATE INDEX "SecurityDetectionBucket_lastSeenAt_idx" ON "SecurityDetectionBucket"("lastSeenAt");
CREATE INDEX "SecurityDetectionBucket_groupKey_lastSeenAt_idx" ON "SecurityDetectionBucket"("groupKey", "lastSeenAt");

CREATE TABLE "SecurityDetectionMembership" (
  "detectionBucketId" UUID NOT NULL,
  "signalBucketId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityDetectionMembership_pkey" PRIMARY KEY ("detectionBucketId", "signalBucketId"),
  CONSTRAINT "SecurityDetectionMembership_detectionBucketId_fkey" FOREIGN KEY ("detectionBucketId")
    REFERENCES "SecurityDetectionBucket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SecurityDetectionMembership_signalBucketId_fkey" FOREIGN KEY ("signalBucketId")
    REFERENCES "SecuritySignalBucket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SecurityDetectionMembership_signalBucketId_idx"
  ON "SecurityDetectionMembership"("signalBucketId");

CREATE TABLE "SecurityTelemetryState" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "processedThrough" TIMESTAMPTZ(3),
  "lastCollectedAt" TIMESTAMPTZ(3),
  "lastAggregatedAt" TIMESTAMPTZ(3),
  "collectionHealthy" BOOLEAN NOT NULL DEFAULT true,
  "droppedCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SecurityTelemetryState_pkey" PRIMARY KEY ("id")
);
