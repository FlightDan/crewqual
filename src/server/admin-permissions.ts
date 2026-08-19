import { ApiError } from "@/server/api-error";

export const ADMIN_ROLE_CODES = ["SUPER_ADMIN", "ADMIN", "REVIEWER", "VIEWER"] as const;

export type AdminRoleCode = (typeof ADMIN_ROLE_CODES)[number];

export const ADMIN_PERMISSION_CODES = [
  "dashboard.read",
  "pilots.read",
  "pilots.write",
  "reviews.read",
  "reviews.decide",
  "operations.read",
  "operations.write",
  "notifications.read",
  "notifications.retry",
  "settings.read",
  "settings.units.write",
  "settings.positions.write",
  "settings.notifications.write",
  "settings.admins.write",
  "settings.security.write",
  "settings.backups.write",
  "settings.backups.restore",
  "audit.read",
] as const;

export type AdminPermissionCode = (typeof ADMIN_PERMISSION_CODES)[number];

const allPermissions = [...ADMIN_PERMISSION_CODES];

export const ROLE_PERMISSION_CODES: Record<AdminRoleCode, readonly AdminPermissionCode[]> = {
  SUPER_ADMIN: allPermissions,
  ADMIN: [
    "dashboard.read",
    "pilots.read",
    "pilots.write",
    "reviews.read",
    "reviews.decide",
    "operations.read",
    "operations.write",
    "notifications.read",
    "notifications.retry",
    "settings.read",
    "settings.units.write",
    "settings.positions.write",
    "settings.notifications.write",
  ],
  REVIEWER: [
    "dashboard.read",
    "pilots.read",
    "reviews.read",
    "reviews.decide",
    "operations.read",
    "notifications.read",
    "settings.read",
  ],
  VIEWER: [
    "dashboard.read",
    "pilots.read",
    "reviews.read",
    "operations.read",
    "notifications.read",
    "settings.read",
  ],
};

export type AdminScopeIdentity = {
  roles: string[];
  unitId: string | null;
};

export function isSuperAdmin(admin: Pick<AdminScopeIdentity, "roles">) {
  return admin.roles.includes("SUPER_ADMIN");
}

export function requireAssignedUnit(admin: AdminScopeIdentity): string | null {
  if (isSuperAdmin(admin)) return null;
  if (!admin.unitId) {
    throw new ApiError("UNIT_REQUIRED", "管理员账号尚未分配所属单位", 403);
  }
  return admin.unitId;
}

export function pilotUnitWhere(admin: AdminScopeIdentity) {
  const unitId = requireAssignedUnit(admin);
  return unitId ? { unitId } : {};
}

export function relatedPilotUnitWhere(admin: AdminScopeIdentity) {
  const unitId = requireAssignedUnit(admin);
  return unitId ? { pilot: { unitId } } : {};
}

export function roleHasPermission(role: AdminRoleCode, permission: AdminPermissionCode) {
  return ROLE_PERMISSION_CODES[role].includes(permission);
}

export function assertSuperAdminContinuity(input: {
  currentlySuperAdmin: boolean;
  activeSuperAdminCount: number;
  nextRole: string;
  nextActive: boolean;
}) {
  if (
    input.currentlySuperAdmin &&
    (!input.nextActive || input.nextRole !== "SUPER_ADMIN") &&
    input.activeSuperAdminCount < 2
  ) {
    throw new ApiError("LAST_SUPER_ADMIN", "系统至少需要保留一名启用中的超级管理员", 409);
  }
}
