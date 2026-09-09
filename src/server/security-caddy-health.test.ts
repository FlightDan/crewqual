// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gap: vi.fn().mockResolvedValue(true) }));
vi.mock("@/server/security-events", () => ({ recordSecurityCollectionGap: mocks.gap }));

import {
  CADDY_HEALTH_BASELINE_KEY,
  monitorCaddySecurityHealth,
  parseCaddyHealthMetrics,
} from "@/server/security-caddy-health";

const sample = (errors: number, started = 1_788_860_000) => `
# HELP ignored ignored
process_start_time_seconds ${started}
caddy_http_request_errors_total{handler="reverse_proxy",server="srv0"} ${errors}
caddy_http_request_errors_total{handler="subroute",server="srv0"} 0
`;

function fixture(baseline: { windowStart: Date; count: number } | null) {
  return {
    rateLimitBucket: {
      findUnique: vi.fn().mockResolvedValue(baseline),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("Caddy completeness monitor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses only bounded error counters and requires a process epoch", () => {
    expect(parseCaddyHealthMetrics(sample(3))).toEqual({
      errors: 3,
      processStartedAt: new Date(1_788_860_000_000),
    });
    expect(() => parseCaddyHealthMetrics("caddy_http_request_errors_total{} 1\n")).toThrow();
  });

  it("establishes a baseline without manufacturing a startup gap", async () => {
    const db = fixture(null);
    const result = await monitorCaddySecurityHealth(
      "http://caddy:2020/metrics",
      db as never,
      vi.fn().mockResolvedValue(new Response(sample(0))),
    );
    expect(result).toBe("initialized");
    expect(mocks.gap).not.toHaveBeenCalled();
    expect(db.rateLimitBucket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: CADDY_HEALTH_BASELINE_KEY },
        create: expect.objectContaining({ count: 0 }),
      }),
    );
  });

  it("marks a gap when Caddy errors increase, restarts, or becomes unobservable", async () => {
    const started = new Date(1_788_860_000_000);
    const db = fixture({ windowStart: started, count: 2 });
    expect(
      await monitorCaddySecurityHealth(
        "http://caddy:2020/metrics",
        db as never,
        vi.fn().mockResolvedValue(new Response(sample(3))),
      ),
    ).toBe("gap");
    expect(mocks.gap).toHaveBeenCalledWith("CADDY_FAILURE", db, expect.any(Date));

    mocks.gap.mockClear();
    expect(
      await monitorCaddySecurityHealth(
        "http://caddy:2020/metrics",
        db as never,
        vi.fn().mockRejectedValue(new Error("offline")),
      ),
    ).toBe("gap");
    expect(mocks.gap).toHaveBeenCalledOnce();

    mocks.gap.mockClear();
    expect(
      await monitorCaddySecurityHealth(
        "http://caddy:2020/metrics",
        db as never,
        vi.fn().mockResolvedValue(new Response(sample(0, 1_788_860_100))),
      ),
    ).toBe("gap");
    expect(mocks.gap).toHaveBeenCalledOnce();
  });

  it("does not claim a gap before the first successful observation", async () => {
    const result = await monitorCaddySecurityHealth(
      "http://caddy:2020/metrics",
      fixture(null) as never,
      vi.fn().mockRejectedValue(new Error("starting")),
    );
    expect(result).toBe("uninitialized");
    expect(mocks.gap).not.toHaveBeenCalled();
  });
});
