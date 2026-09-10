import { describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({ $disconnect: vi.fn() }));

vi.hoisted(() => {
  process.env.DIRECT_URL = "postgresql://test:test@127.0.0.1:5432/test";
});

vi.mock("@next/env", () => ({ loadEnvConfig: vi.fn() }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: vi.fn(() => prisma),
}));

import {
  ensureLegacyQualificationDefinitionLink,
  ensureMigrationPerson,
  linkMutablePilotProjections,
} from "../../scripts/migrate-member-architecture";
import { PILOT_TEMPLATE_PACK, repairLegacyQualificationTypes } from "./template-packs";

describe("member architecture migration audit safety", () => {
  it("repairs the v1.0.4 empty legacy qualification projection", async () => {
    const definitions = PILOT_TEMPLATE_PACK.qualificationDefinitions;
    const qualificationDefinition = {
      findUnique: vi.fn(
        async ({ where }: { where: { organizationId_code: { code: string } } }) => ({
          id: `definition-${where.organizationId_code.code}`,
          legacyQualificationTypeId: null,
        }),
      ),
      update: vi.fn(),
    };
    const qualificationType = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: { data: { code: string } }) => ({ id: `type-${data.code}` })),
    };

    await repairLegacyQualificationTypes(
      { qualificationDefinition, qualificationType } as never,
      "organization-1",
      definitions,
    );

    expect(qualificationType.create).toHaveBeenCalledTimes(definitions.length);
    expect(qualificationDefinition.update).toHaveBeenCalledTimes(definitions.length);
    expect(
      qualificationDefinition.update.mock.calls.map(
        ([call]) => call.data.legacyQualificationTypeId,
      ),
    ).toEqual(definitions.map((definition) => `type-${definition.code}`));
  });

  it("preserves an existing customized legacy type and is idempotent", async () => {
    const [definition] = PILOT_TEMPLATE_PACK.qualificationDefinitions;
    const findDefinition = vi
      .fn()
      .mockResolvedValueOnce({ id: "definition-1", legacyQualificationTypeId: null })
      .mockResolvedValue({ id: "definition-1", legacyQualificationTypeId: "type-1" });
    const qualificationType = {
      findUnique: vi.fn().mockResolvedValue({ id: "type-1" }),
      create: vi.fn(),
    };
    const qualificationDefinition = { findUnique: findDefinition, update: vi.fn() };
    const tx = { qualificationDefinition, qualificationType };

    await repairLegacyQualificationTypes(tx as never, "organization-1", [definition]);
    await repairLegacyQualificationTypes(tx as never, "organization-1", [definition]);

    expect(qualificationType.create).not.toHaveBeenCalled();
    expect(qualificationDefinition.update).toHaveBeenCalledTimes(1);
    expect(qualificationDefinition.update).toHaveBeenCalledWith({
      where: { id: "definition-1" },
      data: { legacyQualificationTypeId: "type-1" },
    });
  });

  it("does not update immutable AuditEvent rows", async () => {
    const tx = {
      evidenceImage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      notificationDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: {
        updateMany: vi.fn().mockRejectedValue(new Error("AuditEvent is append-only")),
      },
    };

    await expect(
      linkMutablePilotProjections(tx as never, "pilot-1", "person-1"),
    ).resolves.toBeUndefined();
    expect(tx.evidenceImage.updateMany).toHaveBeenCalledWith({
      where: { pilotId: "pilot-1" },
      data: { personId: "person-1" },
    });
    expect(tx.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: { pilotId: "pilot-1" },
      data: { personId: "person-1" },
    });
    expect(tx.auditEvent.updateMany).not.toHaveBeenCalled();
  });

  it("backfills a template-installed definition's legacy link idempotently", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "definition-1",
      legacyQualificationTypeId: "legacy-type-1",
    });
    const tx = { qualificationDefinition: { update } };

    await expect(
      ensureLegacyQualificationDefinitionLink(
        tx as never,
        { id: "definition-1", legacyQualificationTypeId: null },
        "legacy-type-1",
      ),
    ).resolves.toEqual({
      id: "definition-1",
      legacyQualificationTypeId: "legacy-type-1",
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "definition-1" },
      data: { legacyQualificationTypeId: "legacy-type-1" },
      select: { id: true, legacyQualificationTypeId: true },
    });

    update.mockClear();
    await expect(
      ensureLegacyQualificationDefinitionLink(
        tx as never,
        { id: "definition-1", legacyQualificationTypeId: "legacy-type-1" },
        "legacy-type-1",
      ),
    ).resolves.toEqual({
      id: "definition-1",
      legacyQualificationTypeId: "legacy-type-1",
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("member migration canonical identity", () => {
  const pilot = {
    id: "pilot-1",
    personId: "canonical-1" as string | null,
    unitId: "unit-1",
    employeeNumber: "CQ-1",
    mobile: "legacy-mobile",
    displayName: "Legacy name",
    initials: "LN",
    active: true,
    version: 2,
  };
  const canonical = {
    id: "canonical-1",
    organizationId: "org-1",
    unitId: "unit-1",
    employeeNumber: "CQ-1",
    displayName: "Canonical name",
    mobile: "canonical-mobile",
    active: false,
    version: 9,
    legacyPilot: { id: pilot.id },
  };
  function database(existing: unknown = canonical, snapshot = pilot) {
    return {
      $queryRaw: vi
        .fn<(sql: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>>()
        .mockResolvedValue([snapshot]),
      person: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn().mockResolvedValue({ ...canonical, id: pilot.id }),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      pilot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
  }
  it("reuses a linked Person with a different ID on every rerun without overwriting canonical fields/version", async () => {
    const tx = database();
    for (let run = 0; run < 2; run += 1) {
      expect(await ensureMigrationPerson(tx as never, pilot, "org-1")).toEqual(canonical);
    }
    expect(tx.person.findUnique).toHaveBeenCalledWith({
      where: { id: "canonical-1" },
      include: { legacyPilot: { select: { id: true } } },
    });
    expect(tx.person.create).not.toHaveBeenCalled();
    expect(tx.person.update).not.toHaveBeenCalled();
    expect(tx.person.upsert).not.toHaveBeenCalled();
    expect(tx.pilot.updateMany).not.toHaveBeenCalled();
  });
  it("locks the Pilot with a bound ID before looking up canonical identity", async () => {
    const tx = database();
    await ensureMigrationPerson(tx as never, pilot, "org-1");
    const [sql, boundId] = tx.$queryRaw.mock.calls[0]!;
    expect((sql as unknown as string[]).join("?")).toContain(
      'FROM "Pilot" WHERE id = ?::uuid FOR UPDATE',
    );
    expect(boundId).toBe(pilot.id);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.person.findUnique.mock.invocationCallOrder[0]!,
    );
  });
  it.each([
    { version: 3 },
    { personId: "new-person" },
    { unitId: "new-unit" },
    { employeeNumber: "new-number" },
  ])("rejects a changed locked snapshot before reading or changing Person: %j", async (changed) => {
    const tx = database(canonical, { ...pilot, ...changed });
    await expect(ensureMigrationPerson(tx as never, pilot, "org-1")).rejects.toThrow(
      "pilot snapshot changed during migration",
    );
    expect(tx.person.findUnique).not.toHaveBeenCalled();
    expect(tx.person.create).not.toHaveBeenCalled();
    expect(tx.pilot.updateMany).not.toHaveBeenCalled();
  });
  it("retains the historical same-ID bridge when no explicit canonical link exists", async () => {
    const tx = database(
      { ...canonical, id: pilot.id, legacyPilot: null },
      { ...pilot, personId: null },
    );
    expect(
      await ensureMigrationPerson(tx as never, { ...pilot, personId: null }, "org-1"),
    ).toMatchObject({ id: pilot.id, version: 9 });
    expect(tx.pilot.updateMany).toHaveBeenCalledWith({
      where: { id: pilot.id, personId: null },
      data: { personId: pilot.id },
    });
    expect(tx.person.create).not.toHaveBeenCalled();
  });
  it("does not bind an unrelated Person merely because its employee number matches", async () => {
    const tx = database(null, { ...pilot, personId: null });
    tx.person.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "another-person" });
    await expect(
      ensureMigrationPerson(tx as never, { ...pilot, personId: null }, "org-1"),
    ).rejects.toThrow("employee number belongs to a different canonical identity");
    expect(tx.person.create).not.toHaveBeenCalled();
    expect(tx.pilot.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    [{ organizationId: "another-org" }, "canonical organization differs"],
    [{ unitId: "another-unit" }, "canonical unit differs"],
    [{ employeeNumber: "another-employee" }, "canonical employee number differs"],
    [{ legacyPilot: { id: "another-pilot" } }, "person is already linked to another pilot"],
  ])("fails closed for conflicting canonical identity %j", async (difference, message) => {
    const tx = database({ ...canonical, ...difference });
    await expect(ensureMigrationPerson(tx as never, pilot, "org-1")).rejects.toThrow(message);
    expect(tx.person.create).not.toHaveBeenCalled();
    expect(tx.person.update).not.toHaveBeenCalled();
    expect(tx.pilot.updateMany).not.toHaveBeenCalled();
  });
  it("does not replace an explicitly linked missing Person with a new identity", async () => {
    const tx = database(null);
    await expect(ensureMigrationPerson(tx as never, pilot, "org-1")).rejects.toThrow(
      "linked canonical person is missing",
    );
    expect(tx.person.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.person.create).not.toHaveBeenCalled();
  });
  it("creates a legacy projection only when both identity and employee number are free", async () => {
    const tx = database(null, { ...pilot, personId: null });
    await ensureMigrationPerson(tx as never, { ...pilot, personId: null }, "org-1");
    expect(tx.person.create).toHaveBeenCalledWith({
      data: {
        id: pilot.id,
        organizationId: "org-1",
        unitId: pilot.unitId,
        employeeNumber: pilot.employeeNumber,
        mobile: pilot.mobile,
        displayName: pilot.displayName,
        initials: pilot.initials,
        active: pilot.active,
        version: pilot.version,
      },
    });
    expect(tx.pilot.updateMany).toHaveBeenCalledWith({
      where: { id: pilot.id, personId: null },
      data: { personId: pilot.id },
    });
  });
  it("rejects a concurrent canonical relink instead of overwriting it", async () => {
    const tx = database(
      { ...canonical, id: pilot.id, legacyPilot: null },
      { ...pilot, personId: null },
    );
    tx.pilot.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      ensureMigrationPerson(tx as never, { ...pilot, personId: null }, "org-1"),
    ).rejects.toThrow("pilot canonical link changed during migration");
  });
});
