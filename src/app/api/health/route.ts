import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError } from "@/server/api";
import { getServerConfig } from "@/server/config";
import { getPrisma } from "@/server/prisma";
import { checkObjectStorage } from "@/server/health";
import { getMockInstanceId } from "@/server/mock-runtime";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  try {
    const config = getServerConfig();
    const probe = new URL(request.url).searchParams.get("probe");
    if (probe === "liveness") {
      return jsonData({ status: "ok", probe: "liveness" }, requestId);
    }
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
    await db.$queryRaw`SELECT 1`;
    const [queueCheck, storage, heartbeat] = await Promise.all([
      db.$queryRaw<Array<{ table_name: string | null }>>`
        SELECT to_regclass('pgboss.job')::text AS table_name
      `,
      checkObjectStorage(),
      db.workerHeartbeat.findUnique({ where: { name: "primary" } }),
    ]);
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
