import type { Prisma, PrismaClient, SecuritySignalKind } from "@/generated/prisma/client";
import { getPrisma } from "@/server/prisma";
import {
  floorSecurityMinute,
  maskSecurityAddress,
  normalizeSecurityAddress,
  securityHasher,
  securityPathFingerprint,
} from "@/server/security-source";

export const SECURITY_CAPACITY = {
  bucketsPerMinute: 2_000,
  bucketsPerSourceMinute: 200,
  // Keeps the maximum retained request total within the database Int cache range.
  receiptsPerMinute: 20_000,
  receiptTtlMs: 30 * 60_000,
  maximumLatenessMs: 15 * 60_000,
} as const;

export type SecuritySignalInput = {
  /** Random internal request key, minted/verified by the trusted ingress. */
  requestKey: string;
  kind: SecuritySignalKind;
  /** Only a trusted proxy or authenticated internal ingress may supply this. */
  address?: string | null;
  /** Prefix with the authentication realm, e.g. admin:alice@example.test. */
  accountIdentifier?: string | null;
  routeClass?: string | null;
  pathname?: string | null;
  outcome: string;
  at?: Date;
  /** These IDs must be resolved by the caller from database records. */
  identity?: {
    adminUserId?: string | null;
    pilotId?: string | null;
    personId?: string | null;
    unitId?: string | null;
    organizationId?: string | null;
  };
};

