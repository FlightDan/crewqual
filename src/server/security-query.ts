import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient, SecurityDetectionCategory } from "@/generated/prisma/client";
import type { AuthenticatedAdmin } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { floorSecurityMinute } from "@/server/security-source";

export const SECURITY_QUERY_RANGES = ["24h", "7d", "30d"] as const;
export type SecurityQueryRange = (typeof SECURITY_QUERY_RANGES)[number];

const RANGE_MS: Record<SecurityQueryRange, number> = {
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
};

export function securityRangeInterval(range: SecurityQueryRange, now = new Date()) {
  const until = floorSecurityMinute(now);
  return { since: new Date(until.getTime() - RANGE_MS[range]), until };
}

type DetectionSample = {
  rules: string[];
  maskedSources: string[];
  successfulLoginAfterAttack: boolean;
};

function detectionSample(value: unknown): DetectionSample {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { rules: [], maskedSources: [], successfulLoginAfterAttack: false };
  }
  const sample = value as Record<string, unknown>;
  return {
    rules: Array.isArray(sample.rules)
      ? sample.rules.filter((item): item is string => typeof item === "string").slice(0, 10)
      : [],
    maskedSources: Array.isArray(sample.maskedSources)
      ? sample.maskedSources.filter((item): item is string => typeof item === "string").slice(0, 5)
      : [],
    successfulLoginAfterAttack: sample.successfulLoginAfterAttack === true,
  };
}

function maskIdentifier(value: string) {
  const at = value.indexOf("@");
  if (at > 0) {
    const local = value.slice(0, at);
    return `${local.slice(0, 1)}***${value.slice(at)}`;
  }
  if (value.length <= 2) return "••••";
  return `${value.slice(0, 1)}••••${value.slice(-2)}`;
}

type AccountAggregateRow = {
  detectionBucketId: string;
  keyVersion: number;
  accountHash: string;
  adminUserId: string | null;
  pilotId: string | null;
  personId: string | null;
  requestCount: bigint;
  ordinal: bigint;
};

type AccountLabel = { label: string; masked: boolean; count: number };

function canSeeFullAccount(
  admin: Pick<AuthenticatedAdmin, "roles" | "unitId">,
  unitId: string | null,
) {
  return admin.roles.includes("SUPER_ADMIN") || (Boolean(admin.unitId) && unitId === admin.unitId);
}

/**
 * Resolves only current, database-confirmed account relationships. Historical
 * unit IDs in telemetry never grant access to a full account label.
 */
async function accountLabels(
  rows: AccountAggregateRow[],
  admin: Pick<AuthenticatedAdmin, "roles" | "unitId">,
  db: PrismaClient,
) {
  const adminIds = [...new Set(rows.flatMap((row) => (row.adminUserId ? [row.adminUserId] : [])))];
  const pilotIds = [...new Set(rows.flatMap((row) => (row.pilotId ? [row.pilotId] : [])))];
  const personIds = [...new Set(rows.flatMap((row) => (row.personId ? [row.personId] : [])))];
  const [admins, pilots, people] = await Promise.all([
    adminIds.length
      ? db.adminUser.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, email: true, displayName: true, unitId: true },
        })
      : [],
    pilotIds.length
      ? db.pilot.findMany({
          where: { id: { in: pilotIds } },
          select: {
            id: true,
            employeeNumber: true,
            displayName: true,
            unitId: true,
            personId: true,
            unit: { select: { organizationId: true } },
            person: { select: { id: true, unitId: true, organizationId: true } },
            profile: { select: { personId: true, legacyPilotId: true } },
          },
        })
      : [],
    personIds.length
      ? db.person.findMany({
          where: { id: { in: personIds } },
          select: {
            id: true,
            employeeNumber: true,
            displayName: true,
            unitId: true,
            organizationId: true,
            unit: { select: { organizationId: true } },
          },
        })
      : [],
  ]);
  const adminById = new Map(admins.map((item) => [item.id, item]));
  const pilotById = new Map(pilots.map((item) => [item.id, item]));
  const personById = new Map(people.map((item) => [item.id, item]));
  const byDetection = new Map<string, AccountLabel[]>();
  for (const row of rows) {
    let label = "未识别账号";
    let masked = true;
    const accountAdmin = row.adminUserId ? adminById.get(row.adminUserId) : undefined;
    const pilot = row.pilotId ? pilotById.get(row.pilotId) : undefined;
    const person = row.personId ? personById.get(row.personId) : undefined;
    if (accountAdmin && !row.pilotId && !row.personId) {
      const visible = canSeeFullAccount(admin, accountAdmin.unitId);
      label = visible
        ? `${accountAdmin.displayName} · ${accountAdmin.email}`
        : `管理员 ${maskIdentifier(accountAdmin.email)}`;
      masked = !visible;
    } else if (
      !row.adminUserId &&
      pilot &&
      pilot.personId &&
      (!row.personId || row.personId === pilot.personId) &&
      pilot.person?.id === pilot.personId &&
      pilot.person.unitId === pilot.unitId &&
      pilot.person.organizationId === pilot.unit.organizationId &&
      pilot.profile?.personId === pilot.personId &&
      pilot.profile.legacyPilotId === pilot.id
    ) {
      const visible = canSeeFullAccount(admin, pilot.unitId);
      label = visible
        ? `${pilot.displayName} · ${pilot.employeeNumber}`
        : `成员 ${maskIdentifier(pilot.employeeNumber)}`;
      masked = !visible;
    } else if (
      !row.adminUserId &&
      !row.pilotId &&
      person &&
      person.unitId &&
      person.unit?.organizationId === person.organizationId
    ) {
      const visible = canSeeFullAccount(admin, person.unitId);
      label = visible
        ? `${person.displayName} · ${person.employeeNumber}`
        : `成员 ${maskIdentifier(person.employeeNumber)}`;
      masked = !visible;
    }
    const entries = byDetection.get(row.detectionBucketId) ?? [];
    entries.push({ label, masked, count: Number(row.requestCount) });
    byDetection.set(row.detectionBucketId, entries);
  }
  return byDetection;
}

