-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AdminRoleCode" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "QualificationRecordStatus" AS ENUM ('ACTIVE', 'REPLACED');

-- CreateEnum
CREATE TYPE "UpdateRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('MATCHED', 'MISMATCH', 'UNCERTAIN', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "UpgradePlanType" AS ENUM ('CAPTAIN_UPGRADE', 'LEVEL_UPGRADE', 'QUALIFICATION_RECOVERY', 'INSTRUCTOR_UPGRADE', 'TYPE_RATING');

-- CreateEnum
CREATE TYPE "UpgradePlanStatus" AS ENUM ('DRAFT', 'NOT_STARTED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UpgradeStageStatus" AS ENUM ('COMPLETED', 'IN_PROGRESS', 'DELAYED', 'SCHEDULED', 'NOT_STARTED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('FEISHU', 'SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "OrganizationUnit" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pilot" (
    "id" UUID NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "aircraftType" TEXT NOT NULL,
    "rankLabel" TEXT NOT NULL,
    "unitId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pilot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "code" "AdminRoleCode" NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "unitId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "AdminUserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotAccessToken" (
    "id" UUID NOT NULL,
    "pilotId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotSession" (
    "id" UUID NOT NULL,
    "pilotId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationType" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "core" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "parameterRestriction" JSONB NOT NULL,
    "validityRule" JSONB NOT NULL,
    "reminders" JSONB NOT NULL,
    "ocrChecks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationRecord" (
    "id" UUID NOT NULL,
    "pilotId" UUID NOT NULL,
    "qualificationTypeId" UUID NOT NULL,
    "credentialNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "issuingAuthority" TEXT NOT NULL,
    "levelOrParameter" TEXT NOT NULL,
    "status" "QualificationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastVerifiedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceImage" (
    "id" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'orphaned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationEvidence" (
    "id" UUID NOT NULL,
    "evidenceImageId" UUID NOT NULL,
    "qualificationRecordId" UUID,
    "updateRequestId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualificationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationUpdateRequest" (
    "id" UUID NOT NULL,
    "pilotId" UUID NOT NULL,
    "qualificationTypeId" UUID NOT NULL,
    "qualificationRecordId" UUID,
    "credentialNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "issuingAuthority" TEXT NOT NULL,
    "levelOrParameter" TEXT NOT NULL,
    "status" "UpdateRequestStatus" NOT NULL DEFAULT 'PENDING',
    "expectedVersion" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "returnReason" TEXT,

    CONSTRAINT "QualificationUpdateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationResult" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "result" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecognitionTask" (
    "id" UUID NOT NULL,
    "evidenceImageId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RecognitionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpgradePlan" (
    "id" UUID NOT NULL,
    "planNumber" TEXT NOT NULL,
    "pilotId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "UpgradePlanType" NOT NULL,
    "lifecycleStatus" "UpgradePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "overallOwner" TEXT NOT NULL,
    "leadDepartment" TEXT NOT NULL,
    "supplementalRequirements" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpgradePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpgradeStage" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UpgradeStageStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3) NOT NULL,
    "owner" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "completedOn" TIMESTAMP(3),
    "resultSummary" TEXT,
    "delayDays" INTEGER,

    CONSTRAINT "UpgradeStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "pilotId" UUID,
    "target" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAttempt" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "NotificationStatus" NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" UUID,
    "pilotId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUnit_code_key" ON "OrganizationUnit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Pilot_employeeNumber_key" ON "Pilot"("employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PilotAccessToken_tokenHash_key" ON "PilotAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PilotAccessToken_pilotId_expiresAt_idx" ON "PilotAccessToken"("pilotId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PilotSession_tokenHash_key" ON "PilotSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PilotSession_expiresAt_idx" ON "PilotSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationType_code_key" ON "QualificationType"("code");

-- CreateIndex
CREATE INDEX "QualificationRecord_pilotId_status_idx" ON "QualificationRecord"("pilotId", "status");

-- CreateIndex
CREATE INDEX "QualificationRecord_qualificationTypeId_expiryDate_idx" ON "QualificationRecord"("qualificationTypeId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationRecord_pilotId_qualificationTypeId_status_key" ON "QualificationRecord"("pilotId", "qualificationTypeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceImage_objectKey_key" ON "EvidenceImage"("objectKey");

-- CreateIndex
CREATE INDEX "EvidenceImage_status_expiresAt_idx" ON "EvidenceImage"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationEvidence_evidenceImageId_qualificationRecordId_key" ON "QualificationEvidence"("evidenceImageId", "qualificationRecordId", "updateRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationUpdateRequest_qualificationRecordId_key" ON "QualificationUpdateRequest"("qualificationRecordId");

-- CreateIndex
CREATE INDEX "QualificationUpdateRequest_status_submittedAt_idx" ON "QualificationUpdateRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "VerificationResult_requestId_createdAt_idx" ON "VerificationResult"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "RecognitionTask_status_createdAt_idx" ON "RecognitionTask"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UpgradePlan_planNumber_key" ON "UpgradePlan"("planNumber");

-- CreateIndex
CREATE INDEX "UpgradePlan_pilotId_lifecycleStatus_idx" ON "UpgradePlan"("pilotId", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "UpgradeStage_plannedStart_plannedEnd_idx" ON "UpgradeStage"("plannedStart", "plannedEnd");

-- CreateIndex
CREATE UNIQUE INDEX "UpgradeStage_planId_order_key" ON "UpgradeStage"("planId", "order");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");

-- AddForeignKey
ALTER TABLE "Pilot" ADD CONSTRAINT "Pilot_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrganizationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUserRole" ADD CONSTRAINT "AdminUserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUserRole" ADD CONSTRAINT "AdminUserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotAccessToken" ADD CONSTRAINT "PilotAccessToken_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotSession" ADD CONSTRAINT "PilotSession_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationRecord" ADD CONSTRAINT "QualificationRecord_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationRecord" ADD CONSTRAINT "QualificationRecord_qualificationTypeId_fkey" FOREIGN KEY ("qualificationTypeId") REFERENCES "QualificationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationEvidence" ADD CONSTRAINT "QualificationEvidence_evidenceImageId_fkey" FOREIGN KEY ("evidenceImageId") REFERENCES "EvidenceImage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationEvidence" ADD CONSTRAINT "QualificationEvidence_qualificationRecordId_fkey" FOREIGN KEY ("qualificationRecordId") REFERENCES "QualificationRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationEvidence" ADD CONSTRAINT "QualificationEvidence_updateRequestId_fkey" FOREIGN KEY ("updateRequestId") REFERENCES "QualificationUpdateRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationUpdateRequest" ADD CONSTRAINT "QualificationUpdateRequest_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationUpdateRequest" ADD CONSTRAINT "QualificationUpdateRequest_qualificationTypeId_fkey" FOREIGN KEY ("qualificationTypeId") REFERENCES "QualificationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationUpdateRequest" ADD CONSTRAINT "QualificationUpdateRequest_qualificationRecordId_fkey" FOREIGN KEY ("qualificationRecordId") REFERENCES "QualificationRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationResult" ADD CONSTRAINT "VerificationResult_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QualificationUpdateRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecognitionTask" ADD CONSTRAINT "RecognitionTask_evidenceImageId_fkey" FOREIGN KEY ("evidenceImageId") REFERENCES "EvidenceImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpgradePlan" ADD CONSTRAINT "UpgradePlan_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpgradeStage" ADD CONSTRAINT "UpgradeStage_planId_fkey" FOREIGN KEY ("planId") REFERENCES "UpgradePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "NotificationDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
