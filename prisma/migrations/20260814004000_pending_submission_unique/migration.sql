CREATE UNIQUE INDEX "QualificationUpdateRequest_pending_pilot_qualification_key"
ON "QualificationUpdateRequest" ("pilotId", "qualificationTypeId")
WHERE "status" = 'PENDING';