export async function querySecurityDetections(
  input: {
    range: SecurityQueryRange;
    page: number;
    pageSize: number;
    admin: Pick<AuthenticatedAdmin, "roles" | "unitId">;
  },
  db: PrismaClient = getPrisma(),
  now = new Date(),
) {
  const { since, until } = securityRangeInterval(input.range, now);
  const where = {
    signals: { some: { signalBucket: { bucketStart: { gte: since, lt: until } } } },
  };
  const [total, detections] = await Promise.all([
    db.securityDetectionBucket.count({ where }),
    db.securityDetectionBucket.findMany({
      where,
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        category: true,
        ruleVersion: true,
        windowStart: true,
        windowEnd: true,
        firstSeenAt: true,
        lastSeenAt: true,
        requestCount: true,
        sourceCount: true,
        accountCount: true,
        pathCount: true,
        truncatedByRetention: true,
        sample: true,
      },
    }),
  ]);
  const ids = detections.map((item) => item.id);
  const targets = ids.length
    ? await db.$queryRaw<AccountAggregateRow[]>(Prisma.sql`
        WITH targets AS (
          SELECT m."detectionBucketId", s."keyVersion", s."accountHash",
            CASE WHEN COUNT(DISTINCT s."adminUserId") = 1
              THEN MIN(s."adminUserId"::text)::uuid ELSE NULL END AS "adminUserId",
            CASE WHEN COUNT(DISTINCT s."pilotId") = 1
              THEN MIN(s."pilotId"::text)::uuid ELSE NULL END AS "pilotId",
            CASE WHEN COUNT(DISTINCT s."personId") = 1
              THEN MIN(s."personId"::text)::uuid ELSE NULL END AS "personId",
            SUM(s."count")::bigint AS "requestCount"
          FROM "SecurityDetectionMembership" m
          JOIN "SecuritySignalBucket" s ON s."id" = m."signalBucketId"
          WHERE m."detectionBucketId" IN (${Prisma.join(
            ids.map((id) => Prisma.sql`${id}::uuid`),
          )}) AND s."accountHash" IS NOT NULL
          GROUP BY m."detectionBucketId", s."keyVersion", s."accountHash"
        ), ranked AS (
          SELECT targets.*,
            ROW_NUMBER() OVER (
              PARTITION BY "detectionBucketId"
              ORDER BY "requestCount" DESC, "keyVersion", "accountHash"
            ) AS ordinal
          FROM targets
        )
        SELECT * FROM ranked WHERE ordinal <= 10
        ORDER BY "detectionBucketId", ordinal
      `)
    : [];
  const labels = await accountLabels(targets, input.admin, db);
  return {
    range: input.range,
    since: since.toISOString(),
    until: until.toISOString(),
    items: detections.map((item) => ({
      ...item,
      windowStart: item.windowStart.toISOString(),
      windowEnd: item.windowEnd.toISOString(),
      firstSeenAt: item.firstSeenAt.toISOString(),
      lastSeenAt: item.lastSeenAt.toISOString(),
      sample: detectionSample(item.sample),
      accounts: labels.get(item.id) ?? [],
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export function emptySecuritySummary(
  boundary: Date,
  state?: {
    collectionHealthy: boolean;
    processedThrough: Date | null;
    lastCollectedAt: Date | null;
    lastAggregatedAt: Date | null;
    droppedCount: number;
  } | null,
) {
  const categories: Record<
    SecurityDetectionCategory,
    { batches: number; requests: number; sources: number; sourceSegments: Record<string, number> }
  > = {
    PUBLIC_SCAN: { batches: 0, requests: 0, sources: 0, sourceSegments: {} },
    CREDENTIAL_STUFFING: { batches: 0, requests: 0, sources: 0, sourceSegments: {} },
    DISTRIBUTED_LOGIN_ATTEMPT: {
      batches: 0,
      requests: 0,
      sources: 0,
      sourceSegments: {},
    },
  };
  const instant = floorSecurityMinute(boundary).toISOString();
  return {
    batches: 0,
    requests: 0,
    sources: null,
    sourceSegments: {},
    keyRotation: false,
    unknownSourceRequests: 0,
    categories,
    trend: [],
    trendBucketSeconds: 3600,
    since: instant,
    until: instant,
    complete: false,
    collectionHealthy: state?.collectionHealthy ?? false,
    processedThrough: state?.processedThrough?.toISOString() ?? null,
    lastCollectedAt: state?.lastCollectedAt?.toISOString() ?? null,
    lastAggregatedAt: state?.lastAggregatedAt?.toISOString() ?? null,
    droppedCount: state?.droppedCount ?? 0,
    lastError: "SESSION_INTERVAL_UNAVAILABLE",
    delayed: true,
  };
}
