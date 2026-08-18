-- Release-gate catalog and invariant constraints.  This migration is
-- intentionally additive so it can be deployed to an empty database and to
-- databases created by the earlier v0.1 migrations.
INSERT INTO "Permission" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'pilots.write', '新增、编辑、停用及批量导入飞行员'),
  (gen_random_uuid(), 'settings.positions.write', '维护组织职位设置')
ON CONFLICT ("code") DO UPDATE
SET "description" = EXCLUDED."description";

-- Keep the system role catalogue in sync with the runtime permission
-- constants.  Bootstrap re-applies the complete mapping on every run.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('pilots.write', 'settings.positions.write')
WHERE r."code" = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('pilots.write', 'settings.positions.write')
WHERE r."code" = 'ADMIN'
ON CONFLICT DO NOTHING;

-- Canonical records may have legacy NULLs during the expand phase, therefore
-- this is a partial index.  Once reconciliation reaches zero, it is the
-- database boundary that prevents two canonical ACTIVE revisions.
CREATE UNIQUE INDEX IF NOT EXISTS "QualificationRecord_active_person_definition_key"
  ON "QualificationRecord" ("personId", "qualificationDefinitionId")
  WHERE "status" = 'ACTIVE'
    AND "personId" IS NOT NULL
    AND "qualificationDefinitionId" IS NOT NULL;

-- A stage id is only meaningful inside its plan.  The composite key is used
-- by the inspection-item foreign key below to prevent cross-plan stage IDs.
CREATE UNIQUE INDEX IF NOT EXISTS "UpgradeStage_id_planId_key"
  ON "UpgradeStage" ("id", "planId");
ALTER TABLE "UpgradePlanInspectionItem"
  DROP CONSTRAINT IF EXISTS "UpgradePlanInspectionItem_stageId_fkey";
ALTER TABLE "UpgradePlanInspectionItem"
  ADD CONSTRAINT "UpgradePlanInspectionItem_stageId_planId_fkey"
  FOREIGN KEY ("stageId", "planId") REFERENCES "UpgradeStage" ("id", "planId")
  ON DELETE CASCADE ON UPDATE CASCADE;
