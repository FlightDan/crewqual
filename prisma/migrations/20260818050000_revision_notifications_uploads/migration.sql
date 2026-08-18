ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'PROVIDER_ACCEPTED';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';
CREATE TYPE "QualificationRecordAction" AS ENUM ('CONFIRM', 'CORRECT_AND_CONFIRM', 'ROLLBACK', 'ADMIN_IMPORT');
CREATE TYPE "UploadReservationStatus" AS ENUM ('ACTIVE', 'RELEASED');

ALTER TABLE "BackupRun" ADD COLUMN "scheduledFor" TIMESTAMPTZ(3);
UPDATE "BackupRun" SET "scheduledFor" = "createdAt" WHERE "scheduledFor" IS NULL;
ALTER TABLE "BackupRun" ALTER COLUMN "scheduledFor" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "BackupRun" ALTER COLUMN "scheduledFor" SET NOT NULL;
CREATE UNIQUE INDEX "BackupRun_planId_scheduledFor_key" ON "BackupRun" ("planId", "scheduledFor");

ALTER TABLE "QualificationRecord"
  ADD COLUMN "lineageId" UUID,
  ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "supersedesRecordId" UUID,
  ADD COLUMN "restoresRecordId" UUID,
  ADD COLUMN "action" "QualificationRecordAction" NOT NULL DEFAULT 'CONFIRM',
  ADD COLUMN "actorId" UUID,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "activatedAt" TIMESTAMPTZ(3);
UPDATE "QualificationRecord" SET "lineageId" = "id" WHERE "lineageId" IS NULL;
ALTER TABLE "QualificationRecord" ALTER COLUMN "lineageId" SET NOT NULL;
CREATE UNIQUE INDEX "QualificationRecord_lineageId_revisionNumber_key"
  ON "QualificationRecord" ("lineageId", "revisionNumber");
ALTER TABLE "QualificationRecord"
  ADD CONSTRAINT "QualificationRecord_supersedesRecordId_fkey"
  FOREIGN KEY ("supersedesRecordId") REFERENCES "QualificationRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "QualificationRecord_restoresRecordId_fkey"
  FOREIGN KEY ("restoresRecordId") REFERENCES "QualificationRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "QualificationCorrection" (
  "id" UUID NOT NULL,
  "qualificationRecordId" UUID,
  "updateRequestId" UUID,
  "actorId" UUID,
  "reason" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualificationCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QualificationCorrection_record_fkey" FOREIGN KEY ("qualificationRecordId") REFERENCES "QualificationRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "QualificationCorrection_request_fkey" FOREIGN KEY ("updateRequestId") REFERENCES "QualificationUpdateRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "QualificationCorrection_record_createdAt_idx" ON "QualificationCorrection" ("qualificationRecordId", "createdAt");
CREATE INDEX "QualificationCorrection_request_createdAt_idx" ON "QualificationCorrection" ("updateRequestId", "createdAt");

ALTER TABLE "QualificationEvidence" DROP CONSTRAINT IF EXISTS "QualificationEvidence_evidenceImageId_key";
ALTER TABLE "NotificationDelivery" ADD COLUMN "adminUserId" UUID;
ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "NotificationDelivery_adminUserId_readAt_createdAt_idx"
  ON "NotificationDelivery" ("adminUserId", "readAt", "createdAt");

