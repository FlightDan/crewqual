import { describe, expect, it } from "vitest";
import { isLocalTestEndpoint } from "@/server/external-endpoint-safety";

describe("external integration endpoint safety", () => {
  it("allows only HTTP(S) loopback endpoints", () => {
    expect(isLocalTestEndpoint("http://localhost:8123/fake")).toBe(true);
    expect(isLocalTestEndpoint("https://127.0.0.1/models")).toBe(true);
    expect(isLocalTestEndpoint("http://[::1]:9000/test")).toBe(true);
  });

  it("rejects remote, malformed and non-HTTP endpoints", () => {
    expect(isLocalTestEndpoint("https://example.test/hook")).toBe(false);
    expect(isLocalTestEndpoint("http://localhost.evil.test/hook")).toBe(false);
    expect(isLocalTestEndpoint("file://localhost/etc/passwd")).toBe(false);
    expect(isLocalTestEndpoint("not a URL")).toBe(false);
  });
});
