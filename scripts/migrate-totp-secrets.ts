import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { encryptSettingSecret } from "../src/server/crypto";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

// This script must run against the pre-drop generated client/schema. Raw SQL is
// intentional so it remains a one-time bridge after the application model stops
// exposing the plaintext column.
const rows = await prisma.$queryRawUnsafe<Array<{ id: string; totpSecret: string }>>(
  'SELECT "id", "totpSecret" FROM "AdminUser" WHERE "totpSecret" <> \'\' AND ("totpSecretCiphertext" IS NULL OR "totpSecretCiphertext" = \'\')',
);
for (const row of rows) {
  const ciphertext = encryptSettingSecret(row.totpSecret);
  await prisma.$executeRawUnsafe(
    'UPDATE "AdminUser" SET "totpSecretCiphertext" = $1, "totpSecret" = \'\' WHERE "id" = $2::uuid AND "totpSecret" = $3',
    ciphertext,
    row.id,
    row.totpSecret,
  );
}
console.log(`Encrypted and cleared ${rows.length} legacy TOTP secret(s).`);
await prisma.$disconnect();
