import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberDetailView } from "@/components/admin/member-detail-view";

const member = {
  id: "00000000-0000-4000-8000-000000000001",
  employeeNumber: "CQ-001",
  displayName: "测试成员",
  initials: "测",
  mobile: "13800000000",
  active: true,
  primaryPosition: { code: "PILOT", name: "飞行员" },
  positions: [],
  pilotProfile: null,
  timezone: "Asia/Shanghai",
  qualifications: [
    {
      code: "MEDICAL",
      name: "体检合格证",
      translations: { "zh-CN": "体检合格证" },
      positionCode: "PILOT",
      positionName: "PILOT",
      source: "POSITION_REQUIREMENT",
      status: "valid" as const,
      statusLabel: "有效",
      remainingLabel: "长期有效",
      required: true,
      record: null,
    },
  ],
};

vi.mock("@/lib/service-mode", () => ({ isRemoteServiceMode: () => true }));
const adminState = { pilots: [], qualificationConfigs: [] };
vi.mock("@/services/admin-state-provider", () => ({
  useAdminState: () => adminState,
}));

describe("MemberDetailView business labels", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: member }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  it("hides position and assignment implementation values from the member view", async () => {
    render(<MemberDetailView memberId={member.id} />);

    expect(await screen.findByText(/来源 职位资质要求/)).toBeVisible();
    expect(screen.queryByText("POSITION_REQUIREMENT")).not.toBeInTheDocument();
    expect(screen.queryByText("PILOT", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/职位 requirement/i)).not.toBeInTheDocument();
  });
});
