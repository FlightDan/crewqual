// @vitest-environment node
import type { PrismaClient } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordSecuritySignal, SECURITY_CAPACITY } from "./security-events";

vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ SETTINGS_ENCRYPTION_KEY: "security-unit-test-key" }),
}));
const now = new Date("2026-09-08T10:10:15Z");
function fixture() {
  const signal = { id: "bucket", firstSeenAt: now, lastSeenAt: now };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    rateLimitBucket: { upsert: vi.fn().mockResolvedValue({}) },
    securitySignalReceipt: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
    securitySignalBucket: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn().mockResolvedValue(signal),
      update: vi.fn().mockResolvedValue(signal),
    },
    securityTelemetryState: {
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const db = { ...tx, $transaction: vi.fn(async (callback) => callback(tx)) };
  return { tx, db: db as unknown as PrismaClient };
}

beforeEach(() => vi.clearAllMocks());
describe("security signal collection", () => {
  it("uses one transaction for a non-null dimension key, atomic increment, and receipt", async () => {
    const { tx, db } = fixture();
    expect(
      await recordSecuritySignal(
        { requestKey: "internal-1", kind: "AUTH_FAILURE", outcome: "DENIED" },
        db,
        now,
      ),
    ).toBe("recorded");
    const input = tx.securitySignalBucket.upsert.mock.calls[0][0];
    expect(input.where.bucketStart_kind_keyVersion_dimensionKey.dimensionKey).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(input.create).toMatchObject({
      sourceHash: null,
      accountHash: null,
      pathHash: null,
      count: 1,
    });
    expect(input.update).toEqual({ count: { increment: 1 } });
    expect(tx.securitySignalReceipt.create).toHaveBeenCalledWith({
      data: {
        requestKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        signalBucketId: "bucket",
        expiresAt: new Date(now.getTime() + SECURITY_CAPACITY.receiptTtlMs),
      },
    });
  });
  it("does not increment a bucket when a request receipt already exists", async () => {
    const { tx, db } = fixture();
    tx.securitySignalReceipt.findUnique.mockResolvedValue({ signalBucketId: "old" });
    expect(
      await recordSecuritySignal(
        { requestKey: "same", kind: "AUTH_FAILURE", outcome: "DENIED" },
        db,
        now,
      ),
    ).toBe("duplicate");
    expect(tx.securitySignalBucket.upsert).not.toHaveBeenCalled();
  });
  it("bounds dimensions and marks dropped telemetry without persisting attacker strings", async () => {
    const { tx, db } = fixture();
    tx.securitySignalBucket.count.mockResolvedValue(SECURITY_CAPACITY.bucketsPerMinute);
    expect(
      await recordSecuritySignal(
        { requestKey: "new", kind: "KNOWN_PROBE", outcome: "DENIED" },
        db,
        now,
      ),
    ).toBe("dropped");
    expect(tx.securitySignalBucket.upsert).not.toHaveBeenCalled();
    expect(tx.securityTelemetryState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          collectionHealthy: false,
          droppedCount: { increment: 1 },
          lastError: "CAPACITY_EXCEEDED",
        }),
      }),
    );
  });
  it("continues an existing dimension at the bucket cap but still bounds receipts", async () => {
    const { tx, db } = fixture();
    tx.securitySignalBucket.findUnique.mockResolvedValue({ id: "bucket" });
    tx.securitySignalBucket.count.mockResolvedValue(SECURITY_CAPACITY.bucketsPerMinute);
    expect(
      await recordSecuritySignal(
        { requestKey: "new", kind: "KNOWN_PROBE", outcome: "DENIED" },
        db,
        now,
      ),
    ).toBe("recorded");
    tx.securitySignalReceipt.count.mockResolvedValue(SECURITY_CAPACITY.receiptsPerMinute);
    expect(
      await recordSecuritySignal(
        { requestKey: "another", kind: "KNOWN_PROBE", outcome: "DENIED" },
        db,
        now,
      ),
    ).toBe("dropped");
  });
  it("never stores query secrets, raw IPs, raw account identifiers or arbitrary outcomes", async () => {
    const { tx, db } = fixture();
    await recordSecuritySignal(
      {
        requestKey: "sensitive-request-key",
        kind: "AUTH_FAILURE",
        outcome: "SECRET outcome",
        routeClass: "SECRET class",
        address: "192.0.2.199",
        accountIdentifier: "admin:secret@example.test",
        pathname: "/api/login?token=SECRET",
      },
      db,
      now,
    );
    const serialized = JSON.stringify(tx.securitySignalBucket.upsert.mock.calls);
    expect(serialized).not.toMatch(
      /192\.0\.2\.199|secret@example|token=SECRET|SECRET outcome|SECRET class|sensitive-request-key/,
    );
    expect(tx.securitySignalBucket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          maskedSource: "192.0.2.*",
          outcome: "UNCLASSIFIED",
          routeClass: null,
        }),
      }),
    );
  });
  it("rewinds the watermark and changes the revision for a late minute", async () => {
    const { tx, db } = fixture();
    const at = new Date("2026-09-08T10:09:15Z");
    expect(
      await recordSecuritySignal(
        { requestKey: "late-valid", kind: "AUTH_FAILURE", outcome: "DENIED", at },
        db,
        now,
      ),
    ).toBe("recorded");
    expect(tx.securityTelemetryState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ version: { increment: 1 } }) }),
    );
    expect(tx.securityTelemetryState.updateMany).toHaveBeenCalledWith({
      where: { id: "global", processedThrough: { gt: new Date("2026-09-08T10:09:00Z") } },
      data: { processedThrough: new Date("2026-09-08T10:09:00Z") },
    });
  });
  it("rejects data outside the bounded late-arrival window and records sanitized failure", async () => {
    const { tx, db } = fixture();
    expect(
      await recordSecuritySignal(
        {
          requestKey: "late",
          kind: "AUTH_FAILURE",
          outcome: "DENIED",
          at: new Date(now.getTime() - SECURITY_CAPACITY.maximumLatenessMs - 1),
        },
        db,
        now,
      ),
    ).toBe("dropped");
    expect(tx.securitySignalBucket.upsert).not.toHaveBeenCalled();
    expect(tx.securityTelemetryState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ lastError: "COLLECTION_FAILED" }),
      }),
    );
  });
});
