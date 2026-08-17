import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AdminShell } from "@/components/layout/admin-shell";
import { PilotShell } from "@/components/layout/pilot-shell";

describe("responsive shells", () => {
  it("renders both Admin navigation modes on one route for CSS breakpoint switching", () => {
    render(
      <AdminShell>
        <p>preview</p>
      </AdminShell>,
    );
    expect(screen.getByTestId("desktop-sidebar")).toHaveClass("lg:flex");
    expect(screen.getByTestId("mobile-header")).toHaveClass("lg:hidden");
    expect(screen.getByTestId("mobile-bottom-nav")).toHaveClass("lg:hidden");
  });

  it("opens and closes the mobile drawer with keyboard-friendly controls", async () => {
    const user = userEvent.setup();
    render(
      <AdminShell>
        <p>preview</p>
      </AdminShell>,
    );
    await user.click(screen.getByRole("button", { name: "打开菜单" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("constrains Pilot content to the Figma mobile reading width", () => {
    render(
      <PilotShell>
        <p>pilot</p>
      </PilotShell>,
    );
    const shell = screen.getByTestId("pilot-shell").firstElementChild;
    expect(shell).toHaveClass("max-w-[430px]");
  });
});
