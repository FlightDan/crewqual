import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  organization: vi.fn(),
  positions: vi.fn(),
  requirements: vi.fn(),
  requirement: vi.fn(),
  definitions: vi.fn(),
  definition: vi.fn(),
  definitionUnique: vi.fn(),
  definitionCreate: vi.fn(),
  definitionUpdate: vi.fn(),
  definitionResult: vi.fn(),
  packs: vi.fn(),
  install: vi.fn(),
}));
vi.mock("@/server/admin-guard", () => ({ getAdmin: mocks.admin }));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ APP_ORIGIN: "http://crewqual.test" }),
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    organization: { findUnique: mocks.organization },
    position: { findMany: mocks.positions },
    qualificationRequirement: { findMany: mocks.requirements, findFirst: mocks.requirement },
    qualificationDefinition: {
      findMany: mocks.definitions,
      findFirst: mocks.definition,
      findUnique: mocks.definitionUnique,
      create: mocks.definitionCreate,
      updateMany: mocks.definitionUpdate,
      findUniqueOrThrow: mocks.definitionResult,
    },
    templatePack: { findMany: mocks.packs },
  }),
}));
vi.mock("@/server/template-packs", () => ({
  installTemplatePack: mocks.install,
  templatePackSchema: {},
  registerTemplatePack: vi.fn(),
}));

import {
  GET as listDefinitions,
  PATCH as updateDefinition,
  POST as createDefinition,
} from "@/app/api/admin/qualification-definitions/route";
import {
  GET as listConfigs,
  PATCH as updateConfig,
  POST as createConfig,
} from "@/app/api/admin/qualification-configs/route";
import { GET as getConfig } from "@/app/api/admin/qualification-configs/[id]/route";
import { GET as listPacks } from "@/app/api/admin/template-packs/route";
import { POST as installPack } from "@/app/api/admin/template-packs/[templatePackId]/install/route";

