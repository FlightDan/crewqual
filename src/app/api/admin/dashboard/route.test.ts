import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
const mocks = vi.hoisted(() => ({
  holders: vi.fn(),
  count: vi.fn().mockResolvedValue(0),
  list: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/server/admin-guard", () => ({
  getAdmin: () => ({ id: "admin", roles: ["SUPER_ADMIN"], unitId: null }),
}));
vi.mock("@/server/admin-repository", () => ({ mapReview: vi.fn() }));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    pilot: { findMany: mocks.holders },
    qualificationUpdateRequest: { count: mocks.count, findMany: mocks.list },
    upgradeStage: { findMany: mocks.list },
  }),
}));
function holder(
  id: string,
  timezone: string,
  recordKind: "dated" | "incomplete" | "missing",
  required = true,
) {
  const unit = { id: `unit-${id}`, organizationId: "org", timezone };
  const definition = {
    id: `def-${id}`,
    code: `CERT-${id}`,
    name: "Certificate",
    active: true,
    legacyQualificationTypeId: `type-${id}`,
  };
  const records =
    recordKind === "missing"
      ? []
      : [
          {
            id: `record-${id}`,
            pilotId: id,
            personId: `person-${id}`,
            qualificationDefinitionId: definition.id,
            qualificationTypeId: definition.legacyQualificationTypeId,
            expiryDate: new Date("2026-09-06T00:00:00Z"),
            qualificationRuleSnapshot:
              recordKind === "incomplete"
                ? null
                : { version: 1, validityRule: { kind: "manual_expiry" } },
          },
        ];
  return {
    id,
    displayName: id,
    personId: `person-${id}`,
    unitId: unit.id,
    unit,
    qualifications: [],
    person: {
      id: `person-${id}`,
      organizationId: "org",
      unitId: unit.id,
      unit,
      legacyPilot: null,
      qualificationRecords: records,
      qualificationAssignments: [
        {
          id: `assignment-${id}`,
          active: true,
          qualificationDefinitionId: definition.id,
          qualificationDefinition: definition,
          requirement: { active: true, required, position: { active: true } },
          positionAssignment: null,
        },
      ],
    },
  };
}
describe("dashboard qualification state", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });
  it("uses each holder's local date and reports required data gaps separately from date alerts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T04:00:00Z"));
    mocks.holders.mockResolvedValue([
      holder("shanghai", "Asia/Shanghai", "dated"),
      holder("la", "America/Los_Angeles", "dated"),
      holder("missing", "UTC", "missing"),
      holder("incomplete", "UTC", "incomplete"),
      holder("optional", "UTC", "missing", false),
    ]);
    const response = await GET(new NextRequest("http://localhost/api/admin/dashboard"));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({
      expiredCount: 1,
      dueIn7DaysCount: 1,
      dueIn30DaysCount: 1,
      missingCount: 1,
      incompleteCount: 1,
      evaluatedAt: "2026-09-07T04:00:00.000Z",
    });
    expect(data.timezones).toEqual(
      expect.arrayContaining(["Asia/Shanghai", "America/Los_Angeles", "UTC"]),
    );
    expect(
      data.qualificationAlerts.map((item: { pilotId: string; daysRemaining: number }) => [
        item.pilotId,
        item.daysRemaining,
      ]),
    ).toEqual([
      ["shanghai", -1],
      ["la", 0],
    ]);
  });
});
