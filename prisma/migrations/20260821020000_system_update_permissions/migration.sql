INSERT INTO "Permission" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'settings.updates.read', '查看系统更新'),
  (gen_random_uuid(), 'settings.updates.install', '安装系统更新')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
JOIN "Permission" permission ON permission."code" IN ('settings.updates.read', 'settings.updates.install')
WHERE role."code" = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;
