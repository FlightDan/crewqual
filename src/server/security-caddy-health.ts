import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/prisma";
import { recordSecurityCollectionGap } from "@/server/security-events";

export const CADDY_HEALTH_BASELINE_KEY = "security-health-monitor:caddy:v1";
const MAX_METRICS_BYTES = 5 * 1024 * 1024;

export function parseCaddyHealthMetrics(metrics: string) {
  let errors = 0;
  let processStartedAt: Date | null = null;
  for (const line of metrics.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("caddy_http_request_errors_total{")) {
      const value = Number(line.slice(line.lastIndexOf(" ") + 1));
      if (Number.isFinite(value) && value >= 0) errors += value;
    } else if (line.startsWith("process_start_time_seconds ")) {
      const value = Number(line.slice(line.lastIndexOf(" ") + 1));
      if (Number.isFinite(value) && value > 0) processStartedAt = new Date(value * 1000);
    }
  }
  if (!processStartedAt || !Number.isFinite(processStartedAt.getTime())) {
    throw new Error("Caddy process metric is unavailable");
  }
  if (!Number.isSafeInteger(errors) || errors > 2_000_000_000) {
    throw new Error("Caddy error metric is invalid");
  }
  return { errors, processStartedAt };
}

/**
 * Scrapes the private Caddy metrics listener. Any observed handler error,
 * restart, or loss of monitoring after the initial baseline makes telemetry
 * incomplete without turning the event into an attack signal.
 */
export async function monitorCaddySecurityHealth(
  metricsUrl: string | undefined,
  db: PrismaClient = getPrisma(),
  fetcher: typeof fetch = fetch,
  now = new Date(),
) {
  if (!metricsUrl) return "disabled" as const;
  const baseline = await db.rateLimitBucket.findUnique({
    where: { key: CADDY_HEALTH_BASELINE_KEY },
  });
  try {
    const response = await fetcher(metricsUrl, {
      headers: { accept: "text/plain" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Caddy metrics request failed");
    const declaredSize = Number(response.headers.get("content-length") ?? "0");
    if (declaredSize > MAX_METRICS_BYTES) throw new Error("Caddy metrics response is too large");
    const body = await response.text();
    if (Buffer.byteLength(body) > MAX_METRICS_BYTES)
      throw new Error("Caddy metrics response is too large");
    const current = parseCaddyHealthMetrics(body);
    const restarted = Boolean(
      baseline && baseline.windowStart.getTime() !== current.processStartedAt.getTime(),
    );
    const increased = Boolean(baseline && !restarted && current.errors > baseline.count);
    // Errors already present before the first successful observation are an
    // unknown interval, so they also invalidate completeness conservatively.
    const missedBeforeBaseline = !baseline && current.errors > 0;
    if (restarted || increased || missedBeforeBaseline) {
      if (!(await recordSecurityCollectionGap("CADDY_FAILURE", db, now))) {
        throw new Error("Caddy completeness gap could not be persisted");
      }
    }
    // Advance the baseline only after a required gap marker is durable. A
    // failed write is retried on the next job instead of silently forgetting
    // the observed counter increase.
    await db.rateLimitBucket.upsert({
      where: { key: CADDY_HEALTH_BASELINE_KEY },
      create: {
        key: CADDY_HEALTH_BASELINE_KEY,
        windowStart: current.processStartedAt,
        count: current.errors,
      },
      update: { windowStart: current.processStartedAt, count: current.errors },
    });
    if (restarted || increased || missedBeforeBaseline) return "gap" as const;
    return baseline ? ("healthy" as const) : ("initialized" as const);
  } catch {
    // Startup before the first successful scrape has no established coverage
    // boundary. Once initialized, losing the monitor is a collection gap.
    if (!baseline) return "uninitialized" as const;
    if (!(await recordSecurityCollectionGap("CADDY_FAILURE", db, now))) {
      throw new Error("Caddy completeness gap could not be persisted");
    }
    return "gap" as const;
  }
}
