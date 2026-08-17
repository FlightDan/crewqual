import { getPrisma } from "@/server/prisma";
import { getServerConfig } from "@/server/config";

export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const db = getPrisma();
  const now = new Date();
  const current = await db.rateLimitBucket.findUnique({ where: { key } });
  if (!current || now.getTime() - current.windowStart.getTime() >= windowMs) {
    await db.rateLimitBucket.upsert({
      where: { key },
      update: { windowStart: now, count: 1 },
      create: { key, windowStart: now, count: 1 },
    });
    return true;
  }
  const updated = await db.rateLimitBucket.updateMany({
    where: { key, count: { lt: limit } },
    data: { count: { increment: 1 } },
  });
  return updated.count === 1;
}

export function requestAddress(request: Request) {
  const trustedHops = getServerConfig().TRUSTED_PROXY_HOPS;
  if (trustedHops === 0) return "direct-client";
  const chain = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const clientIndex = chain.length - trustedHops - 1;
  return clientIndex >= 0 ? chain[clientIndex]! : "unresolved-client";
}
