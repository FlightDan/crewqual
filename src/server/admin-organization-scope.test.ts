import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminOrganizationWhere, resolveOrganizationTarget } from "./admin-organization-scope";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/server/prisma", () => ({ getPrisma: () => ({ organization: mocks }) }));
const orgA = "00000000-0000-4000-8000-000000000001";
const orgB = "00000000-0000-4000-8000-000000000002";
const ordinary = { roles: ["ADMIN"], unitId: "unit-a", organizationId: orgA };
const global = { ...ordinary, roles: ["SUPER_ADMIN"] };

describe("organization-scoped configuration access", () => {
  beforeEach(() => vi.clearAllMocks());
  it("keeps global reads unbounded even when the account has a default organization", () => {
    expect(adminOrganizationWhere(global)).toEqual({});
    expect(adminOrganizationWhere(global, orgB)).toEqual({ organizationId: orgB });
  });
  it.each(["ADMIN", "REVIEWER", "VIEWER"])("does not widen %s beyond its organization", (role) => {
    const admin = { ...ordinary, roles: [role] };
    expect(adminOrganizationWhere(admin)).toEqual({ organizationId: orgA });
    expect(() => adminOrganizationWhere(admin, orgB)).toThrow("不能访问其他组织");
    expect(() => adminOrganizationWhere({ ...admin, unitId: null })).toThrow("尚未分配所属单位");
  });
  it("requires an explicit creation target for global administrators", async () => {
    await expect(resolveOrganizationTarget(global)).rejects.toMatchObject({
      code: "ORGANIZATION_REQUIRED",
      status: 422,
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("rejects nonexistent targets and cross-organization ordinary requests before mutation", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(resolveOrganizationTarget(global, orgB)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    mocks.findUnique.mockClear();
    await expect(resolveOrganizationTarget(ordinary, orgB)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("resolves a selected global target or a trusted ordinary target", async () => {
    mocks.findUnique.mockImplementation(({ where }) => Promise.resolve({ id: where.id }));
    await expect(resolveOrganizationTarget(global, orgB)).resolves.toBe(orgB);
    await expect(resolveOrganizationTarget(ordinary)).resolves.toBe(orgA);
  });
});
