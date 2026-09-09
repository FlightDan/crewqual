import { Prisma } from "@/generated/prisma/client";
import type {
  PrismaClient,
  SecurityDetectionCategory,
  SecuritySignalBucket,
} from "@/generated/prisma/client";
import { getPrisma } from "@/server/prisma";
import { SECURITY_COLLECTION_GAP_PREFIX } from "@/server/security-events";
import { floorSecurityMinute } from "@/server/security-source";

export const SECURITY_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60_000;
const SECURITY_HEALTH_MONITOR_PREFIX = "security-health-monitor:";
export const SECURITY_RULE_VERSION = 1;
const MINUTE = 60_000;
const LOOKBACK = 30 * MINUTE;
const MAX_SIGNALS_PER_RUN = 100_000;
const AUTH_FAILURES = new Set(["AUTH_FAILURE", "AUTH_RATE_LIMIT"]);
const SCAN_SIGNALS = new Set([
  "KNOWN_PROBE",
  "UNKNOWN_ROUTE",
  "INVALID_METHOD",
  "AUTHORIZATION_DENIED",
  "CSRF_DENIED",
  "PUBLIC_ACCESS_DENIED",
]);

type Signal = Pick<
  SecuritySignalBucket,
  | "id"
  | "kind"
  | "bucketStart"
  | "keyVersion"
  | "sourceHash"
  | "accountHash"
  | "pathHash"
  | "count"
  | "firstSeenAt"
  | "lastSeenAt"
  | "maskedSource"
>;
export type SecurityRuleMatch = {
  category: SecurityDetectionCategory;
  groupKey: string;
  windowStart: Date;
  windowEnd: Date;
  signals: Signal[];
  rules: string[];
  successfulLoginAfterAttack: boolean;
};

function distinct(values: Array<string | null>) {
  return new Set(values.filter((value): value is string => value !== null)).size;
}
function identity(signal: Signal, field: "sourceHash" | "accountHash" | "pathHash") {
  return signal[field] ? `${signal.keyVersion}:${signal[field]}` : null;
}
function counts(signals: Signal[]) {
  return {
    requestCount: signals.reduce((sum, signal) => sum + signal.count, 0),
    sourceCount: distinct(signals.map((signal) => identity(signal, "sourceHash"))),
    accountCount: distinct(signals.map((signal) => identity(signal, "accountHash"))),
    pathCount: distinct(signals.map((signal) => identity(signal, "pathHash"))),
  };
}

function rulesFor(category: SecurityDetectionCategory, members: Signal[]) {
  const totals = counts(members);
  const rules: string[] = [];
  if (category === "PUBLIC_SCAN") {
    if (members.some((signal) => signal.kind === "KNOWN_PROBE")) rules.push("KNOWN_PROBE");
    if (totals.requestCount >= 20 && totals.pathCount >= 10) rules.push("PATH_ENUMERATION");
  } else if (category === "CREDENTIAL_STUFFING") {
    if (totals.requestCount >= 10 && totals.accountCount >= 5) rules.push("MULTI_ACCOUNT_FAILURE");
  } else if (totals.requestCount >= 10 && totals.sourceCount >= 5) {
    rules.push("MULTI_SOURCE_FAILURE");
  }
  return rules;
}

