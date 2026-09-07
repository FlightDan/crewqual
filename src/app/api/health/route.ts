import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError } from "@/server/api";
import { hasSettingsReadAccess } from "@/server/admin-guard";
import { getServerConfig } from "@/server/config";
import { getPrisma } from "@/server/prisma";
import { checkObjectStorage } from "@/server/health";
import { getMockInstanceId } from "@/server/mock-runtime";
import { safeEqualHex, sha256 } from "@/server/crypto";

const READINESS_TIMEOUT_MS = 4_000;

async function withReadinessDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Readiness deadline exceeded")),
          READINESS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const url = new URL(request.url);
  const probe = url.searchParams.get("probe");
  const hasAdminSession = request.cookies.has("crewqual_admin_session");

  // Liveness is intentionally independent of configuration and every other
  // application service. It must remain usable while the app is starting or
  // when a dependency is unavailable.
  if (probe === "liveness" || probe === null) {
    return jsonData({ status: "ok", probe: "liveness" }, requestId);
  }

  if (probe !== "readiness") {
    return jsonError(new ApiError("INVALID_HEALTH_PROBE", "未知健康检查类型", 400), requestId);
  }

  try {
    const expectedProbeSecret = process.env.READINESS_PROBE_SECRET ?? "";
    const providedProbeSecret = request.headers.get("x-crewqual-readiness-secret") ?? "";
    const internalProbe =
      expectedProbeSecret.length >= 32 &&
      safeEqualHex(sha256(providedProbeSecret), sha256(expectedProbeSecret));

    // Full readiness is an authenticated dependency oracle. Orchestrators use
    // a dedicated deployment secret; administrators may inspect it through a
    // normal settings.read session. Liveness remains public and dependency-free.
    if (!internalProbe) {
      if (!hasAdminSession) {
        return jsonError(new ApiError("UNAUTHENTICATED", "请先登录", 401), requestId);
      }

      const authorized = await hasSettingsReadAccess(request);
      if (!authorized) {
        return jsonError(new ApiError("FORBIDDEN", "没有查看就绪状态的权限", 403), requestId);
      }
    }

    const startedAt = Date.now();
    const config = getServerConfig();
    if (config.SERVICE_MODE === "mock") {
      const response = jsonData(
        {
          status: "ok",
          probe: "readiness",
          mode: "mock",
          database: "not_used",
          storage: "not_used",
          queue: "not_used",
          worker: "not_used",
          instanceId: getMockInstanceId(),
          latencyMs: Date.now() - startedAt,
        },
        requestId,
      );
      response.headers.set("cache-control", "no-store");
      return response;
    }
    const db = getPrisma();
    const [, queueCheck, storage, heartbeat] = await withReadinessDeadline(
      Promise.all([
        db.$queryRaw`SELECT 1`,
        db.$queryRaw<Array<{ table_name: string | null }>>`
          SELECT to_regclass('pgboss.job')::text AS table_name
        `,
        checkObjectStorage(),
        db.workerHeartbeat.findUnique({ where: { name: "primary" } }),
      ]),
    );
    const queue = queueCheck[0]?.table_name ? "ok" : "unavailable";
    const worker =
      heartbeat && Date.now() - heartbeat.lastSeenAt.getTime() <= 45_000 ? "ok" : "unavailable";
    const status = queue === "ok" && storage === "ok" && worker === "ok" ? "ok" : "degraded";
    const response = jsonData(
      {
        status,
        probe: "readiness",
        mode: "remote",
        database: "ok",
        storage,
        queue,
        worker,
        latencyMs: Date.now() - startedAt,
      },
      requestId,
      status === "ok" ? 200 : 503,
    );
    response.headers.set("cache-control", "no-store");
    return response;
  } catch {
    return jsonError(new ApiError("HEALTHCHECK_FAILED", "依赖检查失败", 503), requestId);
  }
}
