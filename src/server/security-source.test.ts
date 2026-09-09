// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  floorSecurityMinute,
  maskSecurityAddress,
  normalizeSecurityAddress,
  securityHasher,
  securityPathFingerprint,
} from "./security-source";

describe("security source privacy", () => {
  it("normalizes equivalent IPv6 forms and mapped IPv4 addresses", () => {
    expect(normalizeSecurityAddress("2001:0DB8:0:0::1")).toBe("2001:db8::1");
    expect(normalizeSecurityAddress("::ffff:192.0.2.3")).toBe("192.0.2.3");
    expect(normalizeSecurityAddress("::ffff:c000:203")).toBe("192.0.2.3");
    for (const invalid of [
      "direct-client",
      "unresolved-client",
      "127.0.0.1, 8.8.8.8",
      "fe80::1%eth0",
      "https://example.test",
      "192.0.2.3:80",
      "",
    ])
      expect(normalizeSecurityAddress(invalid)).toBeNull();
  });
  it("masks network addresses without preserving host bits", () => {
    expect(maskSecurityAddress("192.0.2.123")).toBe("192.0.2.*");
    expect(maskSecurityAddress("2001:db8::1234")).toBe("2001:db8:0:*");
    expect(maskSecurityAddress(null)).toBe("来源不可判定");
  });
  it("separates domains, roots, and key versions without exposing path queries", () => {
    const a = securityHasher("root-a");
    const b = securityHasher("root-b");
    expect(a.hash("source", "same")).not.toBe(a.hash("account", "same"));
    expect(a.hash("source", "same")).not.toBe(b.hash("source", "same"));
    expect(a.keyVersion).not.toBe(b.keyVersion);
    expect(securityPathFingerprint("/api/test?token=SECRET#frag", a)).toBe(
      securityPathFingerprint("/api/test", a),
    );
    expect(floorSecurityMinute(new Date("2026-09-08T00:00:59.999Z")).toISOString()).toBe(
      "2026-09-08T00:00:00.000Z",
    );
  });
});
