import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("links an error message through aria-describedby", () => {
    render(<Input id="qualification" label="资质名称" error="请输入资质名称" />);
    const input = screen.getByRole("textbox", { name: "资质名称" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain("qualification-error");
    expect(screen.getByText("请输入资质名称")).toBeInTheDocument();
  });
});
