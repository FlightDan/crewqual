-- Preserve position identity when a position is force deleted.
ALTER TABLE "PersonPositionAssignment"
    ADD COLUMN "positionCodeSnapshot" TEXT,
    ADD COLUMN "positionNameSnapshot" TEXT;

UPDATE "PersonPositionAssignment" AS assignment
SET
    "positionCodeSnapshot" = position.code,
    "positionNameSnapshot" = position.name
FROM "Position" AS position
WHERE assignment."positionId" = position.id;

ALTER TABLE "PersonPositionAssignment"
    ALTER COLUMN "positionId" DROP NOT NULL;

ALTER TABLE "PersonPositionAssignment"
    DROP CONSTRAINT "PersonPositionAssignment_positionId_fkey",
    ADD CONSTRAINT "PersonPositionAssignment_positionId_fkey"
      FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