/** A bounded, dimension-free minute counter preserves collection gaps until retention expires. */
export const SECURITY_COLLECTION_GAP_PREFIX = "security-collection-gap:";
async function recordCollectionGap(tx: Prisma.TransactionClient, code: string, now: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('crewqual-security-health'))`;
  const windowStart = floorSecurityMinute(now);
  const key = `${SECURITY_COLLECTION_GAP_PREFIX}${windowStart.toISOString()}`;
  await tx.rateLimitBucket.upsert({
    where: { key },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });
  await tx.securityTelemetryState.upsert({
    where: { id: "global" },
    create: { id: "global", collectionHealthy: false, droppedCount: 1, lastError: code },
    update: { collectionHealthy: false, droppedCount: { increment: 1 }, lastError: code },
  });
}

/** Marks telemetry incomplete without storing request-derived dimensions. */
export async function recordSecurityCollectionGap(
  code: "PREFLIGHT_FAILED" | "CADDY_FAILURE",
  db: PrismaClient = getPrisma(),
  now = new Date(),
) {
  try {
    await db.$transaction((tx) => recordCollectionGap(tx, code, now));
    return true;
  } catch {
    return false;
  }
}

export async function recordSecuritySignal(
  input: SecuritySignalInput,
  db: PrismaClient = getPrisma(),
  now = new Date(),
): Promise<"recorded" | "duplicate" | "dropped"> {
  try {
    if (!input.requestKey || input.requestKey.length > 256) throw new Error("invalid_request_key");
    const at = input.at ?? now;
    if (
      !Number.isFinite(at.getTime()) ||
      at.getTime() < now.getTime() - SECURITY_CAPACITY.maximumLatenessMs ||
      at.getTime() > now.getTime() + 60_000
    ) {
      throw new Error("invalid_signal_time");
    }
    const hasher = securityHasher();
    const address = normalizeSecurityAddress(input.address);
    const sourceHash = address ? hasher.hash("source", address) : null;
    const accountHash = input.accountIdentifier
      ? hasher.hash("account", input.accountIdentifier.trim().toLowerCase().slice(0, 320))
      : null;
    const pathHash = securityPathFingerprint(input.pathname, hasher);
    const routeClass =
      input.routeClass && /^[A-Z][A-Z0-9_]{0,63}$/.test(input.routeClass) ? input.routeClass : null;
    const outcome = /^[A-Z][A-Z0-9_]{0,63}$/.test(input.outcome) ? input.outcome : "UNCLASSIFIED";
    const identity = {
      adminUserId: input.identity?.adminUserId ?? null,
      pilotId: input.identity?.pilotId ?? null,
      personId: input.identity?.personId ?? null,
      unitId: input.identity?.unitId ?? null,
      organizationId: input.identity?.organizationId ?? null,
    };
    const dimensionKey = hasher.hash(
      "dimension",
      JSON.stringify([
        sourceHash ?? "missing:source",
        accountHash ?? "missing:account",
        pathHash ?? "missing:path",
        routeClass,
        outcome,
        identity,
      ]),
    );
    const bucketStart = floorSecurityMinute(at);
    const requestKey = hasher.hash("request", input.requestKey);
    return await db.$transaction(async (tx) => {
      // This short lock serializes capacity decisions and receipt claims across web replicas.
      // The lock is minute scoped; a receipt key lock also covers retries across minute boundaries.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`security-receipt:${requestKey}`}))`;
      if (await tx.securitySignalReceipt.findUnique({ where: { requestKey } }))
        return "duplicate" as const;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`security-ingest:${floorSecurityMinute(now).toISOString()}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`security-capacity:${bucketStart.toISOString()}`}))`;
      const unique = { bucketStart, kind: input.kind, keyVersion: hasher.keyVersion, dimensionKey };
      const current = await tx.securitySignalBucket.findUnique({
        where: { bucketStart_kind_keyVersion_dimensionKey: unique },
        select: { id: true },
      });
      const [bucketCount, sourceCount, receiptCount] = await Promise.all([
        current ? 0 : tx.securitySignalBucket.count({ where: { bucketStart } }),
        current ? 0 : tx.securitySignalBucket.count({ where: { bucketStart, sourceHash } }),
        tx.securitySignalReceipt.count({
          where: {
            expiresAt: {
              gte: new Date(floorSecurityMinute(now).getTime() + SECURITY_CAPACITY.receiptTtlMs),
              lt: new Date(
                floorSecurityMinute(now).getTime() + SECURITY_CAPACITY.receiptTtlMs + 60_000,
              ),
            },
          },
        }),
      ]);
      if (
        bucketCount >= SECURITY_CAPACITY.bucketsPerMinute ||
        sourceCount >= SECURITY_CAPACITY.bucketsPerSourceMinute ||
        receiptCount >= SECURITY_CAPACITY.receiptsPerMinute
      ) {
        await recordCollectionGap(tx, "CAPACITY_EXCEEDED", now);
        return "dropped" as const;
      }
      const signal = await tx.securitySignalBucket.upsert({
        where: { bucketStart_kind_keyVersion_dimensionKey: unique },
        create: {
          ...unique,
          ...identity,
          sourceHash,
          maskedSource: maskSecurityAddress(address),
          accountHash,
          routeClass,
          pathHash,
          outcome,
          count: 1,
          firstSeenAt: at,
          lastSeenAt: at,
        },
        update: { count: { increment: 1 } },
      });
      await tx.securitySignalBucket.update({
        where: { id: signal.id },
        data: {
          firstSeenAt: new Date(Math.min(signal.firstSeenAt.getTime(), at.getTime())),
          lastSeenAt: new Date(Math.max(signal.lastSeenAt.getTime(), at.getTime())),
        },
      });
      await tx.securitySignalReceipt.create({
        data: {
          requestKey,
          signalBucketId: signal.id,
          expiresAt: new Date(now.getTime() + SECURITY_CAPACITY.receiptTtlMs),
        },
      });
      const late = bucketStart < floorSecurityMinute(now);
      await tx.securityTelemetryState.upsert({
        where: { id: "global" },
        create: { id: "global", lastCollectedAt: now, version: late ? 2 : 1 },
        update: { lastCollectedAt: now, ...(late ? { version: { increment: 1 } } : {}) },
      });
      if (late) {
        // Invalidate prior completeness until the changed minute is re-evaluated.
        await tx.securityTelemetryState.updateMany({
          where: { id: "global", processedThrough: { gt: bucketStart } },
          data: { processedThrough: bucketStart },
        });
      }
      return "recorded" as const;
    });
  } catch {
    // Do not persist exception text: it may include a request value or a database URL.
    await db
      .$transaction((tx) => recordCollectionGap(tx, "COLLECTION_FAILED", now))
      .catch(() => undefined);
    return "dropped";
  }
}
