import { afterEach, describe, expect, it, vi } from "vitest";
import { isMockServiceMode, isRemoteServiceMode, resolveServiceMode } from "@/lib/service-mode";

describe("service mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the statically addressable public mode in a development runtime", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SERVICE_MODE", "");
    vi.stubEnv("NEXT_PUBLIC_SERVICE_MODE", "remote");

    expect(resolveServiceMode()).toBe("remote");
    expect(isRemoteServiceMode()).toBe(true);
  });

  it("keeps mock as the safe non-production default", () => {
    expect(resolveServiceMode({ NODE_ENV: "development" })).toBe("mock");
    expect(isMockServiceMode({ NODE_ENV: "test", SERVICE_MODE: "mock" })).toBe(true);
  });

  it("forces production callers onto remote services", () => {
    expect(resolveServiceMode({ NODE_ENV: "production", SERVICE_MODE: "mock" })).toBe("remote");
  });
});