/** Pure versioned rule evaluation over UTC minute buckets, using half-open windows. */
export function evaluateSecurityRules(signals: Signal[], boundary: Date): SecurityRuleMatch[] {
  const matches: SecurityRuleMatch[] = [];
  for (const [category, field, duration] of [
    ["PUBLIC_SCAN", "sourceHash", 5 * MINUTE],
    ["CREDENTIAL_STUFFING", "sourceHash", 10 * MINUTE],
    ["DISTRIBUTED_LOGIN_ATTEMPT", "accountHash", 10 * MINUTE],
  ] as const) {
    const start = new Date(boundary.getTime() - duration);
    const successCandidates = signals.filter(
      (signal) =>
        signal.kind === "AUTH_SUCCESS" &&
        signal.bucketStart >= start &&
        signal.bucketStart < boundary,
    );
    const groups = new Map<string, Signal[]>();
    for (const signal of signals) {
      if (signal.bucketStart < start || signal.bucketStart >= boundary) continue;
      if (!(category === "PUBLIC_SCAN" ? SCAN_SIGNALS : AUTH_FAILURES).has(signal.kind)) continue;
      const key =
        identity(signal, field) ??
        (category === "PUBLIC_SCAN" && signal.kind === "KNOWN_PROBE"
          ? `unknown:${signal.keyVersion}:${signal.id}`
          : null);
      // A known malicious path remains evidence without a usable source. Keep such
      // buckets separate; never invent one shared attacker identity for missing IPs.
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(signal);
      groups.set(key, group);
    }
    for (const [groupKey, members] of groups) {
      const rules = rulesFor(category, members);
      if (!rules.length) continue;
      const successes = successCandidates.filter((signal) => {
        // A success is evidence only when the rule had already qualified.
        // Later failures in the same window must not erase that chronology.
        // A bucket spanning the success is excluded conservatively because
        // its aggregate count cannot prove how many failures came first.
        const preceding = members.filter(
          (member) => member.lastSeenAt.getTime() < signal.firstSeenAt.getTime(),
        );
        const successSource = identity(signal, "sourceHash");
        return Boolean(
          successSource &&
          preceding.some((member) => identity(member, "sourceHash") === successSource) &&
          rulesFor(category, preceding).length > 0,
        );
      });
      matches.push({
        category,
        groupKey,
        windowStart: start,
        windowEnd: boundary,
        signals: [...members, ...successes],
        rules,
        successfulLoginAfterAttack: successes.length > 0,
      });
    }
  }
  return matches;
}

type Tx = Prisma.TransactionClient;
async function recomputeDetection(tx: Tx, id: string, truncated = false) {
  const [total] = await tx.$queryRaw<
    Array<{
      members: bigint;
      requestCount: bigint;
      sourceCount: bigint;
      accountCount: bigint;
      pathCount: bigint;
      firstSeenAt: Date | null;
      lastSeenAt: Date | null;
      bucketStart: Date | null;
      bucketEnd: Date | null;
      successfulLoginAfterAttack: boolean | null;
    }>
  >`
    SELECT COUNT(*) AS members, COALESCE(SUM(s."count"), 0) AS "requestCount",
      COUNT(DISTINCT (s."keyVersion", s."sourceHash")) FILTER (WHERE s."sourceHash" IS NOT NULL) AS "sourceCount",
      COUNT(DISTINCT (s."keyVersion", s."accountHash")) FILTER (WHERE s."accountHash" IS NOT NULL) AS "accountCount",
      COUNT(DISTINCT (s."keyVersion", s."pathHash")) FILTER (WHERE s."pathHash" IS NOT NULL) AS "pathCount",
      MIN(s."firstSeenAt") AS "firstSeenAt", MAX(s."lastSeenAt") AS "lastSeenAt",
      MIN(s."bucketStart") AS "bucketStart", MAX(s."bucketStart") + interval '1 minute' AS "bucketEnd",
      BOOL_OR(s."kind" = 'AUTH_SUCCESS') AS "successfulLoginAfterAttack"
    FROM "SecurityDetectionMembership" m JOIN "SecuritySignalBucket" s ON s."id" = m."signalBucketId"
    WHERE m."detectionBucketId" = ${id}::uuid
  `;
  if (!total || Number(total.members) === 0) {
    await tx.securityDetectionBucket.delete({ where: { id } });
    return;
  }
  const row = await tx.securityDetectionBucket.findUniqueOrThrow({ where: { id } });
  const samples = await tx.$queryRaw<Array<{ maskedSource: string }>>`
    SELECT DISTINCT s."maskedSource" FROM "SecurityDetectionMembership" m
    JOIN "SecuritySignalBucket" s ON s."id" = m."signalBucketId"
    WHERE m."detectionBucketId" = ${id}::uuid ORDER BY s."maskedSource" LIMIT 5
  `;
  const oldSample =
    row.sample && typeof row.sample === "object" && !Array.isArray(row.sample) ? row.sample : {};
  await tx.securityDetectionBucket.update({
    where: { id },
    data: {
      requestCount: Number(total.requestCount),
      sourceCount: Number(total.sourceCount),
      accountCount: Number(total.accountCount),
      pathCount: Number(total.pathCount),
      firstSeenAt: total.firstSeenAt!,
      lastSeenAt: total.lastSeenAt!,
      ...(truncated
        ? {
            truncatedByRetention: true,
            windowStart: total.bucketStart!,
            windowEnd: total.bucketEnd!,
          }
        : {}),
      sample: {
        rules: Array.isArray(oldSample.rules) ? oldSample.rules : [],
        successfulLoginAfterAttack: total.successfulLoginAfterAttack === true,
        maskedSources: samples.map((sample) => sample.maskedSource),
      },
    },
  });
}

