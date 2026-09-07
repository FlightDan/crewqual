import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ positions: vi.fn() }));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({ position: { findMany: mocks.positions } }),
}));
vi.mock("@/server/admin-guard", () => ({
  getAdmin: () => ({ roles: ["UNIT_ADMIN"], organizationId: "org-1", unitId: "unit-1" }),
}));

describe("position qualification statistics", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });
  it("counts missing required records and uses the same local-day rule as members", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T04:00:00Z"));
    const snapshot = {
      version: 1,
      validityRule: { kind: "manual_expiry" },
      reminders: { firstDays: 90, secondDays: 30 },
      parameterRestriction: { enabled: false, description: "" },
      ocrChecks: {
        enabled: false,
        credentialNumber: false,
        holderMatch: false,
        expiryDate: false,
        issuingAuthoritySeal: false,
      },
    };
    const definition = {
      id: "def-1",
      active: true,
      code: "CERT",
      legacyQualificationTypeId: "type-1",
    };
    const person = (id: string, withRecord: boolean) => ({
      id,
      organizationId: "org-1",
      unitId: "unit-1",
      unit: { id: "unit-1", timezone: "Asia/Shanghai", organizationId: "org-1" },
      qualificationAssignments: [
        {
          id: `a-${id}`,
          active: true,
          qualificationDefinitionId: "def-1",
          qualificationDefinition: definition,
          requirement: { active: true, required: true, position: { active: true } },
          positionAssignment: null,
        },
      ],
      qualificationRecords: withRecord
        ? [
            {
              id: `r-${id}`,
              qualificationDefinitionId: "def-1",
              expiryDate: new Date("2026-09-07T00:00:00Z"),
              qualificationRuleSnapshot: snapshot,
            },
          ]
        : [],
      legacyPilot: null,
    });
    mocks.positions.mockResolvedValue([
      {
        id: "position-1",
        requirements: [{ qualificationDefinitionId: "def-1" }],
        assignments: [
          {
            personId: "missing",
            effectiveFrom: new Date("2026-01-01"),
            effectiveTo: null,
            person: person("missing", false),
          },
          {
            personId: "today",
            effectiveFrom: new Date("2026-01-01"),
            effectiveTo: null,
            person: person("today", true),
          },
        ],
      },
    ]);
    const response = await GET(new NextRequest("http://localhost/api/admin/members/positions"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.items[0]).toMatchObject({
      missingCount: 1,
      expiredCount: 0,
      dueCount: 1,
      incompleteCount: 0,
      memberCount: 2,
      timezones: ["Asia/Shanghai"],
    });
    expect(mocks.positions).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          assignments: expect.objectContaining({
            where: { status: "ACTIVE", person: { organizationId: "org-1", unitId: "unit-1" } },
          }),
        }),
      }),
    );
  });
});
