import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import argon2 from "argon2";
import { encryptSettingSecret } from "../src/server/crypto";
import { randomBytes, randomUUID } from "node:crypto";
import { stdin } from "node:process";

async function main() {
  const [command, email] = process.argv.slice(2);
  if (!command || !email || !["create", "reset", "rotate-password"].includes(command)) {
    console.error("Usage: pnpm admin:create <email> < secret-input");
    console.error("   or: pnpm admin:reset <email> < secret-input");
    console.error("   or: pnpm admin:rotate-password <super-admin-email>");
    console.error(
      "secret-input is two lines: password, then base32 TOTP secret; secrets are never argv.",
    );
    process.exit(1);
  }
  const normalizedEmail = email.toLowerCase();
  const rotatingPasswordOnly = command === "rotate-password";
  let password = "";
  let totpSecret = "";
  if (rotatingPasswordOnly) {
    // 256 bits of CSPRNG output; base64url keeps it shell/password-manager friendly.
    password = randomBytes(32).toString("base64url");
  } else {
    let secretInput = "";
    for await (const chunk of stdin) secretInput += chunk;
    [password = "", totpSecret = ""] = secretInput.split(/\r?\n/);
    if (password.length < 12 || !/^[A-Z2-7]{16,}$/i.test(totpSecret)) {
      throw new Error(
        "stdin must contain a password of at least 12 characters and a base32 TOTP secret",
      );
    }
  }
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  const pgHost = process.env.PGHOST;
  const pgPort = Number(process.env.PGPORT ?? "5432");
  const pgUser = process.env.PGUSER;
  const pgDatabase = process.env.PGDATABASE;
  const pgPassword = process.env.PGPASSWORD;
  const connection = connectionString
    ? connectionString
    : pgHost && pgUser && pgDatabase && pgPassword && Number.isInteger(pgPort)
      ? { host: pgHost, port: pgPort, user: pgUser, database: pgDatabase, password: pgPassword }
      : null;
  if (!connection) {
    throw new Error(
      "DIRECT_URL/DATABASE_URL or complete PGHOST/PGUSER/PGPASSWORD/PGDATABASE is required",
    );
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg(connection) });
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  if (rotatingPasswordOnly) {
    const user = await prisma.adminUser.findUnique({
      where: { email: normalizedEmail },
      include: { roles: { include: { role: true } } },
    });
    if (!user?.active || !user.roles.some((entry) => entry.role.code === "SUPER_ADMIN")) {
      throw new Error(`Active super administrator not found: ${normalizedEmail}`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: user.id },
        data: { passwordHash, failedAttempts: 0, lockedUntil: null },
      });
      await tx.adminSession.deleteMany({ where: { userId: user.id } });
      await tx.auditEvent.create({
        data: {
          actorType: "system",
          action: "admin.password_rotated_cli",
          entityType: "AdminUser",
          entityId: user.id,
          detail: { sessionsRevoked: true },
          requestId: randomUUID(),
        },
      });
    });
    console.log(`rotated password for ${user.email}; all existing sessions revoked`);
    console.log(`new password: ${password}`);
    await prisma.$disconnect();
    process.exit(0);
  }
  const user =
    command === "create"
      ? await prisma.adminUser.create({
          data: {
            email: normalizedEmail,
            displayName: email,
            passwordHash,
            totpSecretCiphertext: encryptSettingSecret(totpSecret),
            active: true,
          },
        })
      : await prisma.adminUser.update({
          where: { email: normalizedEmail },
          data: {
            passwordHash,
            totpSecretCiphertext: encryptSettingSecret(totpSecret),
            active: true,
            failedAttempts: 0,
            lockedUntil: null,
          },
        });
  if (command === "reset") {
    await prisma.adminSession.deleteMany({ where: { userId: user.id } });
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  await prisma.adminUserRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
  console.log(`${command}d admin ${user.email}`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
