import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getServerConfig } from "@/server/config";

const globalForPrisma = globalThis as unknown as { crewqualPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  const config = getServerConfig();
  if (config.SERVICE_MODE === "mock") {
    throw new Error("Database access is disabled in mock mode");
  }
  if (globalForPrisma.crewqualPrisma) return globalForPrisma.crewqualPrisma;
  if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required for database access");
  const poolConfig = {
    connectionString: config.DATABASE_URL,
    max: config.NODE_ENV === "test" ? 2 : 10,
    connectionTimeoutMillis: 5_000,
    // Prisma's query interpreter can schedule independent statements from an
    // interactive transaction concurrently. pg 8.22 deprecates its legacy
    // client-side query queue; protocol pipelining preserves statement order
    // without relying on that queue (and will remain supported by pg 9).
    pipeline: true,
  };
  const adapter = new PrismaPg(poolConfig);
  const client = new PrismaClient({ adapter });
  if (config.NODE_ENV !== "production") globalForPrisma.crewqualPrisma = client;
  return client;
}

export async function disconnectPrisma() {
  if (globalForPrisma.crewqualPrisma) {
    await globalForPrisma.crewqualPrisma.$disconnect();
    delete globalForPrisma.crewqualPrisma;
  }
}
