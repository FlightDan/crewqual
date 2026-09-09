// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  evaluateSecurityRules,
  summarizeSecurityMemberships,
  type SecurityMembershipRow,
} from "./security-detection";

const boundary = new Date("2026-09-08T10:10:00Z");
type Signal = Parameters<typeof evaluateSecurityRules>[0][number];
function signal(index: number, patch: Partial<Signal> = {}): Signal {
  return {
    id: `signal-${index}`,
    kind: "AUTH_FAILURE",
    keyVersion: 1,
    sourceHash: "source",
    accountHash: `account-${index}`,
    pathHash: `path-${index}`,
    maskedSource: "192.0.2.*",
    bucketStart: new Date("2026-09-08T10:09:00Z"),
    firstSeenAt: new Date("2026-09-08T10:09:00Z"),
    lastSeenAt: new Date("2026-09-08T10:09:01Z"),
    count: 2,
    ...patch,
  };
}

describe("versioned security detection rules", () => {
  it("requires both failure volume and distinct accounts for stuffing", () => {
    const signals = Array.from({ length: 5 }, (_, i) => signal(i));
    expect(evaluateSecurityRules(signals.slice(0, 4), boundary)).toEqual([]);
    expect(evaluateSecurityRules(signals, boundary)).toMatchObject([
      { category: "CREDENTIAL_STUFFING", rules: ["MULTI_ACCOUNT_FAILURE"] },
    ]);
    expect(
      evaluateSecurityRules(
        signals.map((s) => ({ ...s, accountHash: "same" })),
        boundary,
      ),
    ).toEqual([]);
    expect(
      evaluateSecurityRules(
        signals.map((s) => ({ ...s, sourceHash: null })),
        boundary,
      ),
    ).toEqual([]);
  });
  it("detects distributed failures and never equates unknown source with a real source", () => {
    const signals = Array.from({ length: 5 }, (_, i) =>
      signal(i, { sourceHash: `source-${i}`, accountHash: "same" }),
    );
    expect(evaluateSecurityRules(signals, boundary)).toMatchObject([
      { category: "DISTRIBUTED_LOGIN_ATTEMPT" },
    ]);
    expect(
      evaluateSecurityRules(
        signals.map((s, i) => (i === 0 ? { ...s, sourceHash: null } : s)),
        boundary,
      ),
    ).toEqual([]);
  });
  it("detects known probes immediately and enumeration at 20 requests / 10 paths", () => {
    expect(
      evaluateSecurityRules([signal(0, { kind: "KNOWN_PROBE", count: 1 })], boundary),
    ).toMatchObject([{ category: "PUBLIC_SCAN", rules: ["KNOWN_PROBE"] }]);
    const signals = Array.from({ length: 10 }, (_, i) => signal(i, { kind: "UNKNOWN_ROUTE" }));
    expect(evaluateSecurityRules(signals, boundary)).toMatchObject([
      { category: "PUBLIC_SCAN", rules: ["PATH_ENUMERATION"] },
    ]);
    expect(evaluateSecurityRules(signals.slice(1), boundary)).toEqual([]);
    expect(
      evaluateSecurityRules(
        signals.map((s) => ({ ...s, kind: "RESOURCE_NOT_FOUND" })),
        boundary,
      ),
    ).toEqual([]);
  });
  it("keeps known probes visible when source attribution is unavailable", () => {
    const result = evaluateSecurityRules(
      [
        signal(1, { kind: "KNOWN_PROBE", sourceHash: null, count: 1 }),
        signal(2, { kind: "KNOWN_PROBE", sourceHash: null, count: 1 }),
      ],
      boundary,
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ category: "PUBLIC_SCAN", groupKey: "unknown:1:signal-1" });
    expect(result[1].groupKey).not.toBe(result[0].groupKey);
  });
  it("uses half-open windows and never pools identities across key rotations", () => {
    const signals = Array.from({ length: 5 }, (_, i) =>
      signal(i, { bucketStart: new Date("2026-09-08T10:00:00Z") }),
    );
    expect(evaluateSecurityRules(signals, boundary)).toHaveLength(1);
    expect(
      evaluateSecurityRules(
        signals.map((s) => ({ ...s, bucketStart: new Date("2026-09-08T09:59:00Z") })),
        boundary,
      ),
    ).toEqual([]);
    expect(
      evaluateSecurityRules(
        signals.map((s) => ({ ...s, bucketStart: boundary })),
        boundary,
      ),
    ).toEqual([]);
    expect(
      evaluateSecurityRules(
        signals.map((s, i) => ({ ...s, keyVersion: i % 2 })),
        boundary,
      ),
    ).toEqual([]);
  });
  it("attaches a subsequent successful login only to an already qualifying category", () => {
    const success = signal(10, {
      kind: "AUTH_SUCCESS",
      count: 1,
      firstSeenAt: new Date("2026-09-08T10:09:30Z"),
      lastSeenAt: new Date("2026-09-08T10:09:30Z"),
    });
    expect(evaluateSecurityRules([success], boundary)).toEqual([]);
    const result = evaluateSecurityRules(
      [...Array.from({ length: 5 }, (_, i) => signal(i)), success],
      boundary,
    );
    expect(result).toMatchObject([
      { category: "CREDENTIAL_STUFFING", successfulLoginAfterAttack: true },
    ]);
    expect(result[0].signals).toHaveLength(6);
  });
  it("keeps a qualifying success when later failures remain in the same window", () => {
    const qualifying = Array.from({ length: 5 }, (_, i) =>
      signal(i, {
        bucketStart: new Date("2026-09-08T10:08:00Z"),
        firstSeenAt: new Date("2026-09-08T10:08:00Z"),
        lastSeenAt: new Date("2026-09-08T10:08:20Z"),
      }),
    );
    const success = signal(10, {
      kind: "AUTH_SUCCESS",
      count: 1,
      firstSeenAt: new Date("2026-09-08T10:09:10Z"),
      lastSeenAt: new Date("2026-09-08T10:09:10Z"),
    });
    const laterFailure = signal(11, {
      accountHash: "account-later",
      firstSeenAt: new Date("2026-09-08T10:09:30Z"),
      lastSeenAt: new Date("2026-09-08T10:09:40Z"),
    });
    expect(evaluateSecurityRules([...qualifying, success, laterFailure], boundary)).toMatchObject([
      { category: "CREDENTIAL_STUFFING", successfulLoginAfterAttack: true },
    ]);
  });
  it("does not backdate a distributed success from a source first seen afterwards", () => {
    const qualifying = Array.from({ length: 5 }, (_, i) =>
      signal(i, {
        sourceHash: `source-${i}`,
        accountHash: "target-account",
        bucketStart: new Date("2026-09-08T10:08:00Z"),
        firstSeenAt: new Date("2026-09-08T10:08:00Z"),
        lastSeenAt: new Date("2026-09-08T10:08:20Z"),
      }),
    );
    const success = signal(10, {
      kind: "AUTH_SUCCESS",
      count: 1,
      sourceHash: "source-later",
      accountHash: "target-account",
      firstSeenAt: new Date("2026-09-08T10:09:10Z"),
      lastSeenAt: new Date("2026-09-08T10:09:10Z"),
    });
    const laterFailure = signal(11, {
      sourceHash: "source-later",
      accountHash: "target-account",
      firstSeenAt: new Date("2026-09-08T10:09:30Z"),
      lastSeenAt: new Date("2026-09-08T10:09:40Z"),
    });
    expect(evaluateSecurityRules([...qualifying, success, laterFailure], boundary)).toMatchObject([
      { category: "DISTRIBUTED_LOGIN_ATTEMPT", successfulLoginAfterAttack: false },
    ]);
  });
});

