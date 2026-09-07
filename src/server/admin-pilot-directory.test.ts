import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminPilotDirectorySql, listAdminPilotDirectory } from "@/server/admin-pilot-directory";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/server/prisma", () => ({ getPrisma: mocks.getPrisma }));
const admin = {
  id: "admin",
  email: "admin@example.com",
  displayName: "Admin",
  roles: ["ADMIN"],
  permissions: [],
  unitId: "00000000-0000-0000-0000-000000000001",
  unitName: "Unit",
  sessionId: "session",
  csrfToken: "csrf",
  expiresAt: new Date(),
};
const pilot = {
  id: "00000000-0000-0000-0000-000000000002",
  person: null,
  qualifications: [],
  upgradePlans: [],
  displayName: "Same",
  employeeNumber: "001",
  unitId: admin.unitId,
  unit: { id: admin.unitId, timezone: "Asia/Shanghai", name: "Unit", code: "UNIT" },
  roleCode: "CAPTAIN",
  rankLabel: "CAPTAIN",
  active: true,
  version: 1,
};

beforeEach(() => vi.clearAllMocks());

describe("admin pilot directory database boundary", () => {
  it("counts/filters before LIMIT and binds user input rather than interpolating SQL", () => {
    const query = adminPilotDirectorySql({
      unitId: admin.unitId,
      query: { q: "x' OR TRUE--", health: "missing", status: "active", upgrade: "none" },
      unitDays: [],
      page: 3,
      pageSize: 2,
    });
    expect(query.text).not.toContain("x' OR TRUE--");
    expect(query.values).toContain("%x' OR TRUE--%");
    expect(query.values).toContain("missing");
    expect(query.text.indexOf("filtered AS")).toBeLessThan(query.text.indexOf("LIMIT"));
    expect(query.text).toContain('ORDER BY "displayName", id LIMIT');
    expect(query.text).toContain("count(*)::integer FROM filtered");
    expect(query.values.slice(-2)).toEqual([2, 4]);
  });

  it("fetches only projected page IDs and reads the clock once", async () => {
    const tx = {
      organizationUnit: { findMany: vi.fn().mockResolvedValue([pilot.unit]) },
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ total: 101, rows: [{ id: pilot.id, health: "unconfigured" }] }]),
      pilot: { findMany: vi.fn().mockResolvedValue([pilot]) },
    };
    const transaction = vi.fn(async (fn: (value: typeof tx) => unknown, options?: unknown) => {
      expect(options).toEqual({ isolationLevel: "RepeatableRead" });
      return fn(tx);
    });
    mocks.getPrisma.mockReturnValue({ $transaction: transaction });
    const now = vi.fn(() => new Date("2026-09-07T16:30:00Z"));
    const result = await listAdminPilotDirectory(admin, { page: 2, pageSize: 1 }, { now });
    expect(now).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ total: 101, page: 2, pageSize: 1, totalPages: 101 });
    expect(tx.pilot.findMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { id: { in: [pilot.id] }, unitId: admin.unitId } }),
    );
    expect(tx.organizationUnit.findMany).toHaveBeenCalledWith({
      where: { id: admin.unitId },
      select: { id: true, timezone: true },
    });
    expect(tx.$queryRaw.mock.calls[0][0].values).toContain("2026-09-08");
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  });

  it("counts historical date risks but only required missing/incomplete risks", async () => {
    const assignment = (code: string, required: boolean) => ({
      id: code,
      active: true,
      qualificationDefinitionId: code,
      qualificationDefinition: {
        id: code,
        code,
        name: code,
        active: true,
        legacyQualificationTypeId: null,
      },
      requirement: { active: true, required, position: { active: true } },
      positionAssignment: null,
    });
    const legacy = (code: string, expiryDate: string) => ({
      id: code,
      pilotId: pilot.id,
      personId: null,
      qualificationTypeId: code,
      qualificationType: { code, name: code },
      expiryDate,
      qualificationRuleSnapshot: { version: 1, validityRule: { kind: "manual_expiry" } },
    });
    const fixture = {
      ...pilot,
      personId: "person-1",
      person: {
        id: "person-1",
        organizationId: "org-1",
        unitId: admin.unitId,
        unit: pilot.unit,
        legacyPilot: null,
        qualificationAssignments: [
          assignment("required-missing", true),
          assignment("optional-missing", false),
          assignment("optional-incomplete", false),
        ],
        qualificationRecords: [
          {
            id: "broken",
            personId: "person-1",
            qualificationDefinitionId: "optional-incomplete",
            expiryDate: null,
            qualificationRuleSnapshot: {},
          },
        ],
      },
      qualifications: [
        legacy("historical-expired", "2026-09-06"),
        legacy("historical-due", "2026-09-07"),
      ],
    };
    const tx = {
      organizationUnit: { findMany: vi.fn().mockResolvedValue([pilot.unit]) },
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ total: 1, rows: [{ id: pilot.id, health: "missing" }] }]),
      pilot: { findMany: vi.fn().mockResolvedValue([fixture]) },
    };
    mocks.getPrisma.mockReturnValue({
      $transaction: (fn: (value: typeof tx) => unknown) => fn(tx),
    });
    const result = await listAdminPilotDirectory(
      admin,
      {},
      { now: () => new Date("2026-09-07T04:00:00Z") },
    );
    expect(result.items[0]).toMatchObject({
      health: "missing",
      expiredCount: 1,
      expiringCount: 1,
      missingCount: 1,
      incompleteCount: 0,
    });
  });

  it("preserves total for an empty page without any pilot detail query", async () => {
    const tx = {
      organizationUnit: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([{ total: 5, rows: [] }]),
      pilot: { findMany: vi.fn() },
    };
    mocks.getPrisma.mockReturnValue({
      $transaction: (fn: (value: typeof tx) => unknown) => fn(tx),
    });
    expect(await listAdminPilotDirectory(admin, { page: 9, pageSize: 1 })).toMatchObject({
      items: [],
      total: 5,
      totalPages: 5,
    });
    expect(tx.pilot.findMany).not.toHaveBeenCalled();
  });

  it("fails closed for an administrator without a unit", async () => {
    await expect(listAdminPilotDirectory({ ...admin, unitId: null }, {})).rejects.toMatchObject({
      code: "UNIT_REQUIRED",
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });
});
