import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { authenticatePilot } from "@/server/auth";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/server/prisma", () => ({ getPrisma: () => ({ pilotSession: mocks }) }));
vi.mock("@/server/runtime-settings", () => ({
  getRuntimeSecurityPolicy: async () => ({ policyVersion: 1 }),
}));
vi.mock("@/server/compatibility-observability", () => ({ observeCompatibilityPath: vi.fn() }));

function fixture() {
  const profile = { id: "profile-a", personId: "person-a", legacyPilotId: "pilot-a" };
  return {
    id: "session-a",
    csrfTokenHash: "csrf",
    authState: "AUTHENTICATED",
    policyVersion: 1,
    lastSeenAt: new Date(),
    pilot: {
      id: "pilot-a",
      personId: "person-a",
      active: true,
      unitId: "unit-a",
      employeeNumber: "001",
      displayName: "Member",
      mobile: "",
      profile: { ...profile },
      unit: { id: "unit-a", organizationId: "org-a" },
      person: {
        id: "person-a",
        active: true,
        unitId: "unit-a",
        organizationId: "org-a",
        pilotProfile: { ...profile },
      },
    },
  };
}

function request(kind: "member" | "pilot" = "member") {
  return new NextRequest(`http://crewqual.test/api/${kind}/qualifications`, {
    headers: { cookie: `crewqual_${kind}_session=opaque-session` },
  });
}

describe("canonical member authentication boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["member", "pilot"] as const)(
    "resolves the same trusted identity for the %s cookie and route",
    async (kind) => {
      mocks.findFirst.mockResolvedValue(fixture());
      await expect(authenticatePilot(request(kind))).resolves.toMatchObject({
        id: "pilot-a",
        personId: "person-a",
        organizationId: "org-a",
        unitId: "unit-a",
      });
      expect(mocks.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            pilot: {
              include: { unit: true, profile: true, person: { include: { pilotProfile: true } } },
            },
          },
        }),
      );
    },
  );

  it.each([
    [
      "missing canonical link",
      (s: ReturnType<typeof fixture>) => {
        s.pilot.personId = "";
      },
    ],
    [
      "different canonical person",
      (s: ReturnType<typeof fixture>) => {
        s.pilot.person.id = "person-b";
      },
    ],
    [
      "disabled canonical person",
      (s: ReturnType<typeof fixture>) => {
        s.pilot.person.active = false;
      },
    ],
    [
      "disabled legacy person",
      (s: ReturnType<typeof fixture>) => {
        s.pilot.active = false;
      },
    ],
    [
      "different unit",
      (s: ReturnType<typeof fixture>) => {
        s.pilot.person.unitId = "unit-b";
      },
    ],
    [
      "missing organization",
      (s: ReturnType<typeof fixture>) => {
        s.pilot.person.organizationId = "";
      },
    ],
    [
      "different organization",
      (s: ReturnType<typeof fixture>) => {
        s.pilot.unit.organizationId = "org-b";
      },
    ],
    [
      "different profile",
      (s: ReturnType<typeof fixture>) => {
        s.pilot.profile.id = "profile-b";
      },
    ],
    [
      "different profile owner",
      (s: ReturnType<typeof fixture>) => {
        s.pilot.profile.personId = "person-b";
      },
    ],
    [
      "different legacy link",
      (s: ReturnType<typeof fixture>) => {
        s.pilot.person.pilotProfile.legacyPilotId = "pilot-b";
      },
    ],
  ] as const)("rejects %s even when a session is otherwise valid", async (_name, change) => {
    const session = fixture();
    change(session);
    mocks.findFirst.mockResolvedValue(session);
    await expect(authenticatePilot(request())).rejects.toMatchObject({
      code: "MEMBER_IDENTITY_INVALID",
      status: 403,
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each(["person", "profile", "unit"])(
    "rejects missing %s without falling back to a legacy-only identity",
    async (relation) => {
      const session = fixture();
      Object.assign(session.pilot, { [relation]: null });
      mocks.findFirst.mockResolvedValue(session);
      await expect(authenticatePilot(request(), { allowPending: true })).rejects.toMatchObject({
        code: "MEMBER_IDENTITY_INVALID",
      });
    },
  );

  it("rejects a missing canonical profile even when the reverse legacy profile exists", async () => {
    const session = fixture();
    Object.assign(session.pilot.person, { pilotProfile: null });
    mocks.findFirst.mockResolvedValue(session);
    await expect(authenticatePilot(request())).rejects.toMatchObject({
      code: "MEMBER_IDENTITY_INVALID",
    });
  });

  it("reads current ownership again after a member is transferred", async () => {
    const session = fixture();
    mocks.findFirst.mockResolvedValue(session);
    await expect(authenticatePilot(request())).resolves.toMatchObject({ unitId: "unit-a" });
    session.pilot.unitId = "unit-b";
    session.pilot.unit.id = "unit-b";
    session.pilot.person.unitId = "unit-b";
    await expect(authenticatePilot(request())).resolves.toMatchObject({ unitId: "unit-b" });
    expect(mocks.findFirst).toHaveBeenCalledTimes(2);
  });
});
