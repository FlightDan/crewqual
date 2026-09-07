import { describe, expect, it, vi } from "vitest";
import {
  assertExternalEndpointAllowlistConfig,
  checkExternalEndpoint,
  createPinnedLookup,
  isLocalTestEndpoint,
  resolveExternalEndpoint,
} from "@/server/external-endpoint-safety";

describe("external integration endpoint safety", () => {
  it("recognizes only HTTP(S) loopback test endpoints", () => {
    expect(isLocalTestEndpoint("http://localhost:8123/fake")).toBe(true);
    expect(isLocalTestEndpoint("https://127.0.0.1/models")).toBe(true);
    expect(isLocalTestEndpoint("http://[::1]:9000/test")).toBe(true);
    expect(isLocalTestEndpoint("https://example.test/hook")).toBe(false);
    expect(isLocalTestEndpoint("http://localhost.evil.test/hook")).toBe(false);
    expect(isLocalTestEndpoint("file://localhost/etc/passwd")).toBe(false);
  });

  it("allows public HTTPS but rejects public HTTP and embedded credentials in production", () => {
    expect(checkExternalEndpoint("https://open.feishu.test/hook", true)).toEqual({ ok: true });
    expect(checkExternalEndpoint("http://8.8.8.8/hook", true).ok).toBe(false);
    expect(checkExternalEndpoint("http://8.8.8.8/hook", true, { allowedHosts: "8.8.8.8" }).ok).toBe(
      false,
    );
    expect(checkExternalEndpoint("https://user:pass@example.test/hook", true).ok).toBe(false);
    expect(checkExternalEndpoint("ftp://example.test/files", true).ok).toBe(false);
  });

  it("requires deployment authorization for private and loopback targets in production", () => {
    expect(checkExternalEndpoint("https://10.0.0.5:8443/v1", true).ok).toBe(false);
    expect(checkExternalEndpoint("http://127.0.0.1:8000/v1", true).ok).toBe(false);
    expect(
      checkExternalEndpoint("http://127.0.0.1:8000/v1", true, {
        allowedHosts: "127.0.0.1:8000",
      }),
    ).toEqual({ ok: true });
    expect(
      checkExternalEndpoint("https://10.0.0.5:8443/v1", true, {
        allowedCidrs: "10.0.0.0/8",
      }),
    ).toEqual({ ok: true });
    expect(
      checkExternalEndpoint("http://qwen.internal:8000/v1", true, {
        allowedHosts: "qwen.internal:8000",
      }),
    ).toEqual({ ok: true });
  });

  it("can require an exact deployment-owned host entry for credential-bearing services", () => {
    expect(
      checkExternalEndpoint("https://s3.example.test", true, { requireHostAllowlist: true }).ok,
    ).toBe(false);
    expect(
      checkExternalEndpoint("https://s3.example.test", true, {
        allowedHosts: "s3.example.test",
        requireHostAllowlist: true,
      }),
    ).toEqual({ ok: true });
    expect(
      checkExternalEndpoint("https://s3.example.test:9443", true, {
        allowedHosts: "s3.example.test",
        requireHostAllowlist: true,
      }).ok,
    ).toBe(false);
    expect(
      checkExternalEndpoint("https://s3.example.test", true, {
        allowedHosts: "s3.example.test:80",
        requireHostAllowlist: true,
      }).ok,
    ).toBe(false);
  });

  it("always rejects metadata, link-local, unspecified and multicast targets", () => {
    for (const production of [true, false]) {
      const options = { allowedHosts: "metadata.google.internal,169.254.169.254" };
      expect(
        checkExternalEndpoint("http://169.254.169.254/latest/meta-data", production, options).ok,
      ).toBe(false);
      expect(checkExternalEndpoint("http://[fe80::1]:8000/v1", production, options).ok).toBe(false);
      expect(checkExternalEndpoint("http://0.0.0.0:8000", production, options).ok).toBe(false);
      expect(
        checkExternalEndpoint(
          "https://metadata.google.internal/computeMetadata",
          production,
          options,
        ).ok,
      ).toBe(false);
    }
  });

  it("validates deployment allowlist syntax at configuration load", () => {
    expect(() =>
      assertExternalEndpointAllowlistConfig("minio:9000,qwen.internal:8000", "10.0.0.0/8,fd00::/8"),
    ).not.toThrow();
    expect(() => assertExternalEndpointAllowlistConfig("https://bad.example", "")).toThrow(
      "OUTBOUND_ALLOWED_HOSTS",
    );
    expect(() => assertExternalEndpointAllowlistConfig("*.internal.example", "")).toThrow(
      "OUTBOUND_ALLOWED_HOSTS",
    );
    expect(() => assertExternalEndpointAllowlistConfig("", "10.0.0.0/99")).toThrow(
      "OUTBOUND_ALLOWED_CIDRS",
    );
  });
});

