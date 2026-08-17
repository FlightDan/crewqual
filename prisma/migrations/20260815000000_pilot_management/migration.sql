-- Add lifecycle and optimistic concurrency fields for managed pilot records.
ALTER TABLE "Pilot"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Personnel writes are intentionally separate from qualification/operations writes.
INSERT INTO "Permission" ("id", "code", "description")
VALUES (gen_random_uuid(), 'pilots.write', '新增、编辑、停用及批量导入飞行员')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
JOIN "Permission" permission ON permission."code" = 'pilots.write'
WHERE role."code" IN ('SUPER_ADMIN', 'ADMIN')
ON CONFLICT DO NOTHING;
