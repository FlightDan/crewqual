import { NextRequest } from "next/server";
import { assertSameOrigin, getRequestId, jsonError } from "@/server/api";
import { assertCsrf, authenticateAdmin, requirePermission } from "@/server/auth";
import { requireAssignedUnit } from "@/server/admin-permissions";
import { getPrisma } from "@/server/prisma";

export async function getAdmin(request: NextRequest, permission?: string, mutate = false) {
  if (mutate) assertSameOrigin(request);
  const admin = await authenticateAdmin(request);
  try {
    if (permission) requirePermission(admin, permission);
    requireAssignedUnit(admin);
  } catch (error) {
    await getPrisma()
      .auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          action: "admin.permission_denied",
          entityType: "Route",
          entityId: request.nextUrl.pathname,
          detail: { permission: permission ?? null, method: request.method },
          requestId: getRequestId(request),
        },
      })
      .catch(() => undefined);
    throw error;
  }
  if (mutate) await assertCsrf(request, admin.csrfToken);
  return admin;
}

export function routeFailure(error: unknown, request: NextRequest) {
  return jsonError(error, getRequestId(request), request);
}

/**
 * Read-only auth probe used by disclosure-gated GET endpoints (health,
 * setup overview). Unlike getAdmin it never writes audit events, so probing
 * an unprivileged session cannot fill the audit log.
 */
export async function hasSettingsReadAccess(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request);
    requirePermission(admin, "settings.read");
    return true;
  } catch {
    return false;
  }
}