describe("resolveExternalEndpoint", () => {
  it("creates a lookup function that cannot perform a second DNS resolution", async () => {
    const lookup = createPinnedLookup({ address: "93.184.216.34", family: 4 });
    await expect(
      new Promise<{ address: string; family?: number }>((resolve, reject) => {
        lookup("rebound.example.test", { all: false }, (error, address, family) => {
          if (error) reject(error);
          else resolve({ address: String(address), family });
        });
      }),
    ).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("accepts public DNS answers and returns the pinned address", async () => {
    await expect(
      resolveExternalEndpoint("https://api.example.test/hook", true, {
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    ).resolves.toMatchObject({
      url: new URL("https://api.example.test/hook"),
      address: { address: "93.184.216.34", family: 4 },
    });
  });

  it("rejects DNS answers that enter private space unless deployment-authorized", async () => {
    const resolver = async () => [{ address: "10.8.0.12", family: 4 as const }];
    await expect(
      resolveExternalEndpoint("https://qwen.internal.test/v1", true, { resolver }),
    ).rejects.toThrow("未经部署配置授权");
    await expect(
      resolveExternalEndpoint("https://qwen.internal.test/v1", true, {
        resolver,
        allowedHosts: "qwen.internal.test",
      }),
    ).resolves.toMatchObject({ address: { address: "10.8.0.12" } });
  });

  it("does not let a host allowlist downgrade a public endpoint to plaintext HTTP", async () => {
    await expect(
      resolveExternalEndpoint("http://api.example.test/hook", true, {
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
        allowedHosts: "api.example.test:80",
      }),
    ).rejects.toThrow("必须使用 HTTPS");
  });

  it("rejects mixed public/private DNS answers and absolute forbidden ranges", async () => {
    await expect(
      resolveExternalEndpoint("https://mixed.example.test", true, {
        resolver: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        allowedHosts: "mixed.example.test",
      }),
    ).rejects.toThrow("混合的公网和内网");
    await expect(
      resolveExternalEndpoint("https://metadata-alias.example.test", true, {
        resolver: async () => [{ address: "169.254.169.254", family: 4 }],
        allowedHosts: "metadata-alias.example.test",
      }),
    ).rejects.toThrow("元数据");
  });

  it("re-resolves on every use so a later DNS rebind is rejected", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      resolveExternalEndpoint("https://rebind.example.test", true, { resolver }),
    ).resolves.toMatchObject({ address: { address: "93.184.216.34" } });
    await expect(
      resolveExternalEndpoint("https://rebind.example.test", true, { resolver }),
    ).rejects.toThrow("未经部署配置授权");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("normalizes IPv4-mapped IPv6 before applying private-range policy", async () => {
    await expect(
      resolveExternalEndpoint("https://mapped.example.test", true, {
        resolver: async () => [{ address: "::ffff:7f00:1", family: 6 }],
      }),
    ).rejects.toThrow("未经部署配置授权");
  });

  it("bounds DNS resolution with the request deadline", async () => {
    await expect(
      resolveExternalEndpoint("https://slow.example.test", true, {
        resolver: () => new Promise(() => undefined),
        resolveTimeoutMs: 10,
      }),
    ).rejects.toBeDefined();
  });
});
