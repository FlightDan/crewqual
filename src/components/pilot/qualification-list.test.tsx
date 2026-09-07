import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QualificationCard } from "@/components/pilot/qualification-list";
import { deriveQualification } from "@/lib/qualification-date-status";
import { createInitialAdminState } from "@/mocks/admin-fixtures";

afterEach(cleanup);
const fixture = createInitialAdminState().pilots[0]!.qualifications[0]!;
describe("qualification action states", () => {
  it("offers submission for a missing qualification", () => {
    const qualification = deriveQualification({ ...fixture, recordExists: false });
    render(<QualificationCard qualification={qualification} portalPath="/member" />);
    expect(screen.getByRole("link", { name: "提交资质材料" })).toHaveAttribute(
      "href",
      `/member/qualifications/${fixture.id}/update`,
    );
  });
  it("shows a review instruction instead of an upload action for incomplete data", () => {
    const qualification = deriveQualification({
      ...fixture,
      expiresOn: "",
      validityRule: { kind: "manual_expiry" },
    });
    render(<QualificationCard qualification={qualification} />);
    expect(screen.getAllByText("请联系管理员核查").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("explains an unavailable submission route", () => {
    const qualification = deriveQualification({
      ...fixture,
      recordExists: false,
      submissionSupported: false,
    });
    render(<QualificationCard qualification={qualification} />);
    expect(screen.getByText("请联系管理员配置该资质的提交入口")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
