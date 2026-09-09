import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { QualificationCustomField } from "@/types/services";

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  positionFindMany: vi.fn(),
  requirementFindMany: vi.fn(),
  requirementFindFirst: vi.fn(),
  definitionFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  txLastRequirement: vi.fn(),
  txRequirementUpdateMany: vi.fn(),
  txRequirementFindUnique: vi.fn(),
  txDefinitionCreate: vi.fn(),
  txDefinitionUpdate: vi.fn(),
  txRequirementCreate: vi.fn(),
  txAssignmentsFindMany: vi.fn(),
  txQualificationCreate: vi.fn(),
  txQualificationUpsert: vi.fn(),
  txQualificationUpdateMany: vi.fn(),
}));

const tx = {
  qualificationRequirement: {
    findFirst: mocks.txLastRequirement,
    create: mocks.txRequirementCreate,
    updateMany: mocks.txRequirementUpdateMany,
    findUniqueOrThrow: mocks.txRequirementFindUnique,
  },
  qualificationDefinition: {
    create: mocks.txDefinitionCreate,
    update: mocks.txDefinitionUpdate,
  },
  personPositionAssignment: { findMany: mocks.txAssignmentsFindMany },
  qualificationAssignment: {
    create: mocks.txQualificationCreate,
    upsert: mocks.txQualificationUpsert,
    updateMany: mocks.txQualificationUpdateMany,
  },
};

const db = {
  organization: { findUnique: mocks.organizationFindUnique },
  position: { findMany: mocks.positionFindMany },
  qualificationRequirement: {
    findMany: mocks.requirementFindMany,
    findFirst: mocks.requirementFindFirst,
  },
  qualificationDefinition: { findUnique: mocks.definitionFindUnique },
  auditEvent: { create: mocks.auditCreate },
  $transaction: mocks.transaction,
};

vi.mock("@/server/admin-guard", () => ({
  getAdmin: () =>
    Promise.resolve({
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000010",
      unitId: null,
      roles: ["SUPER_ADMIN"],
      permissions: ["operations.read", "operations.write"],
    }),
}));
vi.mock("@/server/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ APP_ORIGIN: "http://crewqual.test" }),
}));

import { GET, PATCH, POST } from "@/app/api/admin/qualification-configs/route";

const organizationId = "00000000-0000-4000-8000-000000000010";
const positionId = "00000000-0000-4000-8000-000000000020";
const definitionId = "00000000-0000-4000-8000-000000000030";
const requirementId = "00000000-0000-4000-8000-000000000040";
const assignmentId = "00000000-0000-4000-8000-000000000050";

const position = {
  id: positionId,
  organizationId,
  code: "CABIN_CREW",
  name: "乘务员",
  createdAt: new Date("2026-08-18T00:00:00.000Z"),
};

const configInput = {
  organizationId,
  positionCode: "CABIN_CREW",
  kind: "core" as const,
  name: "客舱应急训练",
  active: true,
  customFields: [] as QualificationCustomField[],
  parameterRestriction: {
    enabled: false,
    description: "",
    version: 1 as const,
    enforcement: { mode: "none" as const, allowedValues: [], pattern: "" },
  },
  validityRule: { kind: "manual_expiry" as const },
  reminders: { firstDays: 60, secondDays: 30 },
  ocrChecks: {
    enabled: false,
    credentialNumber: false,
    holderMatch: false,
    expiryDate: false,
    issuingAuthoritySeal: false,
  },
};

const definition = {
  id: definitionId,
  code: "cabin-crew-custom-12345678",
  name: configInput.name,
  active: true,
  fieldSchema: {
    fields: [{ name: "credentialNumber", required: true }],
    customFields: [],
  },
  parameterRestriction: configInput.parameterRestriction,
  validityRule: configInput.validityRule,
  reminders: configInput.reminders,
  ocrChecks: configInput.ocrChecks,
};