async function mergeMatch(tx: Tx, match: SecurityRuleMatch) {
  // The worker and retention cleaner share an advisory lock. A late bridging window
  // can safely merge multiple earlier batches without racing another worker.
  const existing = await tx.securityDetectionBucket.findMany({
    where: {
      category: match.category,
      ruleVersion: SECURITY_RULE_VERSION,
      groupKey: match.groupKey,
      // Batch continuity is measured at evaluation boundaries. Input windows
      // overlap even across a pause, which alone must not join separate attacks.
      windowStart: { lte: new Date(match.windowStart.getTime() + MINUTE) },
      windowEnd: { gte: new Date(match.windowEnd.getTime() - MINUTE) },
    },
    orderBy: { windowStart: "asc" },
  });
  const starts = [match.windowStart.getTime(), ...existing.map((row) => row.windowStart.getTime())];
  const ends = [match.windowEnd.getTime(), ...existing.map((row) => row.windowEnd.getTime())];
  const rules = new Set(match.rules);
  for (const row of existing) {
    if (
      row.sample &&
      typeof row.sample === "object" &&
      !Array.isArray(row.sample) &&
      Array.isArray(row.sample.rules)
    ) {
      for (const rule of row.sample.rules) if (typeof rule === "string") rules.add(rule);
    }
  }
  const survivor =
    existing[0] ??
    (await tx.securityDetectionBucket.create({
      data: {
        category: match.category,
        ruleVersion: SECURITY_RULE_VERSION,
        groupKey: match.groupKey,
        dedupeKey: `${SECURITY_RULE_VERSION}:${match.category}:${match.groupKey}:${match.windowEnd.toISOString()}`,
        windowStart: match.windowStart,
        windowEnd: match.windowEnd,
        firstSeenAt: match.windowStart,
        lastSeenAt: match.windowEnd,
      },
    }));
  const losingIds = existing.slice(1).map((row) => row.id);
  if (losingIds.length) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "SecurityDetectionMembership" ("detectionBucketId", "signalBucketId", "createdAt")
      SELECT ${survivor.id}::uuid, "signalBucketId", NOW() FROM "SecurityDetectionMembership"
      WHERE "detectionBucketId" IN (${Prisma.join(losingIds.map((id) => Prisma.sql`${id}::uuid`))})
      ON CONFLICT DO NOTHING
    `);
  }
  const ids = [...new Set(match.signals.map((signal) => signal.id))];
  for (let offset = 0; offset < ids.length; offset += 4096) {
    await tx.securityDetectionMembership.createMany({
      data: ids
        .slice(offset, offset + 4096)
        .map((signalBucketId) => ({ detectionBucketId: survivor.id, signalBucketId })),
      skipDuplicates: true,
    });
  }
  if (losingIds.length)
    await tx.securityDetectionBucket.deleteMany({ where: { id: { in: losingIds } } });
  await tx.securityDetectionBucket.update({
    where: { id: survivor.id },
    data: {
      windowStart: new Date(Math.min(...starts)),
      windowEnd: new Date(Math.max(...ends)),
      truncatedByRetention: existing.some((row) => row.truncatedByRetention),
      sample: { rules: [...rules] },
    },
  });
  return survivor.id;
}

export async function aggregateSecurityDetections(
  db: PrismaClient = getPrisma(),
  now = new Date(),
) {
  const until = floorSecurityMinute(now);
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('crewqual-security-detection'))`;
        await tx.securitySignalReceipt.deleteMany({ where: { expiresAt: { lte: now } } });
        const state = await tx.securityTelemetryState.findUnique({ where: { id: "global" } });
        const first =
          state?.processedThrough ??
          (
            await tx.securitySignalBucket.findFirst({
              orderBy: { bucketStart: "asc" },
              select: { bucketStart: true },
            })
          )?.bucketStart ??
          until;
        const retainedStart = until.getTime() - SECURITY_RETENTION_MS;
        const from = Math.max(retainedStart, first.getTime() - LOOKBACK);
        // Bound outage catch-up per invocation and expose its watermark to the UI.
        let end = Math.min(until.getTime(), Math.max(first.getTime(), from) + 120 * MINUTE);
        const signals = await tx.securitySignalBucket.findMany({
          where: {
            bucketStart: {
              gte: new Date(Math.max(retainedStart, from - 10 * MINUTE)),
              lt: new Date(end),
            },
          },
          select: {
            id: true,
            kind: true,
            bucketStart: true,
            keyVersion: true,
            sourceHash: true,
            accountHash: true,
            pathHash: true,
            count: true,
            firstSeenAt: true,
            lastSeenAt: true,
            maskedSource: true,
          },
          orderBy: [{ bucketStart: "asc" }, { id: "asc" }],
          take: MAX_SIGNALS_PER_RUN + 1,
        });
        if (signals.length > MAX_SIGNALS_PER_RUN) {
          // Never evaluate a partially loaded minute or advance its watermark.
          end = Math.min(end, signals[MAX_SIGNALS_PER_RUN].bucketStart.getTime());
        }
        if (end < first.getTime())
          throw new Error("Security telemetry processing capacity exceeded");
        let matches = 0;
        const changed = new Set<string>();
        for (let time = from + MINUTE; time <= end; time += MINUTE) {
          for (const match of evaluateSecurityRules(signals, new Date(time))) {
            changed.add(await mergeMatch(tx, match));
            matches++;
          }
        }
        const survivors = await tx.securityDetectionBucket.findMany({
          where: { id: { in: [...changed] } },
          select: { id: true },
        });
        for (const { id } of survivors) await recomputeDetection(tx, id);
        const data = {
          processedThrough: new Date(end),
          lastAggregatedAt: now,
          ...(state?.collectionHealthy ? { lastError: null } : {}),
        };
        if (state) {
          // A concurrent late arrival rewinds the watermark and changes version.
          // Never overwrite that invalidation with results from an earlier read.
          const updated = await tx.securityTelemetryState.updateMany({
            where: { id: "global", version: state.version },
            data,
          });
          if (updated.count !== 1) throw new Error("Security telemetry changed during evaluation");
        } else {
          await tx.securityTelemetryState.create({ data: { id: "global", ...data } });
        }
        return { processedThrough: new Date(end), matches };
      },
      { timeout: 120_000 },
    );
  } catch {
    await db.securityTelemetryState
      .upsert({
        where: { id: "global" },
        create: { id: "global", lastError: "AGGREGATION_FAILED" },
        update: { lastError: "AGGREGATION_FAILED" },
      })
      .catch(() => undefined);
    throw new Error("Security telemetry aggregation failed");
  }
}

