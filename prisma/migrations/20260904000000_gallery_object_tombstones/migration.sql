CREATE TABLE "GalleryObjectTombstone" (
  "objectKey" TEXT NOT NULL,
  "deletedAt" TIMESTAMPTZ(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalleryObjectTombstone_pkey" PRIMARY KEY ("objectKey")
);

CREATE INDEX "GalleryObjectTombstone_deletedAt_idx"
  ON "GalleryObjectTombstone" ("deletedAt");

CREATE OR REPLACE FUNCTION "record_evidence_image_tombstone"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "GalleryObjectTombstone" ("objectKey", "deletedAt", "reason")
    VALUES (OLD."objectKey", CURRENT_TIMESTAMP, 'DELETED')
    ON CONFLICT ("objectKey") DO UPDATE
      SET "deletedAt" = EXCLUDED."deletedAt", "reason" = EXCLUDED."reason";
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."objectKey" IS DISTINCT FROM NEW."objectKey" THEN
    INSERT INTO "GalleryObjectTombstone" ("objectKey", "deletedAt", "reason")
    VALUES (OLD."objectKey", CURRENT_TIMESTAMP, 'DELETED')
    ON CONFLICT ("objectKey") DO UPDATE
      SET "deletedAt" = EXCLUDED."deletedAt", "reason" = EXCLUDED."reason";
  END IF;

  IF NEW."status" = 'orphaned' THEN
    INSERT INTO "GalleryObjectTombstone" ("objectKey", "deletedAt", "reason")
    VALUES (NEW."objectKey", CURRENT_TIMESTAMP, 'ORPHANED')
    ON CONFLICT ("objectKey") DO UPDATE
      SET "deletedAt" = EXCLUDED."deletedAt", "reason" = EXCLUDED."reason";
  ELSE
    DELETE FROM "GalleryObjectTombstone" WHERE "objectKey" = NEW."objectKey";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "EvidenceImage_gallery_tombstone"
AFTER INSERT OR UPDATE OF "objectKey", "status" OR DELETE ON "EvidenceImage"
FOR EACH ROW EXECUTE FUNCTION "record_evidence_image_tombstone"();

-- Preserve deletion facts for orphan rows that predate this migration. Rows
-- already physically deleted cannot be reconstructed and are covered by the
-- next full gallery backup baseline.
INSERT INTO "GalleryObjectTombstone" ("objectKey", "deletedAt", "reason")
SELECT "objectKey", "updatedAt", 'ORPHANED'
FROM "EvidenceImage"
WHERE "status" = 'orphaned'
ON CONFLICT ("objectKey") DO NOTHING;
