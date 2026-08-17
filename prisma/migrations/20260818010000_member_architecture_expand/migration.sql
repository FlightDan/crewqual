-- Additive expansion for the member/position/template architecture.
-- Existing Pilot and QualificationType tables remain untouched as compatibility
-- sources until the application read/write cutover is complete.

CREATE TYPE "PositionAssignmentStatus" AS ENUM ('ACTIVE', 'ENDED');
CREATE TYPE "QualificationAssignmentSource" AS ENUM ('POSITION_REQUIREMENT', 'MANUAL', 'LEGACY_RECORD');
CREATE TYPE "TemplateInstallationStatus" AS ENUM ('SUCCEEDED', 'NOOP', 'PARTIAL', 'FAILED');

CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultLocale" TEXT NOT NULL DEFAULT 'zh-CN',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");
CREATE INDEX "Organization_active_name_idx" ON "Organization"("active", "name");

ALTER TABLE "OrganizationUnit"
    ADD COLUMN "organizationId" UUID,
    ADD COLUMN "parentId" UUID;
CREATE INDEX "OrganizationUnit_organizationId_parentId_active_idx"
    ON "OrganizationUnit"("organizationId", "parentId", "active");
ALTER TABLE "OrganizationUnit"
    ADD CONSTRAINT "OrganizationUnit_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "OrganizationUnit_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Person" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "unitId" UUID,
    "employeeNumber" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Person_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Person_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Person_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Person_employeeNumber_key" ON "Person"("employeeNumber");
CREATE INDEX "Person_organizationId_active_displayName_idx" ON "Person"("organizationId", "active", "displayName");
CREATE INDEX "Person_unitId_active_idx" ON "Person"("unitId", "active");

ALTER TABLE "Pilot" ADD COLUMN "personId" UUID;
CREATE UNIQUE INDEX "Pilot_personId_key" ON "Pilot"("personId");
ALTER TABLE "Pilot"
    ADD CONSTRAINT "Pilot_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PilotProfile" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "legacyPilotId" UUID,
    "aircraftType" TEXT NOT NULL,
    "dutyLabel" TEXT NOT NULL,
    "rankLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PilotProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PilotProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PilotProfile_legacyPilotId_fkey" FOREIGN KEY ("legacyPilotId") REFERENCES "Pilot"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PilotProfile_personId_key" ON "PilotProfile"("personId");
CREATE UNIQUE INDEX "PilotProfile_legacyPilotId_key" ON "PilotProfile"("legacyPilotId");

ALTER TABLE "AdminUser" ADD COLUMN "organizationId" UUID;
ALTER TABLE "AdminUser"
    ADD CONSTRAINT "AdminUser_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Position" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "translations" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourcePackCode" TEXT,
    "sourcePackVersion" INTEGER,
    "customizedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Position_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Position_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Position_organizationId_code_key" ON "Position"("organizationId", "code");
CREATE INDEX "Position_organizationId_active_sortOrder_idx" ON "Position"("organizationId", "active", "sortOrder");

CREATE TABLE "PersonPositionAssignment" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "status" "PositionAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_DATE,
    "effectiveTo" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PersonPositionAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PersonPositionAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PersonPositionAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PersonPositionAssignment_personId_positionId_effectiveFrom_key"
    ON "PersonPositionAssignment"("personId", "positionId", "effectiveFrom");
CREATE INDEX "PersonPositionAssignment_personId_status_isPrimary_idx"
    ON "PersonPositionAssignment"("personId", "status", "isPrimary");
CREATE INDEX "PersonPositionAssignment_positionId_status_idx"
    ON "PersonPositionAssignment"("positionId", "status");
CREATE UNIQUE INDEX "PersonPositionAssignment_one_active_primary_idx"
    ON "PersonPositionAssignment"("personId") WHERE "status" = 'ACTIVE' AND "isPrimary" = true;

CREATE TABLE "QualificationDefinition" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "translations" JSONB NOT NULL DEFAULT '{}',
    "category" TEXT NOT NULL DEFAULT 'aviation',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requiresEvidence" BOOLEAN NOT NULL DEFAULT true,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "allowAutoApproval" BOOLEAN NOT NULL DEFAULT false,
    "fieldSchema" JSONB NOT NULL DEFAULT '{}',
    "validityRule" JSONB NOT NULL,
    "reminders" JSONB NOT NULL,
    "ocrChecks" JSONB NOT NULL,
    "parameterRestriction" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourcePackCode" TEXT,
    "sourcePackVersion" INTEGER,
    "legacyQualificationTypeId" UUID,
    "customizedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "QualificationDefinition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QualificationDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QualificationDefinition_legacyQualificationTypeId_fkey" FOREIGN KEY ("legacyQualificationTypeId") REFERENCES "QualificationType"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QualificationDefinition_organizationId_code_key" ON "QualificationDefinition"("organizationId", "code");
CREATE INDEX "QualificationDefinition_organizationId_active_sortOrder_idx"
    ON "QualificationDefinition"("organizationId", "active", "sortOrder");

