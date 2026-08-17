DROP INDEX IF EXISTS "QualificationRecord_pilotId_qualificationTypeId_status_key";

CREATE UNIQUE INDEX "QualificationRecord_active_pilotId_qualificationTypeId_key"
ON "QualificationRecord" ("pilotId", "qualificationTypeId")
WHERE "status" = 'ACTIVE';
