import { describe, expect, it } from "vitest";
import {
  assertSuperAdminContinuity,
  pilotUnitWhere,
  personScopeWhere,
  relatedPilotUnitWhere,
  roleHasPermission,
} from "@/server/admin-permissions";

describe("admin role permissions", () => {
  it("keeps the standard role layers without granting mutations to reviewers or viewers", () => {
    expect(roleHasPermission("VIEWER", "operations.read")).toBe(true);
    expect(roleHasPermission("VIEWER", "operations.write")).toBe(false);
    expect(roleHasPermission("REVIEWER", "reviews.decide")).toBe(true);
    expect(roleHasPermission("ADMIN", "reviews.decide")).toBe(true);
    expect(roleHasPermission("ADMIN", "operations.write")).toBe(true);
    expect(roleHasPermission("ADMIN", "pilots.write")).toBe(true);
    expect(roleHasPermission("REVIEWER", "pilots.write")).toBe(false);
    expect(roleHasPermission("VIEWER", "settings.read")).toBe(true);
    expect(roleHasPermission("VIEWER", "settings.positions.write")).toBe(false);
    expect(roleHasPermission("SUPER_ADMIN", "settings.security.write")).toBe(true);
  });

  it("scopes ordinary administrators to their assigned unit", () => {
    const admin = { roles: ["ADMIN"], unitId: "unit-a" };
    expect(pilotUnitWhere(admin)).toEqual({ unitId: "unit-a" });
    expect(relatedPilotUnitWhere(admin)).toEqual({ pilot: { unitId: "unit-a" } });
  });

  it("allows super administrators global scope and rejects unassigned ordinary accounts", () => {
    expect(pilotUnitWhere({ roles: ["SUPER_ADMIN"], unitId: null })).toEqual({});
    expect(() => pilotUnitWhere({ roles: ["VIEWER"], unitId: null })).toThrow("尚未分配所属单位");
  });

  it.each([null, "unit-a"])(
    "keeps all super administrator scopes global with unit %s",
    (unitId) => {
      const admin = { roles: ["SUPER_ADMIN"], organizationId: "org-a", unitId };
      expect(pilotUnitWhere(admin)).toEqual({});
      expect(relatedPilotUnitWhere(admin)).toEqual({});
      expect(personScopeWhere(admin)).toEqual({});
    },
  );

  it.each(["ADMIN", "REVIEWER", "VIEWER"])("requires a unit for %s canonical access", (role) => {
    expect(() =>
      personScopeWhere({ roles: [role], unitId: null, organizationId: "org-a" }),
    ).toThrow("尚未分配所属单位");
    expect(personScopeWhere({ roles: [role], unitId: "unit-a", organizationId: "org-a" })).toEqual({
      unitId: "unit-a",
      organizationId: "org-a",
    });
  });

  it("protects the last active super administrator", () => {
    expect(() =>
      assertSuperAdminContinuity({
        currentlySuperAdmin: true,
        activeSuperAdminCount: 1,
        nextRole: "ADMIN",
        nextActive: true,
      }),
    ).toThrow("至少需要保留一名");
    expect(() =>
      assertSuperAdminContinuity({
        currentlySuperAdmin: true,
        activeSuperAdminCount: 2,
        nextRole: "ADMIN",
        nextActive: false,
      }),
    ).not.toThrow();
  });
});
