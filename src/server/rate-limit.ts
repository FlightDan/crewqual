import { getPrisma } from "@/server/prisma";
import { getServerConfig } from "@/server/config";
import { Prisma } from "@/generated/prisma/client";

export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const db = getPrisma();
  const now = new Date();
  // The decision and counter update must be one database operation.  The
  // previous find-then-upsert path allowed every first request racing on a
  // fresh key through while leaving the stored count at one.
  if (typeof (db as { $queryRaw?: unknown }).$queryRaw === "function") {
    const rows = await db.$queryRaw<Array<{ allowed: boolean }>>(Prisma.sql`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
      VALUES (${key}, ${now}, 1)
      ON CONFLICT ("key") DO UPDATE SET
        "windowStart" = CASE
          WHEN "RateLimitBucket"."windowStart" <= ${now} - (${windowMs}::double precision * interval '1 millisecond')
            THEN ${now}
          ELSE "RateLimitBucket"."windowStart"
        END,
        "count" = CASE
          WHEN "RateLimitBucket"."windowStart" <= ${now} - (${windowMs}::double precision * interval '1 millisecond')
            THEN 1
          WHEN "RateLimitBucket"."count" < ${limit}
            THEN "RateLimitBucket"."count" + 1
          ELSE "RateLimitBucket"."count"
        END
      RETURNING "count" <= ${limit} AS "allowed"
    `);
    return rows[0]?.allowed === true;
  }
  // Small unit-test doubles may only expose the model delegate.
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
  // A proxy that overwrites XFF emits one client address.  For the legacy
  // comma-separated form, discard the configured number of proxy hops and
  // select the address immediately to their left.
  if (chain.length === 1) return chain[0]!;
  const clientIndex = chain.length - trustedHops - 1;
  return clientIndex >= 0 ? chain[clientIndex]! : "unresolved-client";
}
