import { z } from "zod";
import { ApiError } from "@/server/api-error";
import {
  isSuperAdmin,
  requireAssignedUnit,
  type AdminScopeIdentity,
} from "@/server/admin-permissions";
import { getPrisma } from "@/server/prisma";

/** Global administrators may select a scope; ordinary administrators cannot widen it. */
export function adminOrganizationWhere(
  admin: AdminScopeIdentity,
  requestedOrganizationId?: string | null,
): { organizationId?: string } {
  const selected =
    requestedOrganizationId == null ? undefined : z.string().uuid().parse(requestedOrganizationId);
  if (isSuperAdmin(admin)) return selected ? { organizationId: selected } : {};
  const unitId = requireAssignedUnit(admin)!;
  const organizationId = admin.organizationId ?? unitId;
  if (selected && selected !== organizationId) {
    throw new ApiError("FORBIDDEN", "不能访问其他组织的配置", 403);
  }
  return { organizationId };
}

/** Creation needs a concrete target, never an unbounded global scope. */
export async function resolveOrganizationTarget(admin: AdminScopeIdentity, selected?: string) {
  const { organizationId } = adminOrganizationWhere(admin, selected);
  if (!organizationId) {
    throw new ApiError("ORGANIZATION_REQUIRED", "请选择目标组织", 422);
  }
  const organization = await getPrisma().organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) throw new ApiError("NOT_FOUND", "目标组织不存在", 404);
  return organization.id;
}
