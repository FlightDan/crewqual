import { describe, expect, it } from "vitest";
import { createInitialAdminState } from "@/mocks/admin-fixtures";
import { projectMockMemberQualifications } from "@/services/member-status";

const clock = { now: () => new Date("2026-08-14T15:59:59Z") };

describe("mock member qualification projection", () => {
  it("keeps today valid and exposes a required missing record", () => {
    const state = createInitialAdminState();
    const pilot = state.pilots[0]!;
    const configs = state.qualificationConfigs.slice(0, 2);
    pilot.qualifications = [{ ...pilot.qualifications[0]!, expiryDate: "2026-08-14" }];
    const result = projectMockMemberQualifications(pilot, configs, clock);
    expect(result.qualifications.map((item) => item.status)).toEqual(["due", "missing"]);
    expect(result.qualifications[0]?.statusLabel).toBe("今日到期");
    expect(result.health).toBe("missing");
  });

  it("does not infer a long-term record from a blank expiry or hide optional issues", () => {
    const state = createInitialAdminState();
    const pilot = state.pilots[0]!;
    pilot.qualifications[0]!.expiryDate = "";
    const config = {
      ...state.qualificationConfigs[0]!,
      core: false,
      validityRule: { kind: "manual_expiry" as const },
    };
    const result = projectMockMemberQualifications(pilot, [config], clock);
    expect(result.health).toBe("valid");
    expect(result.qualificationCounts.incomplete).toBe(1);
    expect(result.requiredQualificationCounts.incomplete).toBe(0);
    expect(result.qualifications[0]?.record).not.toBeNull();
    expect(projectMockMemberQualifications(pilot, [], clock).health).toBe("unconfigured");
  });

  it("merges required sources and recognizes explicit non-expiring records", () => {
    const state = createInitialAdminState();
    const pilot = state.pilots[0]!;
    pilot.qualifications[0]!.expiryDate = "";
    pilot.qualifications[0]!.validityRule = { kind: "non_expiring" };
    const config = {
      ...state.qualificationConfigs[0]!,
      validityRule: { kind: "non_expiring" as const },
    };
    const result = projectMockMemberQualifications(
      pilot,
      [
        { ...config, core: false },
        { ...config, core: true },
      ],
      clock,
    );
    expect(result.qualifications).toHaveLength(1);
    expect(result.qualifications[0]).toMatchObject({
      required: true,
      status: "valid",
      remainingLabel: "长期有效",
    });
    expect(result.qualifications[0]?.sources).toHaveLength(2);
  });
});
