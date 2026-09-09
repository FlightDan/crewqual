import { describe, expect, it } from "vitest";
import { adminSecuritySummaryInterval } from "@/server/auth";

describe("admin security summary interval", () => {
  const loginAt = new Date("2026-09-08T12:34:56.789Z");

  it("uses the previous successful login and fixed UTC minute bounds", () => {
    expect(adminSecuritySummaryInterval(new Date("2026-09-08T08:15:45Z"), loginAt)).toEqual({
      since: new Date("2026-09-08T08:15:00Z"),
      until: new Date("2026-09-08T12:34:00Z"),
    });
  });

  it("uses 24 hours for a first login", () => {
    expect(adminSecuritySummaryInterval(null, loginAt)).toEqual({
      since: new Date("2026-09-07T12:34:00Z"),
      until: new Date("2026-09-08T12:34:00Z"),
    });
  });

  it("caps history at 30 days", () => {
    expect(adminSecuritySummaryInterval(new Date("2020-01-01T00:00:00Z"), loginAt)).toEqual({
      since: new Date("2026-08-09T12:34:00Z"),
      until: new Date("2026-09-08T12:34:00Z"),
    });
  });

  it("makes another login in the same minute an empty half-open interval", () => {
    expect(adminSecuritySummaryInterval(new Date("2026-09-08T12:34:12Z"), loginAt)).toEqual({
      since: new Date("2026-09-08T12:34:00Z"),
      until: new Date("2026-09-08T12:34:00Z"),
    });
  });

  it("clamps a future prior timestamp instead of producing an inverted interval", () => {
    expect(adminSecuritySummaryInterval(new Date("2026-09-09T00:00:00Z"), loginAt)).toEqual({
      since: new Date("2026-09-08T12:34:00Z"),
      until: new Date("2026-09-08T12:34:00Z"),
    });
  });
});