describe("membership union summaries", () => {
  it("clips boundary-spanning batches and de-duplicates overlapping rules and batches", () => {
    const inside = signal(1, { count: 7 });
    const outside = signal(2, { bucketStart: new Date("2026-09-08T09:59:00Z"), count: 100 });
    const rows: SecurityMembershipRow[] = [
      { detectionBucketId: "a", category: "PUBLIC_SCAN", signalBucket: inside },
      { detectionBucketId: "b", category: "CREDENTIAL_STUFFING", signalBucket: inside },
      { detectionBucketId: "a", category: "PUBLIC_SCAN", signalBucket: outside },
      { detectionBucketId: "empty", category: "PUBLIC_SCAN", signalBucket: outside },
    ];
    const result = summarizeSecurityMemberships(rows, new Date("2026-09-08T10:00:00Z"), boundary);
    expect(result).toMatchObject({
      batches: 2,
      requests: 7,
      sources: 1,
      categories: { PUBLIC_SCAN: { requests: 7 }, CREDENTIAL_STUFFING: { requests: 7 } },
    });
    expect(result.trend).toMatchObject([
      { requests: 7, categories: { PUBLIC_SCAN: 7, CREDENTIAL_STUFFING: 7 } },
    ]);
  });
  it("segments rotated source identities and counts unknown source requests separately", () => {
    const rows: SecurityMembershipRow[] = [
      signal(1),
      signal(2, { keyVersion: 2 }),
      signal(3, { sourceHash: null }),
    ].map((signalBucket) => ({ detectionBucketId: "a", category: "PUBLIC_SCAN", signalBucket }));
    expect(
      summarizeSecurityMemberships(rows, new Date("2026-09-08T10:00:00Z"), boundary),
    ).toMatchObject({
      requests: 6,
      sources: null,
      sourceSegments: { "1": 1, "2": 1 },
      keyRotation: true,
      unknownSourceRequests: 2,
    });
  });
});
