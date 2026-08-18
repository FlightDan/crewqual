import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

async function main() {
  const [
    recordsMissingCanonical,
    requestsMissingCanonical,
    plansMissingPerson,
    duplicateActive,
    crossOrg,
  ] = await Promise.all([
    prisma.qualificationRecord.count({
      where: { OR: [{ personId: null }, { qualificationDefinitionId: null }] },
    }),
    prisma.qualificationUpdateRequest.count({
      where: { OR: [{ personId: null }, { qualificationDefinitionId: null }] },
    }),
    prisma.upgradePlan.count({
      where: { OR: [{ personId: null }, { positionAssignmentId: null }] },
    }),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*)::bigint AS count FROM (
          SELECT "personId", "qualificationDefinitionId"
          FROM "QualificationRecord"
          WHERE "status" = 'ACTIVE' AND "personId" IS NOT NULL AND "qualificationDefinitionId" IS NOT NULL
          GROUP BY "personId", "qualificationDefinitionId" HAVING count(*) > 1
        ) duplicates
      `),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*)::bigint AS count
        FROM "Person" p
        JOIN "OrganizationUnit" u ON u."id" = p."unitId"
        WHERE p."unitId" IS NOT NULL AND u."organizationId" IS NOT NULL
          AND p."organizationId" <> u."organizationId"
      `),
  ]);
  const result = {
    recordsMissingCanonical,
    requestsMissingCanonical,
    plansMissingPerson,
    duplicateActiveGroups: Number(duplicateActive[0]?.count ?? BigInt(0)),
    crossOrganizationPeople: Number(crossOrg[0]?.count ?? BigInt(0)),
  };
  console.log(JSON.stringify({ event: "member_reconciliation", ...result }, null, 2));
  if (Object.values(result).some((value) => value !== 0)) process.exitCode = 2;
}

void main().finally(() => prisma.$disconnect());
