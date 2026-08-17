-- Establish the fixed CrewQual permission catalogue without relying on a seed rerun.
INSERT INTO "Permission" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'dashboard.read', '查看总览'),
  (gen_random_uuid(), 'pilots.read', '查看飞行员'),
  (gen_random_uuid(), 'reviews.read', '查看审核'),
  (gen_random_uuid(), 'reviews.decide', '处理审核'),
  (gen_random_uuid(), 'operations.read', '查看运营数据'),
  (gen_random_uuid(), 'operations.write', '变更运营数据'),
  (gen_random_uuid(), 'notifications.read', '查看通知记录'),
  (gen_random_uuid(), 'notifications.retry', '重试通知'),
  (gen_random_uuid(), 'settings.read', '访问系统设置'),
  (gen_random_uuid(), 'settings.units.write', '维护所属单位设置'),
  (gen_random_uuid(), 'settings.notifications.write', '维护通知设置'),
  (gen_random_uuid(), 'settings.admins.write', '维护管理员与角色'),
  (gen_random_uuid(), 'settings.security.write', '维护安全策略与会话'),
  (gen_random_uuid(), 'audit.read', '查看安全审计')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

-- Roles are fixed system roles. Remove the previous accidental all-permissions grants.
DELETE FROM "RolePermission";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
JOIN "Permission" permission ON (
  role."code" = 'SUPER_ADMIN'
  OR (
    role."code" = 'ADMIN'
    AND permission."code" IN (
      'dashboard.read', 'pilots.read', 'reviews.read', 'reviews.decide',
      'operations.read', 'operations.write', 'notifications.read', 'notifications.retry',
      'settings.read', 'settings.units.write', 'settings.notifications.write'
    )
  )
  OR (
    role."code" = 'REVIEWER'
    AND permission."code" IN (
      'dashboard.read', 'pilots.read', 'reviews.read', 'reviews.decide',
      'operations.read', 'notifications.read'
    )
  )
  OR (
    role."code" = 'VIEWER'
    AND permission."code" IN (
      'dashboard.read', 'pilots.read', 'reviews.read',
      'operations.read', 'notifications.read'
    )
  )
)
ON CONFLICT DO NOTHING;
