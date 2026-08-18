import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  ADMIN_PERMISSION_CODES,
  ADMIN_ROLE_CODES,
  ROLE_PERMISSION_CODES,
  type AdminRoleCode,
} from "../src/server/admin-permissions";
import { encryptSettingSecret } from "../src/server/crypto";
import { installTemplatePackInTransaction } from "../src/server/template-packs";

const roleNames: Record<AdminRoleCode, string> = {
  SUPER_ADMIN: "超级管理员",
  ADMIN: "管理员",
  REVIEWER: "审核员",
  VIEWER: "只读查看员",
};

const defaultBaseline = {
  organizationCode: "CREWQUAL",
  organizationName: "CrewQual",
  unitCode: "ROOT",
  unitName: "运行单位",
  templatePackCode: "aviation-china-airline-pilot",
};

function baselineValue(name: keyof typeof defaultBaseline) {
  return (
    process.env[
      name === "organizationCode"
        ? "INITIAL_ORGANIZATION_CODE"
        : name === "organizationName"
          ? "INITIAL_ORGANIZATION_NAME"
          : name === "unitCode"
            ? "INITIAL_UNIT_CODE"
            : name === "unitName"
              ? "INITIAL_UNIT_NAME"
              : "INITIAL_TEMPLATE_PACK_CODE"
    ]?.trim() || defaultBaseline[name]
  );
}

async function main() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required");

  const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });
  try {
    const roles = new Map<AdminRoleCode, { id: string }>();
    for (const code of ADMIN_ROLE_CODES) {
      const role = await prisma.role.upsert({
        where: { code },
        update: { name: roleNames[code] },
        create: { code, name: roleNames[code] },
        select: { id: true },
      });
      roles.set(code, role);
    }

    const permissions = await prisma.permission.findMany({
      where: { code: { in: [...ADMIN_PERMISSION_CODES] } },
      select: { id: true, code: true },
    });
    const permissionIds = new Map(
      permissions.map((permission) => [permission.code, permission.id]),
    );
    const missingPermissions = ADMIN_PERMISSION_CODES.filter((code) => !permissionIds.has(code));
    if (missingPermissions.length) {
      throw new Error(
        `Database migrations did not create permissions: ${missingPermissions.join(", ")}`,
      );
    }

    await prisma.$transaction(async (tx) => {
      for (const code of ADMIN_ROLE_CODES) {
        const role = roles.get(code);
        if (!role) throw new Error(`Role bootstrap failed: ${code}`);
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({
          data: ROLE_PERMISSION_CODES[code].map((permissionCode) => ({
            roleId: role.id,
            permissionId: permissionIds.get(permissionCode)!,
          })),
          skipDuplicates: true,
        });
      }
    });

    const activeSuperAdmins = await prisma.adminUser.count({
      where: {
        active: true,
        roles: { some: { role: { code: "SUPER_ADMIN" } } },
      },
    });
    if (activeSuperAdmins > 0) {
      console.log(
        JSON.stringify({ event: "production_bootstrap_complete", initialAdmin: "already_exists" }),
      );
      return;
    }

    const initialValues = {
      email: process.env.INITIAL_ADMIN_EMAIL?.trim() ?? "",
      password: process.env.INITIAL_ADMIN_PASSWORD?.trim() ?? "",
      totpSecret: process.env.INITIAL_ADMIN_TOTP_SECRET?.trim().toUpperCase() ?? "",
    };
    const suppliedValues = Object.values(initialValues).filter(Boolean).length;
    if (suppliedValues === 0) {
      console.log(
        JSON.stringify({
          event: "production_bootstrap_complete",
          initialAdmin: "web_setup_required",
        }),
      );
      return;
    }
    if (suppliedValues !== 3) {
      throw new Error(
        "Provide all of INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD and INITIAL_ADMIN_TOTP_SECRET, or leave all three empty for web setup",
      );
    }
    const email = initialValues.email.toLowerCase();
    const password = initialValues.password;
    const totpSecret = initialValues.totpSecret;
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("INITIAL_ADMIN_EMAIL is invalid");
    if (password.length < 12) {
      throw new Error("INITIAL_ADMIN_PASSWORD must contain at least 12 characters");
    }
    if (!/^[A-Z2-7]{16,}$/.test(totpSecret)) {
      throw new Error(
        "INITIAL_ADMIN_TOTP_SECRET must be a base32 secret of at least 16 characters",
      );
    }
    const existing = await prisma.adminUser.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new Error(
        `Refusing to overwrite existing non-super-admin account ${email}; use the admin reset command`,
      );
    }

    const superAdminRole = roles.get("SUPER_ADMIN");
    if (!superAdminRole) throw new Error("SUPER_ADMIN role bootstrap failed");
    const organizationCode = baselineValue("organizationCode").toUpperCase();
    const organizationName = baselineValue("organizationName");
    const unitCode = baselineValue("unitCode").toUpperCase();
    const unitName = baselineValue("unitName");
    const templatePackCode = baselineValue("templatePackCode");
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(organizationCode))
      throw new Error("INITIAL_ORGANIZATION_CODE is invalid");
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(unitCode)) throw new Error("INITIAL_UNIT_CODE is invalid");
    if (!organizationName || !unitName || !templatePackCode)
      throw new Error("Initial organization, unit and template values are required");

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.upsert({
        where: { code: organizationCode },
        update: { name: organizationName, active: true, defaultLocale: "zh-CN" },
        create: { code: organizationCode, name: organizationName, defaultLocale: "zh-CN" },
        select: { id: true },
      });
      const unit = await tx.organizationUnit.upsert({
        where: { code: unitCode },
        update: {
          name: unitName,
          organizationId: organization.id,
          active: true,
          timezone: "Asia/Shanghai",
        },
        create: {
          code: unitCode,
          name: unitName,
          organizationId: organization.id,
          timezone: "Asia/Shanghai",
        },
        select: { id: true },
      });
      const admin = await tx.adminUser.create({
        data: {
          email,
          displayName: "CrewQual 管理员",
          passwordHash,
          totpSecretCiphertext: encryptSettingSecret(totpSecret),
          organizationId: organization.id,
          unitId: unit.id,
          roles: { create: { roleId: superAdminRole.id } },
        },
        select: { id: true },
      });
      const pack = await tx.templatePack.findFirst({
        where: { code: templatePackCode, active: true },
        orderBy: { version: "desc" },
        select: { id: true, code: true, version: true },
      });
      if (!pack) throw new Error(`Active template pack not found: ${templatePackCode}`);
      const installation = await installTemplatePackInTransaction(
        tx,
        organization.id,
        pack.id,
        admin.id,
      );
      return {
        organizationId: organization.id,
        unitId: unit.id,
        adminId: admin.id,
        templatePack: `${pack.code}@${pack.version}`,
        installation,
      };
    });
    console.log(
      JSON.stringify({
        event: "production_bootstrap_complete",
        initialAdmin: email,
        baseline: result,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "production_bootstrap_failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
