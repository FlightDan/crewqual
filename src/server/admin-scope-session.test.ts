import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({ adminSession: { findFirst: mocks.session } }),
}));
vi.mock("@/server/runtime-settings", () => ({
  getRuntimeSecurityPolicy: async () => ({ policyVersion: 1 }),
}));
import { authenticateAdmin, COOKIE_NAMES, requirePermission } from "./auth";
import { adminOrganizationWhere } from "./admin-organization-scope";
import { requireAssignedUnit } from "./admin-permissions";

describe("administrator session scope refresh", () => {
  it("reloads unit, organization and roles for an existing session after account reassignment", async () => {
    const oldOrg = "00000000-0000-4000-8000-000000000010";
    const newOrg = "00000000-0000-4000-8000-000000000020";
    const user = {
      id: "admin",
      email: "admin@example.test",
      displayName: "Admin",
      unitId: "old-unit",
      organizationId: oldOrg,
      unit: { name: "Old" },
      roles: [
        { role: { code: "ADMIN", permissions: [{ permission: { code: "operations.write" } }] } },
      ],
    };
    mocks.session.mockImplementation(async () => ({
      id: "same-session",
      lastSeenAt: new Date(),
      policyVersion: 1,
      user,
      csrfTokenHash: "csrf",
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const request = new NextRequest("http://crewqual.test/api/admin/session", {
      headers: { cookie: `${COOKIE_NAMES.admin}=session-token` },
    });
    expect(adminOrganizationWhere(await authenticateAdmin(request))).toEqual({
      organizationId: oldOrg,
    });
    Object.assign(user, {
      unitId: "new-unit",
      organizationId: newOrg,
      unit: { name: "New" },
      roles: [
        { role: { code: "VIEWER", permissions: [{ permission: { code: "operations.read" } }] } },
      ],
    });
    const refreshed = await authenticateAdmin(request);
    expect(refreshed.sessionId).toBe("same-session");
    expect(requireAssignedUnit(refreshed)).toBe("new-unit");
    expect(adminOrganizationWhere(refreshed, newOrg)).toEqual({ organizationId: newOrg });
    expect(() => adminOrganizationWhere(refreshed, oldOrg)).toThrow();
    expect(() => requirePermission(refreshed, "operations.write")).toThrow();
    expect(() => requirePermission(refreshed, "operations.read")).not.toThrow();
  });
});
