import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { consumeRateLimit } from "@/server/rate-limit";
import { disconnectPrisma, getPrisma } from "@/server/prisma";
import { Prisma } from "@/generated/prisma/client";

const db = getPrisma();
const runId = randomUUID();
const key = `rate-limit-integration:${runId}`;
const concurrencyKey = `${key}:concurrency`;
const limit = 3;
const windowMs = 60_000;

async function main() {
  const versionRows = await db.$queryRaw<Array<{ serverVersion: string }>>(Prisma.sql`
    SELECT current_setting('server_version') AS "serverVersion"
  `);
  const serverVersion = versionRows[0]?.serverVersion ?? "";
  assert.match(serverVersion, /^16\./, `expected PostgreSQL 16, got ${serverVersion}`);

  await db.rateLimitBucket.deleteMany({ where: { key: { in: [key, concurrencyKey] } } });

  assert.equal(await consumeRateLimit(key, limit, windowMs), true, "first request allowed");
  const first = await db.rateLimitBucket.findUniqueOrThrow({ where: { key } });
  assert.equal(first.count, 1, "new bucket starts at one");
  assert.ok(first.updatedAt instanceof Date, "raw INSERT must populate updatedAt");

  const oldUpdatedAt = new Date(Date.now() - 10_000);
  await db.$executeRaw(Prisma.sql`
    UPDATE "RateLimitBucket"
    SET "updatedAt" = ${oldUpdatedAt}::timestamptz
    WHERE "key" = ${key}
  `);
  assert.equal(await consumeRateLimit(key, limit, windowMs), true, "second request allowed");
  const updated = await db.rateLimitBucket.findUniqueOrThrow({ where: { key } });
  assert.ok(updated.updatedAt.getTime() > oldUpdatedAt.getTime(), "updatedAt must refresh");

  assert.equal(await consumeRateLimit(key, limit, windowMs), true, "last allowed request");
  assert.equal(await consumeRateLimit(key, limit, windowMs), false, "request over limit denied");
  const exhausted = await db.rateLimitBucket.findUniqueOrThrow({ where: { key } });
  assert.equal(exhausted.count, limit + 1, "counter must retain the denied transition");
  assert.equal(await consumeRateLimit(key, limit, windowMs), false, "later request remains denied");

  const oldWindowStart = new Date(Date.now() - windowMs - 1_000);
  await db.$executeRaw(Prisma.sql`
    UPDATE "RateLimitBucket"
    SET "windowStart" = ${oldWindowStart}::timestamptz, "count" = ${limit + 1}
    WHERE "key" = ${key}
  `);
  assert.equal(await consumeRateLimit(key, limit, windowMs), true, "expired window resets");
  const reset = await db.rateLimitBucket.findUniqueOrThrow({ where: { key } });
  assert.equal(reset.count, 1, "expired window count resets to one");

  const concurrentResults = await Promise.all(
    Array.from({ length: 20 }, () => consumeRateLimit(concurrencyKey, limit, windowMs)),
  );
  assert.equal(
    concurrentResults.filter(Boolean).length,
    limit,
    "exactly limit concurrent requests should be allowed",
  );
  const concurrent = await db.rateLimitBucket.findUniqueOrThrow({ where: { key: concurrencyKey } });
  assert.equal(concurrent.count, limit + 1, "concurrent counter must be atomic");

  console.log(
    JSON.stringify({
      event: "rate_limit_postgres_integration_passed",
      serverVersion,
      allowedConcurrentRequests: concurrentResults.filter(Boolean).length,
      finalCounter: concurrent.count,
    }),
  );
}

void main()
  .catch((error) => {
    console.error(
      JSON.stringify({ event: "rate_limit_postgres_integration_failed", error: String(error) }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.rateLimitBucket
      .deleteMany({ where: { key: { in: [key, concurrencyKey] } } })
      .catch(() => undefined);
    await disconnectPrisma();
  });
