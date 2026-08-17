import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadEnvConfig } from "@next/env";
import argon2 from "argon2";
import { CORE_QUALIFICATION_CATALOG, UPGRADE_STAGE_NAMES } from "../src/types/services";
import {
  ADMIN_PERMISSION_CODES,
  ROLE_PERMISSION_CODES,
  type AdminRoleCode,
} from "../src/server/admin-permissions";
import { encryptSettingSecret } from "../src/server/crypto";
import { qualificationRuleSnapshot } from "../src/lib/qualification-rules";

loadEnvConfig(process.cwd());

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required to seed");
const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

const coreQualifications = CORE_QUALIFICATION_CATALOG.map(({ id, name }) => [id, name] as const);

async function main() {
  const unit = await prisma.organizationUnit.upsert({
    where: { code: "DEMO" },
    update: { name: "示例运行单位" },
    create: { code: "DEMO", name: "示例运行单位" },
  });
  for (const [code, name] of coreQualifications) {
    await prisma.qualificationType.upsert({
      where: { code },
      update: { name, core: true, active: true },
      create: {
        code,
        name,
        core: true,
        parameterRestriction: { enabled: false, description: "" },
        validityRule: { kind: "manual_expiry" },
        reminders: { firstDays: 30, secondDays: 7 },
        ocrChecks: {
          enabled: true,
          credentialNumber: true,
          holderMatch: true,
          expiryDate: true,
          issuingAuthoritySeal: false,
        },
      },
    });
  }
  const roles = [
    ["SUPER_ADMIN", "超级管理员"],
    ["ADMIN", "管理员"],
    ["REVIEWER", "审核员"],
    ["VIEWER", "只读查看员"],
  ] as const;
  const permissionDescriptions: Record<(typeof ADMIN_PERMISSION_CODES)[number], string> = {
    "dashboard.read": "查看总览",
    "pilots.read": "查看飞行员",
    "pilots.write": "新增、编辑、停用及批量导入飞行员",
    "reviews.read": "查看审核",
    "reviews.decide": "处理审核",
    "operations.read": "查看运营数据",
    "operations.write": "变更运营数据",
    "notifications.read": "查看通知记录",
    "notifications.retry": "重试通知",
    "settings.read": "访问系统设置",
    "settings.units.write": "维护所属单位设置",
    "settings.notifications.write": "维护通知设置",
    "settings.admins.write": "维护管理员与角色",
    "settings.security.write": "维护安全策略与会话",
    "audit.read": "查看安全审计",
  };
  for (const code of ADMIN_PERMISSION_CODES) {
    const description = permissionDescriptions[code];
    await prisma.permission.upsert({
      where: { code },
      update: { description },
      create: { code, description },
    });
  }
  for (const [code, name] of roles) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const permissionCode of ROLE_PERMISSION_CODES[code as AdminRoleCode]) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { code: permissionCode },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
  const email = process.env.INITIAL_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.INITIAL_ADMIN_PASSWORD ?? "change-me";
  const initialTotpSecret = process.env.INITIAL_ADMIN_TOTP_SECRET;
  if (process.env.NODE_ENV === "production") {
    const missing = [
      !process.env.INITIAL_ADMIN_PASSWORD && "INITIAL_ADMIN_PASSWORD",
      !initialTotpSecret && "INITIAL_ADMIN_TOTP_SECRET",
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(`Production seed requires: ${missing.join(", ")}`);
    }
  }
  const totpSecret = initialTotpSecret ?? "JBSWY3DPEHPK3PXP";
  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: {
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      totpSecretCiphertext: encryptSettingSecret(totpSecret),
      active: true,
      unitId: null,
      failedAttempts: 0,
      lockedUntil: null,
    },
    create: {
      email,
      displayName: "CrewQual 管理员",
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      totpSecretCiphertext: encryptSettingSecret(totpSecret),
      unitId: null,
    },
  });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
  await prisma.adminUserRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });
  const pilot = await prisma.pilot.upsert({
    where: { employeeNumber: "CQ-1049" },
    update: {
      mobile: "13800138000",
      displayName: "陈昊",
      initials: "CH",
      role: "机长",
      aircraftType: "A320",
      rankLabel: "机长",
      unitId: unit.id,
      active: true,
    },
    create: {
      employeeNumber: "CQ-1049",
      mobile: "13800138000",
      displayName: "陈昊",
      initials: "CH",
      role: "机长",
      aircraftType: "A320",
      rankLabel: "机长",
      unitId: unit.id,
      active: true,
    },
  });
  const seededExpiry = [
    "2027-08-10",
    "2027-01-20",
    "2027-12-15",
    "2028-06-30",
    "2028-03-15",
    "2027-02-10",
  ];
  for (const [index, [code]] of coreQualifications.entries()) {
    const qualificationType = await prisma.qualificationType.findUniqueOrThrow({ where: { code } });
    const existing = await prisma.qualificationRecord.findFirst({
      where: { pilotId: pilot.id, qualificationTypeId: qualificationType.id, status: "ACTIVE" },
    });
    const data = {
      credentialNumber: `CQ-${index + 1}-1049`,
      issueDate: new Date("2026-01-01T00:00:00.000Z"),
      expiryDate: new Date(`${seededExpiry[index]}T00:00:00.000Z`),
      issuingAuthority: "中国民航运行单位",
      levelOrParameter: "合格",
      qualificationRuleSnapshot: qualificationRuleSnapshot(qualificationType),
      lastVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    if (existing) await prisma.qualificationRecord.update({ where: { id: existing.id }, data });
    else
      await prisma.qualificationRecord.create({
        data: { pilotId: pilot.id, qualificationTypeId: qualificationType.id, ...data },
      });
  }
  const plan = await prisma.upgradePlan.upsert({
    where: { planNumber: "UP-SEED-1049" },
    update: {
      pilotId: pilot.id,
      title: "陈昊机长升级计划",
      type: "CAPTAIN_UPGRADE",
      lifecycleStatus: "ACTIVE",
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      endDate: new Date("2027-01-31T00:00:00.000Z"),
      overallOwner: "运行部",
      leadDepartment: "飞行部",
      supplementalRequirements: ["完成六项核心节点"],
    },
    create: {
      planNumber: "UP-SEED-1049",
      pilotId: pilot.id,
      title: "陈昊机长升级计划",
      type: "CAPTAIN_UPGRADE",
      lifecycleStatus: "ACTIVE",
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      endDate: new Date("2027-01-31T00:00:00.000Z"),
      overallOwner: "运行部",
      leadDepartment: "飞行部",
      supplementalRequirements: ["完成六项核心节点"],
    },
  });
  for (const [order, name] of UPGRADE_STAGE_NAMES.entries()) {
    await prisma.upgradeStage.upsert({
      where: { planId_order: { planId: plan.id, order } },
      update: {
        name,
        status: order === 0 ? "IN_PROGRESS" : order === 1 ? "SCHEDULED" : "NOT_STARTED",
        plannedStart: new Date(
          `2026-${String(8 + Math.floor(order / 2)).padStart(2, "0")}-01T00:00:00.000Z`,
        ),
        plannedEnd: new Date(
          `2026-${String(8 + Math.floor(order / 2)).padStart(2, "0")}-15T00:00:00.000Z`,
        ),
        owner: "运行部",
        notes: "",
      },
      create: {
        planId: plan.id,
        order,
        name,
        status: order === 0 ? "IN_PROGRESS" : order === 1 ? "SCHEDULED" : "NOT_STARTED",
        plannedStart: new Date(
          `2026-${String(8 + Math.floor(order / 2)).padStart(2, "0")}-01T00:00:00.000Z`,
        ),
        plannedEnd: new Date(
          `2026-${String(8 + Math.floor(order / 2)).padStart(2, "0")}-15T00:00:00.000Z`,
        ),
        owner: "运行部",
        notes: "",
      },
    });
  }
  const inspectionDefinitions = [
    ["oral-theory", "理论口试检查", "核验理论知识与口试结论"],
    ["simulator-skill", "模拟机技能检查", "记录模拟机场景与检查结论"],
    ["line-operation", "航线运行检查", "记录航线运行检查结论"],
  ] as const;
  for (const [code, name, description] of inspectionDefinitions) {
    await prisma.inspectionItem.upsert({
      where: { code },
      update: { name, description, active: true },
      create: {
        code,
        name,
        description,
        rule: { kind: "completion_record", required: true },
      },
    });
  }
  const oralItem = await prisma.inspectionItem.findUniqueOrThrow({
    where: { code: "oral-theory" },
  });
  const firstStage = await prisma.upgradeStage.findUniqueOrThrow({
    where: { planId_order: { planId: plan.id, order: 0 } },
  });
  await prisma.upgradePlanInspectionItem.upsert({
    where: {
      planId_inspectionItemId: { planId: plan.id, inspectionItemId: oralItem.id },
    },
    update: { stageId: firstStage.id },
    create: {
      planId: plan.id,
      inspectionItemId: oralItem.id,
      stageId: firstStage.id,
      nameSnapshot: oralItem.name,
      ruleVersionSnapshot: oralItem.ruleVersion,
      ruleSnapshot: oralItem.rule as never,
    },
  });
  console.log(
    `Seeded CrewQual roles, pilot CQ-1049 and admin ${email}. Set INITIAL_ADMIN_TOTP_SECRET before production use.`,
  );
}

main().finally(() => prisma.$disconnect());