const requirement = {
  id: requirementId,
  positionId,
  qualificationDefinitionId: definitionId,
  required: true,
  upgradePrerequisite: true,
  active: true,
  sourcePackCode: null,
  sortOrder: 0,
  version: 1,
  createdAt: new Date("2026-08-18T00:00:00.000Z"),
  updatedAt: new Date("2026-08-18T00:00:00.000Z"),
  position,
  qualificationDefinition: definition,
};

function patchRequest(
  input: Omit<typeof configInput, "positionCode" | "kind"> & { expectedVersion?: number },
) {
  return new NextRequest(
    `http://crewqual.test/api/admin/qualification-configs?id=${requirementId}&positionCode=CABIN_CREW`,
    {
      method: "PATCH",
      headers: {
        origin: "http://crewqual.test",
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
}

describe("position-scoped qualification configs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.organizationFindUnique.mockResolvedValue({ id: organizationId });
    mocks.positionFindMany.mockResolvedValue([position]);
    mocks.requirementFindMany.mockResolvedValue([]);
    mocks.requirementFindFirst.mockResolvedValue(null);
    mocks.definitionFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.txLastRequirement.mockResolvedValue(null);
    mocks.txAssignmentsFindMany.mockResolvedValue([
      { id: assignmentId, personId: "00000000-0000-4000-8000-000000000060" },
    ]);
    mocks.txRequirementUpdateMany.mockResolvedValue({ count: 1 });
    mocks.txDefinitionUpdate.mockResolvedValue(definition);
    mocks.txRequirementFindUnique.mockResolvedValue({ ...requirement, version: 2 });
    mocks.txQualificationCreate.mockResolvedValue({});
    mocks.txQualificationUpsert.mockResolvedValue({});
    mocks.txQualificationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({});
  });

  it("returns an empty list for a position without requirements", async () => {
    const response = await GET(
      new NextRequest(
        "http://crewqual.test/api/admin/qualification-configs?positionCode=CABIN_CREW",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: [] });
    expect(mocks.requirementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { positionId: { in: [positionId] } } }),
    );
  });

  it("rejects an unknown position", async () => {
    mocks.positionFindMany.mockResolvedValue([]);

    const response = await GET(
      new NextRequest(
        "http://crewqual.test/api/admin/qualification-configs?positionCode=UNKNOWN_POSITION",
      ),
    );

    expect(response.status).toBe(404);
    expect(mocks.requirementFindMany).not.toHaveBeenCalled();
  });

  it("creates a core requirement and assigns it to existing position members", async () => {
    mocks.txDefinitionCreate.mockResolvedValue(definition);
    mocks.txRequirementCreate.mockResolvedValue(requirement);

    const response = await POST(
      new NextRequest("http://crewqual.test/api/admin/qualification-configs", {
        method: "POST",
        headers: {
          origin: "http://crewqual.test",
          "content-type": "application/json",
        },
        body: JSON.stringify(configInput),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: requirementId,
        positionCode: "CABIN_CREW",
        name: "客舱应急训练",
        core: true,
        locked: false,
      },
    });
    expect(mocks.txRequirementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ required: true, upgradePrerequisite: true }),
      }),
    );
    expect(mocks.txQualificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requirementId,
        positionAssignmentId: assignmentId,
        source: "POSITION_REQUIREMENT",
      }),
    });
  });

  it("maps supplemental projects to non-required position requirements", async () => {
    const supplementalRequirement = {
      ...requirement,
      required: false,
      upgradePrerequisite: false,
    };
    mocks.txDefinitionCreate.mockResolvedValue(definition);
    mocks.txRequirementCreate.mockResolvedValue(supplementalRequirement);

    const response = await POST(
      new NextRequest("http://crewqual.test/api/admin/qualification-configs", {
        method: "POST",
        headers: {
          origin: "http://crewqual.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...configInput, kind: "supplemental" }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { core: false } });
    expect(mocks.txRequirementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ required: false, upgradePrerequisite: false }),
      }),
    );
  });

  it("allows locked template requirements to rename but still protects deactivation", async () => {
    mocks.requirementFindFirst.mockResolvedValueOnce({
      ...requirement,
      sourcePackCode: "pilot-core-v1",
    });

    const response = await PATCH(
      patchRequest({
        ...configInput,
        name: "修改后的名称",
        expectedVersion: 1,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.positionFindMany.mockResolvedValue([position]);
    mocks.requirementFindFirst.mockResolvedValueOnce({
      ...requirement,
      sourcePackCode: "pilot-core-v1",
    });
    const deactivation = await PATCH(
      patchRequest({ ...configInput, active: false, expectedVersion: 1 }),
    );
    expect(deactivation.status).toBe(422);

    vi.clearAllMocks();
    mocks.positionFindMany.mockResolvedValue([position]);
    mocks.requirementFindFirst.mockResolvedValueOnce({
      ...requirement,
      sourcePackCode: "pilot-core-v1",
    });
    const structuredRuleChange = await PATCH(
      patchRequest({
        ...configInput,
        customFields: [
          {
            id: "field-license-number",
            label: "执照编号",
            valueType: "alphanumeric",
            required: true,
            minLength: 8,
            maxLength: 8,
            placeholder: "请输入 8 位英文和数字",
          },
        ],
        expectedVersion: 1,
      }),
    );
    expect(structuredRuleChange.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects stale writes with a version conflict", async () => {
    mocks.requirementFindFirst.mockResolvedValueOnce(requirement);
    mocks.txRequirementUpdateMany.mockResolvedValue({ count: 0 });

    const response = await PATCH(patchRequest({ ...configInput, expectedVersion: 1 }));

    expect(response.status).toBe(409);
    expect(mocks.txDefinitionUpdate).not.toHaveBeenCalled();
  });

  it("persists custom fill-in fields without removing the standard field schema", async () => {
    mocks.requirementFindFirst.mockResolvedValueOnce(requirement);
    const customFields = [
      {
        id: "field-license-number",
        label: "执照编号",
        valueType: "alphanumeric" as const,
        required: true,
        minLength: 8,
        maxLength: 8,
        placeholder: "请输入 8 位英文和数字",
      },
    ];

    const response = await PATCH(
      patchRequest({ ...configInput, customFields, expectedVersion: 1 }),
    );

    expect(response.status).toBe(200);
    expect(mocks.txDefinitionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fieldSchema: {
            fields: [{ name: "credentialNumber", required: true }],
            customFields,
          },
        }),
      }),
    );
  });

  it("ends assignments when a custom requirement is deactivated", async () => {
    mocks.requirementFindFirst.mockResolvedValueOnce(requirement);
    mocks.txRequirementFindUnique.mockResolvedValue({
      ...requirement,
      active: false,
      version: 2,
      qualificationDefinition: { ...definition, active: false },
    });

    const response = await PATCH(
      patchRequest({ ...configInput, active: false, expectedVersion: 1 }),
    );

    expect(response.status).toBe(200);
    expect(mocks.txQualificationUpdateMany).toHaveBeenCalledWith({
      where: { requirementId, active: true },
      data: expect.objectContaining({ active: false, version: { increment: 1 } }),
    });
    expect(mocks.txQualificationUpsert).not.toHaveBeenCalled();
  });

  it("restores assignments when a custom requirement is re-enabled", async () => {
    const inactiveRequirement = {
      ...requirement,
      active: false,
      qualificationDefinition: { ...definition, active: false },
    };
    mocks.requirementFindFirst.mockResolvedValueOnce(inactiveRequirement);
    mocks.txRequirementFindUnique.mockResolvedValue({ ...requirement, version: 2 });

    const response = await PATCH(
      patchRequest({ ...configInput, active: true, expectedVersion: 1 }),
    );

    expect(response.status).toBe(200);
    expect(mocks.txQualificationUpsert).toHaveBeenCalledWith({
      where: {
        positionAssignmentId_requirementId: {
          positionAssignmentId: assignmentId,
          requirementId,
        },
      },
      update: { active: true, endedAt: null, version: { increment: 1 } },
      create: expect.objectContaining({
        positionAssignmentId: assignmentId,
        requirementId,
      }),
    });
    expect(mocks.txQualificationUpdateMany).not.toHaveBeenCalled();
  });
});
