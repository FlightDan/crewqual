import { describe, expect, it, vi } from "vitest";
import { querySecurityDetections, securityRangeInterval } from "@/server/security-query";

const now = new Date("2026-09-08T12:34:56.789Z");

function detectionDb() {
  return {
    securityDetectionBucket: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "11111111-1111-4111-8111-111111111111",
          category: "CREDENTIAL_STUFFING",
          ruleVersion: 1,
          windowStart: new Date("2026-09-08T11:00:00Z"),
          windowEnd: new Date("2026-09-08T11:10:00Z"),
          firstSeenAt: new Date("2026-09-08T11:01:00Z"),
          lastSeenAt: new Date("2026-09-08T11:09:00Z"),
          requestCount: 18,
          sourceCount: 1,
          accountCount: 3,
          pathCount: 1,
          truncatedByRetention: false,
          sample: {
            rules: ["MULTI_ACCOUNT_FAILURE"],
            maskedSources: ["203.0.113.*"],
            successfulLoginAfterAttack: false,
            ignored: "never returned",
          },
        },
      ]),
    },
    $queryRaw: vi.fn().mockResolvedValue([
      {
        detectionBucketId: "11111111-1111-4111-8111-111111111111",
        keyVersion: 1,
        accountHash: "same-unit",
        adminUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        pilotId: null,
        personId: null,
        requestCount: BigInt(8),
        ordinal: BigInt(1),
      },
      {
        detectionBucketId: "11111111-1111-4111-8111-111111111111",
        keyVersion: 1,
        accountHash: "other-unit",
        adminUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        pilotId: null,
        personId: null,
        requestCount: BigInt(6),
        ordinal: BigInt(2),
      },
      {
        detectionBucketId: "11111111-1111-4111-8111-111111111111",
        keyVersion: 1,
        accountHash: "unknown",
        adminUserId: null,
        pilotId: null,
        personId: null,
        requestCount: BigInt(4),
        ordinal: BigInt(3),
      },
      {
        detectionBucketId: "11111111-1111-4111-8111-111111111111",
        keyVersion: 1,
        accountHash: "conflicting-identities",
        adminUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        pilotId: null,
        personId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        requestCount: BigInt(2),
        ordinal: BigInt(4),
      },
    ]),
    adminUser: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          email: "local@example.test",
          displayName: "Local Admin",
          unitId: "unit-a",
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          email: "remote@example.test",
          displayName: "Remote Admin",
          unitId: "unit-b",
        },
      ]),
    },
    pilot: { findMany: vi.fn().mockResolvedValue([]) },
    person: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("security read models", () => {
  it("uses complete UTC minutes and exact supported range lengths", () => {
    expect(securityRangeInterval("24h", now)).toEqual({
      since: new Date("2026-09-07T12:34:00.000Z"),
      until: new Date("2026-09-08T12:34:00.000Z"),
    });
    expect(
      securityRangeInterval("30d", now).until.getTime() -
        securityRangeInterval("30d", now).since.getTime(),
    ).toBe(30 * 24 * 60 * 60_000);
  });

  it("reveals current-unit accounts and masks other or unknown targets for ordinary admins", async () => {
    const db = detectionDb();
    const result = await querySecurityDetections(
      { range: "24h", page: 1, pageSize: 20, admin: { roles: ["ADMIN"], unitId: "unit-a" } },
      db as never,
      now,
    );
    expect(result.items[0].accounts).toEqual([
      { label: "Local Admin · local@example.test", masked: false, count: 8 },
      { label: "管理员 r***@example.test", masked: true, count: 6 },
      { label: "未识别账号", masked: true, count: 4 },
      { label: "未识别账号", masked: true, count: 2 },
    ]);
    expect(result.items[0].sample).toEqual({
      rules: ["MULTI_ACCOUNT_FAILURE"],
      maskedSources: ["203.0.113.*"],
      successfulLoginAfterAttack: false,
    });
    expect(result).toMatchObject({
      range: "24h",
      since: "2026-09-07T12:34:00.000Z",
      until: "2026-09-08T12:34:00.000Z",
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });

  it("reveals every live confirmed account to a super administrator", async () => {
    const result = await querySecurityDetections(
      { range: "7d", page: 1, pageSize: 20, admin: { roles: ["SUPER_ADMIN"], unitId: null } },
      detectionDb() as never,
      now,
    );
    expect(result.items[0].accounts.slice(0, 2)).toEqual([
      { label: "Local Admin · local@example.test", masked: false, count: 8 },
      { label: "Remote Admin · remote@example.test", masked: false, count: 6 },
    ]);
  });
});
