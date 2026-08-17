CREATE TABLE "WorkerHeartbeat" (
  "name" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "version" TEXT NOT NULL,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("name")
);