export async function cleanupSecurityTelemetry(db: PrismaClient = getPrisma(), now = new Date()) {
  const cutoff = new Date(floorSecurityMinute(now).getTime() - SECURITY_RETENTION_MS);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('crewqual-security-detection'))`;
      const affected = await tx.securityDetectionMembership.findMany({
        where: { signalBucket: { bucketStart: { lt: cutoff } } },
        select: { detectionBucketId: true },
        distinct: ["detectionBucketId"],
      });
      const receipts = await tx.securitySignalReceipt.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      const signals = await tx.securitySignalBucket.deleteMany({
        where: { bucketStart: { lt: cutoff } },
      });
      const rateLimits = await tx.rateLimitBucket.deleteMany({
        where: {
          updatedAt: { lt: new Date(now.getTime() - RATE_LIMIT_RETENTION_MS) },
          NOT: [
            { key: { startsWith: SECURITY_COLLECTION_GAP_PREFIX } },
            { key: { startsWith: SECURITY_HEALTH_MONITOR_PREFIX } },
          ],
        },
      });
      for (const { detectionBucketId } of affected)
        await recomputeDetection(tx, detectionBucketId, true);
      await tx.securityDetectionBucket.deleteMany({ where: { signals: { none: {} } } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('crewqual-security-health'))`;
      await tx.rateLimitBucket.deleteMany({
        where: { key: { startsWith: SECURITY_COLLECTION_GAP_PREFIX }, windowStart: { lt: cutoff } },
      });
      const gaps = await tx.rateLimitBucket.aggregate({
        where: { key: { startsWith: SECURITY_COLLECTION_GAP_PREFIX } },
        _sum: { count: true },
      });
      const droppedCount = gaps._sum.count ?? 0;
      const state = await tx.securityTelemetryState.findUnique({ where: { id: "global" } });
      if (state)
        await tx.securityTelemetryState.update({
          where: { id: "global" },
          data: {
            droppedCount,
            collectionHealthy: droppedCount === 0,
            ...(droppedCount === 0 && state.lastError !== "AGGREGATION_FAILED"
              ? { lastError: null }
              : {}),
          },
        });
      return {
        receipts: receipts.count,
        signals: signals.count,
        rateLimits: rateLimits.count,
        truncatedBatches: affected.length,
      };
    },
    { timeout: 120_000 },
  );
}

