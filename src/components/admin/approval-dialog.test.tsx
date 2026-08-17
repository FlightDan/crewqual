import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApprovalDialog } from "@/components/admin/review-dialogs";
import { createInitialAdminState } from "@/mocks/admin-fixtures";
import { adminStateStore } from "@/services/admin-state-store";

describe("ApprovalDialog", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    adminStateStore.reset();
  });

  it("requires explicit human confirmation even when AI matched", async () => {
    const user = userEvent.setup();
    const review = createInitialAdminState().reviews.find((item) => item.id === "REV-1001")!;
    render(<ApprovalDialog review={review} open onOpenChange={() => undefined} />);
    const approve = screen.getByRole("button", { name: "确认通过" });
    expect(approve).toBeDisabled();
    await user.click(screen.getByLabelText("已核对凭证与提交信息"));
    expect(approve).toBeEnabled();
  });
});
