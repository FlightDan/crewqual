CREATE TABLE "MediaOptimizationSetting" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "idleMinutes" INTEGER NOT NULL DEFAULT 5,
  "batchSize" INTEGER NOT NULL DEFAULT 5,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "MediaOptimizationSetting_pkey" PRIMARY KEY ("id")
);
