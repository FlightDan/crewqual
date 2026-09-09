import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  secret: "test-only-ingress-secret-which-is-not-a-deployment-credential",
  signal: vi.fn(),
  address: vi.fn(),
}));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ NETWORK_ACCESS_SECRET: mocks.secret }),
}));
vi.mock("@/server/rate-limit", () => ({ requestAddress: mocks.address }));
vi.mock("@/server/security-events", () => ({ recordSecuritySignal: mocks.signal }));

import {
  publicSecurityRequestContext,
  recordPublicSecuritySignal,
  sealPublicRequestKey,
  verifyPublicRequestKey,
} from "@/server/security-request";
import { classifySecurityRoute } from "@/server/security-route-classifier";

const key = "00000000-0000-4000-8000-000000000001";
const otherKey = "00000000-0000-4000-8000-000000000002";
const pathname = "/api/member/qualifications";
const routeClass = classifySecurityRoute(pathname, "GET").routeClass;
function request(
  input: { pathname?: string; method?: string; key?: string; routeClass?: string } = {},
) {
  return new NextRequest(`http://crewqual.test${input.pathname ?? pathname}`, {
    method: input.method ?? "GET",
    headers: {
      "x-crewqual-request-key": input.key ?? sealPublicRequestKey(key, routeClass, "GET", pathname),
      "x-crewqual-route-class": input.routeClass ?? routeClass,
      "x-crewqual-remote-ip": "203.0.113.20",
    },
  });
}

describe("sealed public ingress request context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.address.mockReturnValue("203.0.113.20");
    mocks.signal.mockResolvedValue("recorded");
  });

  it("seals the request UUID, route class, method and path with a secret", () => {
    const sealed = sealPublicRequestKey(key, routeClass, "GET", pathname);
    expect(sealed).toMatch(new RegExp(`^${key}\\.[a-f0-9]{64}$`));
    expect(verifyPublicRequestKey(sealed, routeClass, "GET", pathname)).toBe(true);
    expect(
      verifyPublicRequestKey(sealed, routeClass, "GET", pathname, "a-different-test-secret"),
    ).toBe(false);
    expect(verifyPublicRequestKey(sealed, "PAGE_ADMIN", "GET", pathname)).toBe(false);
    expect(verifyPublicRequestKey(sealed, routeClass, "POST", pathname)).toBe(false);
    expect(verifyPublicRequestKey(sealed, routeClass, "GET", `${pathname}/another-record`)).toBe(
      false,
    );
    expect(verifyPublicRequestKey(sealed.replace(key, otherKey), routeClass, "GET", pathname)).toBe(
      false,
    );
    const changedMac = `${sealed.slice(0, -1)}${sealed.endsWith("0") ? "1" : "0"}`;
    expect(verifyPublicRequestKey(changedMac, routeClass, "GET", pathname)).toBe(false);
  });

  it.each([
    "",
    key,
    `${key}.not-a-mac`,
    `${key}.${"a".repeat(63)}`,
    `not-a-uuid.${"a".repeat(64)}`,
  ])("ignores malformed or unsealed caller headers (%s)", async (untrustedKey) => {
    const incoming = request({ key: untrustedKey });
    expect(publicSecurityRequestContext(incoming)).toBeNull();
    await expect(
      recordPublicSecuritySignal(incoming, { kind: "AUTH_FAILURE", outcome: "DENIED" }),
    ).resolves.toBe("ignored");
    expect(mocks.signal).not.toHaveBeenCalled();
    expect(mocks.address).not.toHaveBeenCalled();
  });

  it("accepts a valid seal and records only the trusted context plus the server signal", async () => {
    const incoming = request();
    const expected = {
      requestKey: incoming.headers.get("x-crewqual-request-key"),
      routeClass,
      pathname,
      address: "203.0.113.20",
    };
    expect(publicSecurityRequestContext(incoming)).toEqual(expected);
    await expect(
      recordPublicSecuritySignal(incoming, {
        kind: "AUTH_FAILURE",
        outcome: "INVALID_CREDENTIALS",
        accountIdentifier: "member:synthetic-account",
      }),
    ).resolves.toBe("recorded");
    expect(mocks.signal).toHaveBeenCalledWith({
      ...expected,
      kind: "AUTH_FAILURE",
      outcome: "INVALID_CREDENTIALS",
      accountIdentifier: "member:synthetic-account",
    });
  });

  it("rejects a valid MAC when the declared class does not match the application route", () => {
    const keyForAdminPage = sealPublicRequestKey(key, "PAGE_ADMIN", "GET", pathname);
    expect(
      publicSecurityRequestContext(request({ key: keyForAdminPage, routeClass: "PAGE_ADMIN" })),
    ).toBeNull();
  });

  it("rejects a sealed context replayed on a different route in the same class", () => {
    const incoming = request({ pathname: "/api/member/qualifications/another-record" });
    expect(publicSecurityRequestContext(incoming)).toBeNull();
  });

  it("rejects a GET context replayed with another HTTP method", () => {
    expect(publicSecurityRequestContext(request({ method: "POST" }))).toBeNull();
  });
});
