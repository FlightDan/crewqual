-- Preserve existing naive timestamps as UTC instants and refuse to truncate
-- any business-date value that contains a meaningful time component.
SET LOCAL TIME ZONE 'UTC';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "QualificationRecord" WHERE "issueDate"::time <> TIME '00:00:00')
    OR EXISTS (SELECT 1 FROM "QualificationRecord" WHERE "expiryDate" IS NOT NULL AND "expiryDate"::time <> TIME '00:00:00')
    OR EXISTS (SELECT 1 FROM "QualificationUpdateRequest" WHERE "issueDate"::time <> TIME '00:00:00')
    OR EXISTS (SELECT 1 FROM "QualificationUpdateRequest" WHERE "expiryDate" IS NOT NULL AND "expiryDate"::time <> TIME '00:00:00')
    OR EXISTS (SELECT 1 FROM "UpgradePlan" WHERE "startDate"::time <> TIME '00:00:00' OR "endDate"::time <> TIME '00:00:00')
    OR EXISTS (SELECT 1 FROM "UpgradeStage" WHERE "plannedStart"::time <> TIME '00:00:00' OR "plannedEnd"::time <> TIME '00:00:00' OR ("completedOn" IS NOT NULL AND "completedOn"::time <> TIME '00:00:00'))
  THEN
    RAISE EXCEPTION 'date semantics migration blocked: non-midnight business date found';
  END IF;
END $$;

DROP INDEX IF EXISTS "NotificationDelivery_status_startedAt_idx";

ALTER TABLE "AdminSession" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "lastSeenAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "AdminUser" ALTER COLUMN "lockedUntil" TYPE TIMESTAMPTZ(3), ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "AuditEvent" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "EvidenceImage" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "linkedAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "InspectionItem" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "updatedAt" DROP DEFAULT, ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "NotificationAttempt" ALTER COLUMN "attemptedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "NotificationDelivery" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "sentAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "readAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "nextAttemptAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "securePayloadExpiresAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "OrganizationUnit" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "Pilot" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "PilotAccessToken" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "consumedAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "PilotSession" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "lastSeenAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "QualificationEvidence" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "QualificationRecord" ALTER COLUMN "issueDate" TYPE DATE, ALTER COLUMN "expiryDate" TYPE DATE, ALTER COLUMN "lastVerifiedAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "QualificationType" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "QualificationUpdateRequest" ALTER COLUMN "issueDate" TYPE DATE, ALTER COLUMN "expiryDate" TYPE DATE, ALTER COLUMN "submittedAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "decidedAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "submittedFields" DROP DEFAULT;
ALTER TABLE "RateLimitBucket" ALTER COLUMN "windowStart" TYPE TIMESTAMPTZ(3), ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "RecognitionTask" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "SecurityPolicy" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "SystemIntegrationSetting" ALTER COLUMN "lastTestedAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "UpgradePlan" ALTER COLUMN "startDate" TYPE DATE, ALTER COLUMN "endDate" TYPE DATE, ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3), ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "UpgradePlanInspectionItem" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "UpgradeStage" ALTER COLUMN "plannedStart" TYPE DATE, ALTER COLUMN "plannedEnd" TYPE DATE, ALTER COLUMN "completedOn" TYPE DATE;
ALTER TABLE "VerificationResult" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
