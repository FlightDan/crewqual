import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PilotManagementActions } from "@/components/admin/pilot-management-dialogs";

describe("pilot import dialog focus", () => {
  it("returns focus to the batch-import trigger after closing", async () => {
    const user = userEvent.setup();
    render(<PilotManagementActions onCompleted={() => undefined} />);

    const trigger = screen.getByRole("button", { name: "批量导入" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "CSV 批量导入飞行员" })).toBeVisible();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });
});
