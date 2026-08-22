CREATE TYPE "ObjectStorageProvider" AS ENUM ('BUILTIN', 'S3');

CREATE TABLE "ObjectStorageSetting" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "provider" "ObjectStorageProvider" NOT NULL DEFAULT 'BUILTIN',
    "endpoint" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT 'us-east-1',
    "bucket" TEXT NOT NULL DEFAULT '',
    "credentialsCiphertext" TEXT,
    "forcePathStyle" BOOLEAN NOT NULL DEFAULT false,
    "sseKmsKeyId" TEXT NOT NULL DEFAULT '',
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT NOT NULL DEFAULT '',
    "lastTestedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectStorageSetting_pkey" PRIMARY KEY ("id")
);
