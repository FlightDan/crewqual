-- A pilot may have only one effective record for a qualification type.
-- This is intentionally a partial index: replaced historical records remain
-- queryable and auditable.
CREATE UNIQUE INDEX "QualificationRecord_one_active_per_pilot_type"
  ON "QualificationRecord" ("pilotId", "qualificationTypeId")
  WHERE "status" = 'ACTIVE';