export type SecurityMembershipRow = {
  detectionBucketId: string;
  category: SecurityDetectionCategory;
  signalBucket: Signal;
};
export function summarizeSecurityMemberships(
  rows: SecurityMembershipRow[],
  since: Date,
  until: Date,
) {
  const clipped = rows.filter(
    (row) => row.signalBucket.bucketStart >= since && row.signalBucket.bucketStart < until,
  );
  const union = new Map(clipped.map((row) => [row.signalBucket.id, row.signalBucket]));
  const signals = [...union.values()];
  const sourceSegments: Record<string, number> = {};
  for (const version of new Set(signals.map((signal) => signal.keyVersion))) {
    sourceSegments[version] = distinct(
      signals.filter((signal) => signal.keyVersion === version).map((signal) => signal.sourceHash),
    );
  }
  const categories = Object.fromEntries(
    (["PUBLIC_SCAN", "CREDENTIAL_STUFFING", "DISTRIBUTED_LOGIN_ATTEMPT"] as const).map(
      (category) => {
        const categoryRows = clipped.filter((row) => row.category === category);
        const categorySignals = [
          ...new Map(categoryRows.map((row) => [row.signalBucket.id, row.signalBucket])).values(),
        ];
        const categorySegments = Object.fromEntries(
          [...new Set(categorySignals.map((signal) => signal.keyVersion))].map((version) => [
            version,
            distinct(
              categorySignals
                .filter((signal) => signal.keyVersion === version)
                .map((signal) => signal.sourceHash),
            ),
          ]),
        );
        return [
          category,
          {
            batches: new Set(categoryRows.map((row) => row.detectionBucketId)).size,
            requests: counts(categorySignals).requestCount,
            sources:
              Object.keys(categorySegments).length <= 1
                ? counts(categorySignals).sourceCount
                : null,
            sourceSegments: categorySegments,
          },
        ];
      },
    ),
  );
  const signalCategories = new Map<string, Set<SecurityDetectionCategory>>();
  for (const row of clipped) {
    const categories =
      signalCategories.get(row.signalBucket.id) ?? new Set<SecurityDetectionCategory>();
    categories.add(row.category);
    signalCategories.set(row.signalBucket.id, categories);
  }
  const trend = new Map<
    string,
    { bucketStart: string; requests: number; categories: Record<SecurityDetectionCategory, number> }
  >();
  for (const signal of signals) {
    const bucketStart = signal.bucketStart.toISOString();
    const entry = trend.get(bucketStart) ?? {
      bucketStart,
      requests: 0,
      categories: { PUBLIC_SCAN: 0, CREDENTIAL_STUFFING: 0, DISTRIBUTED_LOGIN_ATTEMPT: 0 },
    };
    entry.requests += signal.count;
    for (const category of signalCategories.get(signal.id) ?? [])
      entry.categories[category] += signal.count;
    trend.set(bucketStart, entry);
  }
  return {
    batches: new Set(clipped.map((row) => row.detectionBucketId)).size,
    requests: counts(signals).requestCount,
    sources: Object.keys(sourceSegments).length <= 1 ? counts(signals).sourceCount : null,
    sourceSegments,
    keyRotation: Object.keys(sourceSegments).length > 1,
    unknownSourceRequests: signals
      .filter((signal) => !signal.sourceHash)
      .reduce((total, signal) => total + signal.count, 0),
    categories,
    trend: [...trend.values()].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart)),
  };
}

