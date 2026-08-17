import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("disables native interaction when disabled", () => {
    render(<Button disabled>不可用</Button>);
    expect(screen.getByRole("button", { name: "不可用" })).toBeDisabled();
  });

  it("shows loading state and exposes busy semantics", () => {
    render(<Button loading>保存中</Button>);
    const button = screen.getByRole("button", { name: "保存中" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