const orgA = "00000000-0000-4000-8000-000000000001";
const orgB = "00000000-0000-4000-8000-000000000002";
const admin = { id: "admin-a", roles: ["SUPER_ADMIN"], unitId: "unit-a", organizationId: orgA };
const definitionBody = {
  name: "Test qualification",
  validityRule: { kind: "manual_expiry" },
  reminders: { firstDays: 60, secondDays: 30 },
  ocrChecks: {
    enabled: false,
    credentialNumber: false,
    holderMatch: false,
    expiryDate: false,
    issuingAuthoritySeal: false,
  },
  parameterRestriction: {
    enabled: false,
    description: "",
    version: 1,
    enforcement: { mode: "none", allowedValues: [], pattern: "" },
  },
};
function request(route: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://crewqual.test/api/admin/${route}`, {
    method,
    headers: { origin: "http://crewqual.test", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const context = { params: Promise.resolve({ templatePackId: "pack-a" }) };

describe("configuration routes preserve organization boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin.mockResolvedValue(admin);
    mocks.organization.mockImplementation(({ where }) => Promise.resolve({ id: where.id }));
    mocks.definitions.mockResolvedValue([]);
    mocks.positions.mockResolvedValue([{ id: "position-a" }, { id: "position-b" }]);
    mocks.requirements.mockResolvedValue([]);
    mocks.requirement.mockResolvedValue(null);
    mocks.packs.mockResolvedValue([]);
    mocks.definition.mockResolvedValue(null);
    mocks.definitionUnique.mockResolvedValue(null);
    mocks.definitionCreate.mockImplementation(({ data }) =>
      Promise.resolve({ id: "definition-new", ...data }),
    );
    mocks.install.mockResolvedValue({ status: "installed" });
  });

  it.each(["SUPER_ADMIN", "ADMIN"])(
    "uses the %s scope for definitions and installation records",
    async (role) => {
      mocks.admin.mockResolvedValue({ ...admin, roles: [role] });
      const where = role === "SUPER_ADMIN" ? {} : { organizationId: orgA };
      expect((await listDefinitions(request("qualification-definitions"))).status).toBe(200);
      expect(mocks.definitions).toHaveBeenCalledWith(expect.objectContaining({ where }));
      expect((await listPacks(request("template-packs"))).status).toBe(200);
      expect(mocks.packs).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { installations: expect.objectContaining({ where }) },
        }),
      );
    },
  );

  it("lists matching positions from every organization for a global administrator", async () => {
    expect((await listConfigs(request("qualification-configs?positionCode=PILOT"))).status).toBe(
      200,
    );
    expect(mocks.positions).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: "PILOT" } }),
    );
    expect(mocks.requirements).toHaveBeenCalledWith(
      expect.objectContaining({ where: { positionId: { in: ["position-a", "position-b"] } } }),
    );
  });

  it("resolves a global config by its ID without an ambiguous cross-organization position lookup", async () => {
    expect(
      (
        await getConfig(request("qualification-configs/record-b?positionCode=PILOT"), {
          params: Promise.resolve({ id: "record-b" }),
        })
      ).status,
    ).toBe(404);
    expect(mocks.requirement).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "record-b", position: { code: "PILOT" } } }),
    );
    expect(mocks.positions).not.toHaveBeenCalled();
  });

  it.each(["SUPER_ADMIN", "ADMIN"])(
    "checks %s config mutations by record ID and trusted organization scope",
    async (role) => {
      mocks.admin.mockResolvedValue({ ...admin, roles: [role] });
      const response = await updateConfig(
        request("qualification-configs?id=record-b&positionCode=PILOT", "PATCH", {
          ...definitionBody,
          active: true,
          customFields: [],
        }),
      );
      expect(response.status).toBe(404);
      expect(mocks.requirement).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "record-b",
            position: {
              code: "PILOT",
              ...(role === "SUPER_ADMIN" ? {} : { organizationId: orgA }),
            },
          },
        }),
      );
      expect(mocks.positions).not.toHaveBeenCalled();
    },
  );

  it("allows a global definition update without moving its organization", async () => {
    mocks.definition.mockResolvedValue({ id: "definition-b", organizationId: orgB });
    mocks.definitionUpdate.mockResolvedValue({ count: 1 });
    mocks.definitionResult.mockResolvedValue({ id: "definition-b", organizationId: orgB });
    expect(
      (
        await updateDefinition(
          request("qualification-definitions?id=definition-b", "PATCH", definitionBody),
        )
      ).status,
    ).toBe(200);
    expect(mocks.definition).toHaveBeenCalledWith({ where: { id: "definition-b" } });
    expect(mocks.definitionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "definition-b" } }),
    );
    expect(mocks.definitionUpdate.mock.calls[0][0].data).not.toHaveProperty("organizationId");
  });

  it("does not update an ordinary administrator's out-of-scope definition", async () => {
    mocks.admin.mockResolvedValue({ ...admin, roles: ["ADMIN"] });
    expect(
      (
        await updateDefinition(
          request("qualification-definitions?id=definition-b", "PATCH", definitionBody),
        )
      ).status,
    ).toBe(404);
    expect(mocks.definition).toHaveBeenCalledWith({
      where: { id: "definition-b", organizationId: orgA },
    });
    expect(mocks.definitionUpdate).not.toHaveBeenCalled();
  });

  it("requires an explicit global creation/install target and preserves an explicitly selected target", async () => {
    expect(
      (await createDefinition(request("qualification-definitions", "POST", definitionBody))).status,
    ).toBe(422);
    expect(
      (
        await createConfig(
          request("qualification-configs", "POST", {
            ...definitionBody,
            positionCode: "PILOT",
            kind: "core",
            active: true,
            customFields: [],
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (await installPack(request("template-packs/pack-a/install", "POST", {}), context)).status,
    ).toBe(422);
    expect(mocks.definitionCreate).not.toHaveBeenCalled();
    expect(mocks.positions).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(
      (
        await createDefinition(
          request("qualification-definitions", "POST", { ...definitionBody, organizationId: orgB }),
        )
      ).status,
    ).toBe(201);
    expect(mocks.definitionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: orgB }) }),
    );
    expect(
      (
        await installPack(
          request("template-packs/pack-a/install", "POST", { organizationId: orgB }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(mocks.install).toHaveBeenCalledWith(orgB, "pack-a", admin.id);
  });

  it("rejects an ordinary administrator's foreign selection across reads, creates and installs", async () => {
    mocks.admin.mockResolvedValue({ ...admin, roles: ["ADMIN"] });
    expect(
      (await listDefinitions(request(`qualification-definitions?organizationId=${orgB}`))).status,
    ).toBe(403);
    expect(
      (
        await listConfigs(
          request(`qualification-configs?positionCode=PILOT&organizationId=${orgB}`),
        )
      ).status,
    ).toBe(403);
    expect((await listPacks(request(`template-packs?organizationId=${orgB}`))).status).toBe(403);
    expect(
      (
        await createDefinition(
          request("qualification-definitions", "POST", { ...definitionBody, organizationId: orgB }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await installPack(
          request("template-packs/pack-a/install", "POST", { organizationId: orgB }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(mocks.definitions).not.toHaveBeenCalled();
    expect(mocks.positions).not.toHaveBeenCalled();
    expect(mocks.packs).not.toHaveBeenCalled();
    expect(mocks.definitionCreate).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
  });
});
