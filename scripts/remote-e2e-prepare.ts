import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { qualificationRuleSnapshot } from "../src/lib/qualification-rules";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required");

const employeeNumber = process.env.E2E_PILOT_EMPLOYEE_NUMBER;
if (!employeeNumber || !/^CQ-E2E-[A-Z0-9-]{1,20}$/.test(employeeNumber)) {
  throw new Error("E2E_PILOT_EMPLOYEE_NUMBER must match CQ-E2E-<run-id>");
}
const stableEmployeeNumber = employeeNumber;

const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

async function main() {
  const unit = await prisma.organizationUnit.findUniqueOrThrow({ where: { code: "DEMO" } });
  const qualificationType = await prisma.qualificationType.findUniqueOrThrow({
    where: { code: "chinese-language-assessment" },
  });
  const pilot = await prisma.pilot.upsert({
    where: { employeeNumber },
    update: {
      mobile: "13800138000",
      displayName: "陈昊",
      initials: "CH",
      roleCode: "CAPTAIN",
      aircraftType: "A320",
      rankLabel: "机长",
      unitId: unit.id,
      active: true,
    },
    create: {
      employeeNumber: stableEmployeeNumber,
      mobile: "13800138000",
      displayName: "陈昊",
      initials: "CH",
      roleCode: "CAPTAIN",
      aircraftType: "A320",
      rankLabel: "机长",
      unitId: unit.id,
      active: true,
    },
  });
  // Rate-limit dimensions are HMACed before storage, so the disposable E2E
  // database is reset as a whole instead of searching for a plaintext prefix.
  await prisma.rateLimitBucket.deleteMany({});
  await prisma.adminUser.updateMany({
    where: { email: process.env.E2E_ADMIN_EMAIL ?? "admin@example.com" },
    // The configuration scenario targets DEMO's PILOT position. A bootstrap
    // organization may coexist in this disposable database, so a global null
    // organization would correctly be rejected as an ambiguous position code.
    data: { failedAttempts: 0, lockedUntil: null, organizationId: unit.organizationId },
  });
  const coreTypes = await prisma.qualificationType.findMany({
    where: { core: true, active: true },
  });
  for (const coreType of coreTypes) {
    const current = await prisma.qualificationRecord.findFirst({
      where: { pilotId: pilot.id, qualificationTypeId: coreType.id, status: "ACTIVE" },
    });
    if (!current) {
      await prisma.qualificationRecord.create({
        data: {
          pilotId: pilot.id,
          qualificationTypeId: coreType.id,
          credentialNumber: `CORE-${coreType.code}-${stableEmployeeNumber}`,
          issueDate: new Date("2026-01-01T00:00:00.000Z"),
          expiryDate: new Date("2028-12-31T00:00:00.000Z"),
          issuingAuthority: "CrewQual E2E",
          levelOrParameter: "合格",
          qualificationRuleSnapshot: qualificationRuleSnapshot(coreType),
          lastVerifiedAt: new Date(),
        },
      });
    }
  }
  const ruleTypes = [
    [
      "e2e-fixed-issue",
      "E2E 签发日固定有效期",
      { kind: "fixed_months", baseDateField: "issueDate", months: 1 },
    ],
    [
      "e2e-fixed-training",
      "E2E 训练日固定有效期",
      { kind: "fixed_months", baseDateField: "trainingDate", months: 1 },
    ],
    ["e2e-manual", "E2E 手工有效期", { kind: "manual_expiry" }],
    ["e2e-nonexp", "E2E 永久有效", { kind: "non_expiring" }],
  ] as const;
  for (const [code, name, validityRule] of ruleTypes) {
    await prisma.qualificationType.upsert({
      where: { code },
      update: { name, active: true, validityRule },
      create: {
        code,
        name,
        core: false,
        active: true,
        parameterRestriction: {
          enabled: false,
          description: "",
          version: 1,
          enforcement: { mode: "none" },
        },
        validityRule,
        reminders: { firstDays: 90, secondDays: 30 },
        ocrChecks: {
          enabled: false,
          credentialNumber: false,
          holderMatch: false,
          expiryDate: false,
          issuingAuthoritySeal: false,
        },
      },
    });
  }
  const activeRecord = await prisma.qualificationRecord.findFirst({
    where: { pilotId: pilot.id, qualificationTypeId: qualificationType.id, status: "ACTIVE" },
  });
  const data = {
    credentialNumber: `CQ-E2E-${stableEmployeeNumber.slice("CQ-E2E-".length)}`,
    issueDate: new Date("2026-01-01T00:00:00.000Z"),
    expiryDate: new Date("2028-08-14T00:00:00.000Z"),
    issuingAuthority: "中国民航运行单位",
    levelOrParameter: "合格",
    qualificationRuleSnapshot: qualificationRuleSnapshot(qualificationType),
    lastVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
  if (activeRecord) {
    await prisma.qualificationRecord.update({ where: { id: activeRecord.id }, data });
  } else {
    await prisma.qualificationRecord.create({
      data: { pilotId: pilot.id, qualificationTypeId: qualificationType.id, ...data },
    });
  }
  console.log(JSON.stringify({ employeeNumber, credentialNumber: data.credentialNumber }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