CREATE TABLE "QualificationRequirement" (
    "id" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "qualificationDefinitionId" UUID NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "upgradePrerequisite" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourcePackCode" TEXT,
    "sourcePackVersion" INTEGER,
    "customizedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "QualificationRequirement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QualificationRequirement_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QualificationRequirement_qualificationDefinitionId_fkey" FOREIGN KEY ("qualificationDefinitionId") REFERENCES "QualificationDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QualificationRequirement_positionId_qualificationDefinitionId_key"
    ON "QualificationRequirement"("positionId", "qualificationDefinitionId");
CREATE INDEX "QualificationRequirement_positionId_active_sortOrder_idx"
    ON "QualificationRequirement"("positionId", "active", "sortOrder");

CREATE TABLE "QualificationAssignment" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "qualificationDefinitionId" UUID NOT NULL,
    "requirementId" UUID,
    "positionAssignmentId" UUID,
    "source" "QualificationAssignmentSource" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "QualificationAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QualificationAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QualificationAssignment_qualificationDefinitionId_fkey" FOREIGN KEY ("qualificationDefinitionId") REFERENCES "QualificationDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QualificationAssignment_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "QualificationRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QualificationAssignment_positionAssignmentId_fkey" FOREIGN KEY ("positionAssignmentId") REFERENCES "PersonPositionAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QualificationAssignment_positionAssignmentId_requirementId_key"
    ON "QualificationAssignment"("positionAssignmentId", "requirementId");
CREATE INDEX "QualificationAssignment_personId_active_qualificationDefinitionId_idx"
    ON "QualificationAssignment"("personId", "active", "qualificationDefinitionId");
CREATE INDEX "QualificationAssignment_qualificationDefinitionId_active_idx"
    ON "QualificationAssignment"("qualificationDefinitionId", "active");

CREATE TABLE "TemplatePack" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "industryCode" TEXT NOT NULL DEFAULT 'aviation',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "translations" JSONB NOT NULL DEFAULT '{}',
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "TemplatePack_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TemplatePack_code_version_key" ON "TemplatePack"("code", "version");
CREATE INDEX "TemplatePack_industryCode_active_idx" ON "TemplatePack"("industryCode", "active");

CREATE TABLE "OrganizationTemplateInstallation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "templatePackId" UUID NOT NULL,
    "status" "TemplateInstallationStatus" NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "installedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installedBy" UUID,
    CONSTRAINT "OrganizationTemplateInstallation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrganizationTemplateInstallation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationTemplateInstallation_templatePackId_fkey" FOREIGN KEY ("templatePackId") REFERENCES "TemplatePack"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrganizationTemplateInstallation_organizationId_templatePackId_key"
    ON "OrganizationTemplateInstallation"("organizationId", "templatePackId");
CREATE INDEX "OrganizationTemplateInstallation_organizationId_installedAt_idx"
    ON "OrganizationTemplateInstallation"("organizationId", "installedAt");

ALTER TABLE "QualificationRecord"
    ADD COLUMN "personId" UUID,
    ADD COLUMN "qualificationDefinitionId" UUID;
ALTER TABLE "QualificationRecord"
    ADD CONSTRAINT "QualificationRecord_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "QualificationRecord_qualificationDefinitionId_fkey"
    FOREIGN KEY ("qualificationDefinitionId") REFERENCES "QualificationDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "QualificationRecord_personId_status_idx" ON "QualificationRecord"("personId", "status");
CREATE INDEX "QualificationRecord_qualificationDefinitionId_expiryDate_idx" ON "QualificationRecord"("qualificationDefinitionId", "expiryDate");

ALTER TABLE "EvidenceImage" ADD COLUMN "personId" UUID;
ALTER TABLE "EvidenceImage"
    ADD CONSTRAINT "EvidenceImage_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QualificationUpdateRequest"
    ADD COLUMN "personId" UUID,
    ADD COLUMN "qualificationDefinitionId" UUID;
ALTER TABLE "QualificationUpdateRequest"
    ADD CONSTRAINT "QualificationUpdateRequest_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "QualificationUpdateRequest_qualificationDefinitionId_fkey"
    FOREIGN KEY ("qualificationDefinitionId") REFERENCES "QualificationDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "QualificationUpdateRequest_personId_status_submittedAt_idx"
    ON "QualificationUpdateRequest"("personId", "status", "submittedAt");
CREATE INDEX "QualificationUpdateRequest_qualificationDefinitionId_status_submittedAt_idx"
    ON "QualificationUpdateRequest"("qualificationDefinitionId", "status", "submittedAt");

ALTER TABLE "UpgradePlan"
    ADD COLUMN "personId" UUID,
    ADD COLUMN "positionAssignmentId" UUID,
    ADD COLUMN "positionCodeSnapshot" TEXT,
    ADD COLUMN "positionNameSnapshot" TEXT;
ALTER TABLE "UpgradePlan"
    ADD CONSTRAINT "UpgradePlan_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "UpgradePlan_positionAssignmentId_fkey"
    FOREIGN KEY ("positionAssignmentId") REFERENCES "PersonPositionAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "UpgradePlan_personId_positionAssignmentId_lifecycleStatus_idx"
    ON "UpgradePlan"("personId", "positionAssignmentId", "lifecycleStatus");

ALTER TABLE "NotificationDelivery" ADD COLUMN "personId" UUID;
ALTER TABLE "NotificationDelivery"
    ADD CONSTRAINT "NotificationDelivery_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "NotificationDelivery_personId_readAt_createdAt_idx"
    ON "NotificationDelivery"("personId", "readAt", "createdAt");

ALTER TABLE "AuditEvent" ADD COLUMN "personId" UUID;
ALTER TABLE "AuditEvent"
    ADD CONSTRAINT "AuditEvent_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "AuditEvent_personId_createdAt_idx" ON "AuditEvent"("personId", "createdAt");