CREATE TABLE "UploadReservation" (
  "id" UUID NOT NULL,
  "pilotId" UUID NOT NULL,
  "bytesReserved" INTEGER NOT NULL,
  "status" "UploadReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "releasedAt" TIMESTAMPTZ(3),
  CONSTRAINT "UploadReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UploadReservation_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Pilot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UploadReservation_pilotId_status_expiresAt_idx"
  ON "UploadReservation" ("pilotId", "status", "expiresAt");
CREATE INDEX "UploadReservation_pilotId_createdAt_idx"
  ON "UploadReservation" ("pilotId", "createdAt");

-- Audit rows are append-only at the database boundary.  The migration role
-- can still perform maintenance explicitly; the application role receives
-- INSERT/SELECT only in the production role setup.
CREATE OR REPLACE FUNCTION crewqual_reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$;
DROP TRIGGER IF EXISTS audit_event_append_only ON "AuditEvent";
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION crewqual_reject_audit_mutation();
REVOKE UPDATE, DELETE ON "AuditEvent" FROM PUBLIC;

CREATE OR REPLACE FUNCTION crewqual_validate_org_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  person_org UUID;
  definition_org UUID;
  pilot_org UUID;
  position_org UUID;
  assignment_person UUID;
BEGIN
  IF TG_TABLE_NAME = 'Person' THEN
    IF NEW."unitId" IS NOT NULL THEN
      SELECT "organizationId" INTO person_org FROM "OrganizationUnit" WHERE "id" = NEW."unitId";
      IF person_org IS NOT NULL AND person_org <> NEW."organizationId" THEN
        RAISE EXCEPTION 'Person and OrganizationUnit belong to different organizations';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME IN ('QualificationRecord', 'QualificationUpdateRequest') THEN
    IF NEW."personId" IS NOT NULL THEN
      SELECT "organizationId" INTO person_org FROM "Person" WHERE "id" = NEW."personId";
      IF NEW."qualificationDefinitionId" IS NOT NULL THEN
        SELECT "organizationId" INTO definition_org FROM "QualificationDefinition" WHERE "id" = NEW."qualificationDefinitionId";
        IF person_org IS NOT NULL AND definition_org IS NOT NULL AND person_org <> definition_org THEN
          RAISE EXCEPTION 'Person and QualificationDefinition belong to different organizations';
        END IF;
      END IF;
      SELECT u."organizationId" INTO pilot_org
      FROM "Pilot" p JOIN "OrganizationUnit" u ON u."id" = p."unitId"
      WHERE p."id" = NEW."pilotId";
      IF person_org IS NOT NULL AND pilot_org IS NOT NULL AND person_org <> pilot_org THEN
        RAISE EXCEPTION 'Pilot and Person belong to different organizations';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'PersonPositionAssignment' THEN
    SELECT "organizationId" INTO person_org FROM "Person" WHERE "id" = NEW."personId";
    SELECT "organizationId" INTO position_org FROM "Position" WHERE "id" = NEW."positionId";
    IF person_org IS NOT NULL AND position_org IS NOT NULL AND person_org <> position_org THEN
      RAISE EXCEPTION 'Person and Position belong to different organizations';
    END IF;
  ELSIF TG_TABLE_NAME = 'QualificationRequirement' THEN
    SELECT "organizationId" INTO position_org FROM "Position" WHERE "id" = NEW."positionId";
    SELECT "organizationId" INTO definition_org FROM "QualificationDefinition" WHERE "id" = NEW."qualificationDefinitionId";
    IF position_org IS NOT NULL AND definition_org IS NOT NULL AND position_org <> definition_org THEN
      RAISE EXCEPTION 'Position and QualificationDefinition belong to different organizations';
    END IF;
  ELSIF TG_TABLE_NAME = 'QualificationAssignment' THEN
    SELECT "organizationId" INTO person_org FROM "Person" WHERE "id" = NEW."personId";
    SELECT "organizationId" INTO definition_org FROM "QualificationDefinition" WHERE "id" = NEW."qualificationDefinitionId";
    IF person_org IS NOT NULL AND definition_org IS NOT NULL AND person_org <> definition_org THEN
      RAISE EXCEPTION 'Person and QualificationDefinition belong to different organizations';
    END IF;
  ELSIF TG_TABLE_NAME = 'UpgradePlan' THEN
    SELECT "organizationId" INTO person_org FROM "Person" WHERE "id" = NEW."personId";
    SELECT p."personId" INTO assignment_person FROM "PersonPositionAssignment" p WHERE p."id" = NEW."positionAssignmentId";
    IF NEW."personId" IS NOT NULL AND assignment_person IS NOT NULL AND assignment_person <> NEW."personId" THEN
      RAISE EXCEPTION 'UpgradePlan person and position assignment do not match';
    END IF;
    SELECT u."organizationId" INTO pilot_org FROM "Pilot" p JOIN "OrganizationUnit" u ON u."id" = p."unitId" WHERE p."id" = NEW."pilotId";
    IF person_org IS NOT NULL AND pilot_org IS NOT NULL AND person_org <> pilot_org THEN
      RAISE EXCEPTION 'UpgradePlan pilot and person belong to different organizations';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER person_org_invariant BEFORE INSERT OR UPDATE ON "Person"
FOR EACH ROW EXECUTE FUNCTION crewqual_validate_org_invariants();
CREATE TRIGGER qualification_record_org_invariant BEFORE INSERT OR UPDATE ON "QualificationRecord"
FOR EACH ROW EXECUTE FUNCTION crewqual_validate_org_invariants();
CREATE TRIGGER qualification_request_org_invariant BEFORE INSERT OR UPDATE ON "QualificationUpdateRequest"
FOR EACH ROW EXECUTE FUNCTION crewqual_validate_org_invariants();
CREATE TRIGGER position_assignment_org_invariant BEFORE INSERT OR UPDATE ON "PersonPositionAssignment"
FOR EACH ROW EXECUTE FUNCTION crewqual_validate_org_invariants();
CREATE TRIGGER qualification_requirement_org_invariant BEFORE INSERT OR UPDATE ON "QualificationRequirement"
FOR EACH ROW EXECUTE FUNCTION crewqual_validate_org_invariants();
CREATE TRIGGER qualification_assignment_org_invariant BEFORE INSERT OR UPDATE ON "QualificationAssignment"
FOR EACH ROW EXECUTE FUNCTION crewqual_validate_org_invariants();
CREATE TRIGGER upgrade_plan_org_invariant BEFORE INSERT OR UPDATE ON "UpgradePlan"
FOR EACH ROW EXECUTE FUNCTION crewqual_validate_org_invariants();

UPDATE "PilotAccessToken"
SET "consumedAt" = "expiresAt"
WHERE "consumedAt" IS NULL AND "expiresAt" <= CURRENT_TIMESTAMP;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PilotAccessToken"
    WHERE "consumedAt" IS NULL GROUP BY "pilotId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple live pilot access tokens require reconciliation';
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS "PilotAccessToken_one_live_key"
  ON "PilotAccessToken" ("pilotId") WHERE "consumedAt" IS NULL;
