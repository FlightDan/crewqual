import { describe, expect, it } from "vitest";
import { verifyTotp } from "@/server/crypto";

describe("TOTP verification", () => {
  const secret = "JBSWY3DPEHPK3PXP";

  it("returns the accepted counter for the current or adjacent time step", () => {
    expect(verifyTotp(secret, "282760", 0)).toBe(0);
    expect(verifyTotp(secret, "996554", 30_000)).toBe(1);
    expect(verifyTotp(secret, "282760", 30_000)).toBe(0);
  });

  it("rejects malformed or incorrect codes", () => {
    expect(verifyTotp(secret, "", 0)).toBeNull();
    expect(verifyTotp(secret, "12345", 0)).toBeNull();
    expect(verifyTotp(secret, "000000", 0)).toBeNull();
  });
});
