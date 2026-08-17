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

const roleNames: Record<AdminRoleCode, string> = {
  SUPER_ADMIN: "超级管理员",
  ADMIN: "管理员",
  REVIEWER: "审核员",
  VIEWER: "只读查看员",
};

function requireInitialAdminValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`No active super administrator exists; ${name} is required`);
  return value;
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

    const email = requireInitialAdminValue("INITIAL_ADMIN_EMAIL").toLowerCase();
    const password = requireInitialAdminValue("INITIAL_ADMIN_PASSWORD");
    const totpSecret = requireInitialAdminValue("INITIAL_ADMIN_TOTP_SECRET").toUpperCase();
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
    await prisma.adminUser.create({
      data: {
        email,
        displayName: "CrewQual 管理员",
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        totpSecretCiphertext: encryptSettingSecret(totpSecret),
        roles: { create: { roleId: superAdminRole.id } },
      },
    });
    console.log(JSON.stringify({ event: "production_bootstrap_complete", initialAdmin: email }));
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
