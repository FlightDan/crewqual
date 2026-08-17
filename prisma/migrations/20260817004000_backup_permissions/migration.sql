INSERT INTO "Permission" ("id", "code", "description")
VALUES
  (gen_random_uuid(), 'settings.backups.write', '维护备份目标与计划'),
  (gen_random_uuid(), 'settings.backups.restore', '执行备份恢复')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role CROSS JOIN "Permission" permission
WHERE role."code" = 'SUPER_ADMIN'
  AND permission."code" IN ('settings.backups.write', 'settings.backups.restore')
ON CONFLICT DO NOTHING;
