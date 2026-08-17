import { afterEach, describe, expect, it } from "vitest";
import { requestAddress } from "@/server/rate-limit";
import { resetServerConfigForTests } from "@/server/config";

const original = process.env.TRUSTED_PROXY_HOPS;

afterEach(() => {
  if (original === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = original;
  resetServerConfigForTests();
});

describe("trusted client address resolution", () => {
  it("ignores forged forwarding headers when no proxy is trusted", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    resetServerConfigForTests();
    const request = new Request("http://crewqual.test", {
      headers: { "x-forwarded-for": "198.51.100.10", "x-real-ip": "198.51.100.11" },
    });
    expect(requestAddress(request)).toBe("direct-client");
  });

  it("selects the address before the configured trusted proxy hops", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    resetServerConfigForTests();
    const request = new Request("http://crewqual.test", {
      headers: { "x-forwarded-for": "198.51.100.10, 10.0.0.4" },
    });
    expect(requestAddress(request)).toBe("198.51.100.10");
  });
});
