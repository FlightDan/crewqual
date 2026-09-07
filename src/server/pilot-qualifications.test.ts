import { describe, expect, it, vi } from "vitest";
import {
  listPilotQualifications,
  pilotQualificationStates,
  type QualificationPilot,
} from "./pilot-qualifications";
const mocks = vi.hoisted(() => ({ pilot: vi.fn(), types: vi.fn().mockResolvedValue([]) }));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    pilot: { findUnique: mocks.pilot },
    qualificationType: { findMany: mocks.types },
  }),
}));
const clock = { now: () => new Date("2026-09-07T04:00:00Z") };
const record = (personId: string | null) => ({
  id: "record",
  pilotId: "pilot",
  personId,
  qualificationTypeId: "type",
  expiryDate: new Date("2026-09-07T00:00:00Z"),
  qualificationRuleSnapshot: { version: 1, validityRule: { kind: "manual_expiry" } },
  qualificationType: {
    id: "type",
    code: "CERT",
    name: "Certificate",
    active: true,
    validityRule: { kind: "manual_expiry" },
    parameterRestriction: { enabled: false, description: "" },
  },
});
const pilot = (personId: string | null, recordPersonId: string | null) =>
  ({
    id: "pilot",
    personId,
    unitId: "unit",
    unit: { id: "unit", organizationId: "org", timezone: "America/Los_Angeles" },
    person: personId
      ? {
          id: personId,
          organizationId: "org",
          unitId: "unit",
          unit: { id: "unit", organizationId: "org", timezone: "America/Los_Angeles" },
          legacyPilot: null,
          qualificationAssignments: [],
          qualificationRecords: [],
        }
      : null,
    qualifications: [record(recordPersonId)],
  }) as unknown as QualificationPilot;
describe("pilot qualification projection", () => {
  it.each([null, "person-a"])(
    "does not append another person's legacy records for %s",
    async (personId) => {
      const holder = pilot(personId, "person-b");
      mocks.pilot.mockResolvedValue(holder);
      expect(pilotQualificationStates(holder, clock).items).toEqual([]);
      expect(await listPilotQualifications(holder.id, clock)).toEqual([]);
    },
  );
  it("keeps unassigned legacy evidence optional and decodes DATE independently from the unit clock", async () => {
    const holder = pilot("person-a", null);
    mocks.pilot.mockResolvedValue(holder);
    const result = pilotQualificationStates(holder, clock);
    expect(result.health).toBe("unconfigured");
    expect(result.items[0]).toMatchObject({
      required: false,
      assigned: false,
      state: { status: "due_30", daysRemaining: 1 },
    });
    expect((await listPilotQualifications(holder.id, clock))[0]).toMatchObject({
      expiresOn: "2026-09-07",
      daysRemaining: 1,
      required: false,
    });
  });
});
