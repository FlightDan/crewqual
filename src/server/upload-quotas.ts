import { ApiError } from "@/server/api";
/* eslint-disable @typescript-eslint/no-explicit-any */

export const UPLOAD_LIMITS = {
  concurrent: 3,
  windowCount: 10,
  windowMs: 15 * 60 * 1000,
  dailyCount: 30,
  dailyBytes: 200 * 1024 * 1024,
  maxOrphans: 10,
  leaseMs: 5 * 60 * 1000,
} as const;

function quotaError(code: string, message: string, retryAfterSeconds = 60) {
  return new ApiError(code, message, 429, undefined, {
    retryAfterSeconds,
    limits: {
      concurrent: UPLOAD_LIMITS.concurrent,
      windowCount: UPLOAD_LIMITS.windowCount,
      dailyCount: UPLOAD_LIMITS.dailyCount,
      dailyBytes: UPLOAD_LIMITS.dailyBytes,
    },
  });
}

export async function reserveUpload(db: any, pilotId: string, bytes: number, now = new Date()) {
  if (typeof db.uploadReservation?.create !== "function") return null;
  const run = async (tx: any) => {
    await tx.uploadReservation.updateMany({
      where: { pilotId, status: "ACTIVE", expiresAt: { lte: now } },
      data: { status: "RELEASED", releasedAt: now },
    });
    const windowSince = new Date(now.getTime() - UPLOAD_LIMITS.windowMs);
    const daySince = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const [active, recentLeases, todayLeases, todayImages, orphans] = await Promise.all([
      tx.uploadReservation.count({ where: { pilotId, status: "ACTIVE", expiresAt: { gt: now } } }),
      tx.uploadReservation.count({ where: { pilotId, createdAt: { gte: windowSince } } }),
      tx.uploadReservation.count({ where: { pilotId, createdAt: { gte: daySince } } }),
      tx.evidenceImage.aggregate({
        where: { pilotId, createdAt: { gte: daySince } },
        _count: { _all: true },
        _sum: { byteSize: true },
      }),
      tx.evidenceImage.count({ where: { pilotId, status: "orphaned" } }),
    ]);
    const todayCount = todayLeases + Number(todayImages._count?._all ?? 0);
    const todayBytes = Number(todayImages._sum?.byteSize ?? 0);
    if (active >= UPLOAD_LIMITS.concurrent)
      throw quotaError("UPLOAD_CONCURRENT_LIMIT", "当前上传并发数已达上限", 300);
    if (recentLeases >= UPLOAD_LIMITS.windowCount)
      throw quotaError("UPLOAD_RATE_LIMIT", "上传频率已达上限", 900);
    if (todayCount >= UPLOAD_LIMITS.dailyCount || todayBytes + bytes > UPLOAD_LIMITS.dailyBytes)
      throw quotaError("UPLOAD_DAILY_QUOTA", "今日上传配额已达上限", 3600);
    if (orphans >= UPLOAD_LIMITS.maxOrphans)
      throw quotaError("UPLOAD_ORPHAN_LIMIT", "待关联上传数量已达上限", 900);
    const reservation = await tx.uploadReservation.create({
      data: {
        pilotId,
        bytesReserved: bytes,
        expiresAt: new Date(now.getTime() + UPLOAD_LIMITS.leaseMs),
      },
      select: { id: true },
    });
    return reservation.id as string;
  };
  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

export async function releaseUpload(db: any, id: string, now = new Date()) {
  if (!id || typeof db.uploadReservation?.updateMany !== "function") return;
  await db.uploadReservation.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status: "RELEASED", releasedAt: now },
  });
}
