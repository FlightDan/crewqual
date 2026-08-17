import { describe, expect, it } from "vitest";
import { reviewCredentialFieldsSchema } from "@/lib/admin-review-validation";

const valid = {
  credentialNumber: "CQ-TEST-01",
  issueDate: "2026-08-01",
  expiryDate: "2027-08-01",
  issuingAuthority: "虚构签发机构",
  levelOrParameter: "A级",
};

describe("review credential API validation", () => {
  it("requires the complete final field set", () => {
    expect(reviewCredentialFieldsSchema.safeParse(valid).success).toBe(true);
    expect(
      reviewCredentialFieldsSchema.safeParse({ ...valid, expiryDate: "2026-07-31" }).success,
    ).toBe(false);
    expect(reviewCredentialFieldsSchema.safeParse({ ...valid, issuingAuthority: "" }).success).toBe(
      false,
    );
  });

  it("supports an explicit empty expiry only for non-expiring configuration paths", () => {
    expect(reviewCredentialFieldsSchema.safeParse({ ...valid, expiryDate: "" }).success).toBe(true);
  });
});