/** Summary truth comes only from the clipped union of memberships, not cached batch totals. */
export async function querySecuritySummary(
  since: Date,
  until: Date,
  db: PrismaClient = getPrisma(),
  now = new Date(),
) {
  if (
    !Number.isFinite(since.getTime()) ||
    !Number.isFinite(until.getTime()) ||
    since > until ||
    until.getTime() - since.getTime() > SECURITY_RETENTION_MS
  )
    throw new Error("Invalid security summary interval");
  const retainedSince = new Date(
    Math.max(since.getTime(), floorSecurityMinute(now).getTime() - SECURITY_RETENTION_MS),
  );
  const trendBucketSeconds =
    until.getTime() - since.getTime() > 7 * 24 * 60 * MINUTE ? 86400 : 3600;
  type SummaryData = {
    batches: number;
    requests: number;
    sourceSegments: Record<string, number>;
    unknownSourceRequests: number;
    categories: Record<
      string,
      {
        batches: number;
        requests: number;
        sources: number | null;
        sourceSegments: Record<string, number>;
      }
    >;
    trend: Array<{ bucketStart: string; requests: number; categories: Record<string, number> }>;
  };
  // A repeatable snapshot prevents a newer watermark being paired with older membership data.
  // All potentially large unions/counts stay in PostgreSQL; only chart-sized JSON is returned.
  const [rows, state] = await db.$transaction(
    async (tx) =>
      Promise.all([
        tx.$queryRaw<Array<{ data: SummaryData }>>`
      WITH clipped AS MATERIALIZED (
        SELECT m."detectionBucketId", d."category", s."id", s."bucketStart",
               s."keyVersion", s."sourceHash", s."count"
        FROM "SecurityDetectionMembership" m
        JOIN "SecuritySignalBucket" s ON s."id" = m."signalBucketId"
        JOIN "SecurityDetectionBucket" d ON d."id" = m."detectionBucketId"
        WHERE s."bucketStart" >= ${retainedSince} AND s."bucketStart" < ${until}
      ), signals AS MATERIALIZED (
        SELECT DISTINCT "id", "bucketStart", "keyVersion", "sourceHash", "count" FROM clipped
      ), category_signals AS MATERIALIZED (
        SELECT DISTINCT "category", "id", "bucketStart", "keyVersion", "sourceHash", "count" FROM clipped
      ), source_counts AS (
        SELECT "keyVersion", COUNT(DISTINCT "sourceHash") AS amount FROM signals GROUP BY "keyVersion"
      ), category_source_counts AS (
        SELECT "category", "keyVersion", COUNT(DISTINCT "sourceHash") AS amount
        FROM category_signals GROUP BY "category", "keyVersion"
      ), category_totals AS (
        SELECT "category", SUM("count") AS requests FROM category_signals GROUP BY "category"
      ), category_batches AS (
        SELECT "category", COUNT(DISTINCT "detectionBucketId") AS batches FROM clipped GROUP BY "category"
      ), trend_totals AS (
        SELECT to_timestamp(floor(EXTRACT(EPOCH FROM "bucketStart") / ${trendBucketSeconds}) * ${trendBucketSeconds}) AS time,
               SUM("count") AS requests
        FROM signals GROUP BY time
      ), trend_categories AS (
        SELECT to_timestamp(floor(EXTRACT(EPOCH FROM "bucketStart") / ${trendBucketSeconds}) * ${trendBucketSeconds}) AS time,
               "category", SUM("count") AS requests
        FROM category_signals GROUP BY time, "category"
      )
      SELECT jsonb_build_object(
        'batches', (SELECT COUNT(DISTINCT "detectionBucketId") FROM clipped),
        'requests', (SELECT COALESCE(SUM("count"), 0) FROM signals),
        'sourceSegments', COALESCE((SELECT jsonb_object_agg("keyVersion"::text, amount) FROM source_counts), '{}'::jsonb),
        'unknownSourceRequests', (SELECT COALESCE(SUM("count"), 0) FROM signals WHERE "sourceHash" IS NULL),
        'categories', COALESCE((
          SELECT jsonb_object_agg(c."category"::text, jsonb_build_object(
            'batches', b.batches, 'requests', c.requests,
            'sources', (SELECT CASE WHEN COUNT(*) <= 1 THEN COALESCE(SUM(amount), 0) ELSE NULL END FROM category_source_counts sc WHERE sc."category" = c."category"),
            'sourceSegments', (SELECT jsonb_object_agg(sc."keyVersion"::text, sc.amount) FROM category_source_counts sc WHERE sc."category" = c."category")
          )) FROM category_totals c JOIN category_batches b ON b."category" = c."category"
        ), '{}'::jsonb),
        'trend', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'bucketStart', t.time, 'requests', t.requests,
            'categories', (SELECT jsonb_object_agg(tc."category"::text, tc.requests) FROM trend_categories tc WHERE tc.time = t.time)
          ) ORDER BY t.time) FROM trend_totals t
        ), '[]'::jsonb)
      ) AS data
    `,
        tx.securityTelemetryState.findUnique({ where: { id: "global" } }),
      ]),
    { isolationLevel: "RepeatableRead" },
  );
  const data = rows[0].data;
  const versions = Object.keys(data.sourceSegments);
  const categoryNames = [
    "PUBLIC_SCAN",
    "CREDENTIAL_STUFFING",
    "DISTRIBUTED_LOGIN_ATTEMPT",
  ] as const;
  const summary = {
    ...data,
    sources:
      versions.length <= 1
        ? Object.values(data.sourceSegments).reduce((sum, value) => sum + value, 0)
        : null,
    keyRotation: versions.length > 1,
    categories: Object.fromEntries(
      categoryNames.map((category) => [
        category,
        data.categories[category] ?? { batches: 0, requests: 0, sources: 0, sourceSegments: {} },
      ]),
    ),
    trend: data.trend.map((entry) => ({
      ...entry,
      bucketStart: new Date(entry.bucketStart).toISOString(),
      categories: Object.fromEntries(
        categoryNames.map((category) => [category, entry.categories[category] ?? 0]),
      ),
    })),
    trendBucketSeconds,
  };
  return {
    ...summary,
    since: since.toISOString(),
    until: until.toISOString(),
    complete: Boolean(
      state?.collectionHealthy &&
      state.processedThrough &&
      state.processedThrough >= until &&
      since.getTime() >= floorSecurityMinute(now).getTime() - SECURITY_RETENTION_MS &&
      state.lastError !== "AGGREGATION_FAILED",
    ),
    collectionHealthy: state?.collectionHealthy ?? false,
    processedThrough: state?.processedThrough?.toISOString() ?? null,
    lastCollectedAt: state?.lastCollectedAt?.toISOString() ?? null,
    lastAggregatedAt: state?.lastAggregatedAt?.toISOString() ?? null,
    droppedCount: state?.droppedCount ?? 0,
    lastError: state?.lastError ?? null,
    delayed: !state?.processedThrough || state.processedThrough < until,
  };
}
