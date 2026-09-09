// @vitest-environment node
// Requires a dedicated, migrated, EMPTY security telemetry database. Never use production.
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recordSecuritySignal, SECURITY_COLLECTION_GAP_PREFIX } from "./security-events";
import {
  aggregateSecurityDetections,
  cleanupSecurityTelemetry,
  querySecuritySummary,
  SECURITY_RETENTION_MS,
} from "./security-detection";

vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ SETTINGS_ENCRYPTION_KEY: "security-pg-test-only-key" }),
}));
const url = process.env.CREWQUAL_SECURITY_TEST_DATABASE_URL;
const now = new Date("2026-09-08T12:00:00Z");
let db: PrismaClient;
let isolated = false;

describe.skipIf(!url)("security monitoring PostgreSQL invariants", () => {
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 8 }) });
    const counts = await Promise.all([
      db.securitySignalBucket.count(),
      db.securityDetectionBucket.count(),
      db.securityTelemetryState.count(),
    ]);
    if (counts.some((count) => count !== 0))
      throw new Error(
        "Refusing non-empty security telemetry database; supply an isolated migrated test database",
      );
    isolated = true;
  });
  afterAll(async () => {
    if (db && isolated) {
      await db.securityDetectionBucket.deleteMany();
      await db.securitySignalBucket.deleteMany();
      await db.securityTelemetryState.deleteMany();
      await db.rateLimitBucket.deleteMany({
        where: { key: { startsWith: SECURITY_COLLECTION_GAP_PREFIX } },
      });
    }
    if (db) await db.$disconnect();
  });

  it("claims one receipt under concurrency and upserts nullable dimensions into one bucket", async () => {
    const requestKey = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        recordSecuritySignal({ requestKey, kind: "AUTH_FAILURE", outcome: "DENIED" }, db, now),
      ),
    );
    expect(results.filter((result) => result === "recorded")).toHaveLength(1);
    expect(results.filter((result) => result === "duplicate")).toHaveLength(11);
    expect(await db.securitySignalReceipt.count()).toBe(1);
    expect(await db.securitySignalBucket.count()).toBe(1);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        recordSecuritySignal(
          { requestKey: randomUUID(), kind: "AUTH_FAILURE", outcome: "DENIED" },
          db,
          now,
        ),
      ),
    );
    const buckets = await db.securitySignalBucket.findMany();
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      count: 9,
      sourceHash: null,
      accountHash: null,
      pathHash: null,
    });
    expect(buckets[0].dimensionKey).not.toBe("");
  }, 30_000);

  it("merges repeated windows across concurrent workers and unions overlapping classifications", async () => {
    const at = new Date(now.getTime() - 60_000);
    for (let source = 0; source < 5; source++)
      for (let account = 0; account < 5; account++) {
        for (let attempt = 0; attempt < 2; attempt++) {
          expect(
            await recordSecuritySignal(
              {
                requestKey: randomUUID(),
                kind: "AUTH_FAILURE",
                outcome: "DENIED",
                address: `198.51.100.${source + 1}`,
                accountIdentifier: `admin:test-${account}`,
                at,
              },
              db,
              now,
            ),
          ).toBe("recorded");
        }
      }
    await Promise.all([aggregateSecurityDetections(db, now), aggregateSecurityDetections(db, now)]);
    const summary = await querySecuritySummary(at, now, db, now);
    expect(summary).toMatchObject({
      batches: 10,
      requests: 50,
      sources: 5,
      complete: true,
      categories: {
        CREDENTIAL_STUFFING: { requests: 50 },
        DISTRIBUTED_LOGIN_ATTEMPT: { requests: 50 },
      },
    });
    expect(await db.securityDetectionMembership.count()).toBe(50);
    await aggregateSecurityDetections(db, new Date(now.getTime() + 60_000));
    expect(await db.securityDetectionBucket.count()).toBe(10);
    expect(await db.securityDetectionMembership.count()).toBe(50);
  }, 30_000);

  it("merges batches when late data fills a real continuity gap", async () => {
    const end = new Date(now.getTime() + 2 * 60_000);
    const recordProbe = (minutesAgo: number) =>
      recordSecuritySignal(
        {
          requestKey: randomUUID(),
          kind: "KNOWN_PROBE",
          outcome: "DENIED",
          address: "203.0.113.88",
          at: new Date(end.getTime() - minutesAgo * 60_000),
        },
        db,
        end,
      );
    expect(await recordProbe(12)).toBe("recorded");
    expect(await recordProbe(4)).toBe("recorded");
    await aggregateSecurityDetections(db, end);
    expect(await db.securityDetectionBucket.count({ where: { category: "PUBLIC_SCAN" } })).toBe(2);
    expect(await recordProbe(8)).toBe("recorded");
    expect(
      (await querySecuritySummary(new Date(end.getTime() - 11 * 60_000), end, db, end)).complete,
    ).toBe(false);
    await aggregateSecurityDetections(db, end);
    const batches = await db.securityDetectionBucket.findMany({
      where: { category: "PUBLIC_SCAN" },
      include: { signals: true },
    });
    expect(batches).toHaveLength(1);
    expect(batches[0].requestCount).toBe(3);
    expect(batches[0].signals).toHaveLength(3);
    const clipped = await querySecuritySummary(new Date(end.getTime() - 11 * 60_000), end, db, end);
    expect(clipped.categories.PUBLIC_SCAN).toMatchObject({ batches: 1, requests: 2, sources: 1 });
  }, 30_000);

  it("clips old members and samples from a continuing batch instead of retaining its old evidence", async () => {
    const oldTime = new Date(now.getTime() - SECURITY_RETENTION_MS - 60_000);
    const retainedTime = new Date(now.getTime() - 60_000);
    const old = await db.securitySignalBucket.create({
      data: {
        kind: "KNOWN_PROBE",
        bucketStart: oldTime,
        dimensionKey: randomUUID(),
        sourceHash: "expired-source",
        maskedSource: "expired-mask",
        outcome: "DENIED",
        count: 100,
        firstSeenAt: oldTime,
        lastSeenAt: oldTime,
      },
    });
    const retained = await db.securitySignalBucket.create({
      data: {
        kind: "KNOWN_PROBE",
        bucketStart: retainedTime,
        dimensionKey: randomUUID(),
        sourceHash: "retained-source",
        maskedSource: "retained-mask",
        outcome: "DENIED",
        count: 1,
        firstSeenAt: retainedTime,
        lastSeenAt: retainedTime,
      },
    });
    const batch = await db.securityDetectionBucket.create({
      data: {
        category: "PUBLIC_SCAN",
        groupKey: "retention-fixture",
        dedupeKey: randomUUID(),
        windowStart: oldTime,
        windowEnd: now,
        firstSeenAt: oldTime,
        lastSeenAt: retainedTime,
        requestCount: 101,
        sourceCount: 2,
        sample: { maskedSources: ["expired-mask"] },
        signals: { create: [{ signalBucketId: old.id }, { signalBucketId: retained.id }] },
      },
    });
    await cleanupSecurityTelemetry(db, now);
    const result = await db.securityDetectionBucket.findUniqueOrThrow({
      where: { id: batch.id },
      include: { signals: true },
    });
    expect(result).toMatchObject({
      requestCount: 1,
      sourceCount: 1,
      firstSeenAt: retainedTime,
      truncatedByRetention: true,
    });
    expect(result.signals).toHaveLength(1);
    expect(JSON.stringify(result.sample)).not.toContain("expired");
    expect(await db.securitySignalBucket.findUnique({ where: { id: old.id } })).toBeNull();
    const gapKey = `${SECURITY_COLLECTION_GAP_PREFIX}${oldTime.toISOString()}`;
    await db.rateLimitBucket.create({ data: { key: gapKey, windowStart: oldTime, count: 5 } });
    await db.securityTelemetryState.update({
      where: { id: "global" },
      data: { collectionHealthy: false, droppedCount: 5, lastError: "CAPACITY_EXCEEDED" },
    });
    await cleanupSecurityTelemetry(db, now);
    expect(await db.securityTelemetryState.findUnique({ where: { id: "global" } })).toMatchObject({
      collectionHealthy: true,
      droppedCount: 0,
      lastError: null,
    });
  }, 30_000);
});
