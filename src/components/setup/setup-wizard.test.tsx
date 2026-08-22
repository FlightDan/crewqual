import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SetupWizard } from "@/components/setup/setup-wizard";
import { mockSetupOverview } from "@/server/setup";

describe("SetupWizard", () => {
  it("keeps the super administrator mandatory while allowing optional steps to be skipped", async () => {
    const user = userEvent.setup();
    render(<SetupWizard initialOverview={mockSetupOverview()} />);

    await user.click(screen.getByRole("button", { name: "开始配置" }));
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(await screen.findByRole("heading", { name: "创建超级管理员" })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^管理员姓名/), "张管理员");
    await user.type(screen.getByLabelText(/^登录邮箱/), "admin@example.com");
    await user.type(screen.getByLabelText(/^设置密码/), "A-strong-password-123");
    await user.type(screen.getByLabelText(/^确认密码/), "A-strong-password-123");
    await user.click(screen.getByRole("switch", { name: /强制要求所有管理员开启双重验证/ }));
    await user.click(screen.getByRole("button", { name: "保存并继续" }));

    expect(screen.getByRole("heading", { name: "选择职位模板" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "稍后配置" }));
    expect(screen.getByRole("heading", { name: "保护你的数据" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "稍后配置" }));
    expect(screen.getByRole("heading", { name: "设置通知渠道" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "稍后配置" }));

    expect(screen.getByRole("heading", { name: "确认初始化配置" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /完成初始化/ }));
    expect(await screen.findByRole("heading", { name: "CrewQual 已准备就绪" })).toBeInTheDocument();
  });

  it("switches the setup copy to English without changing the flow", async () => {
    const user = userEvent.setup();
    render(<SetupWizard initialOverview={mockSetupOverview()} />);
    await user.selectOptions(screen.getByLabelText("默认系统语言"), "en-US");
    expect(screen.getByRole("heading", { name: "Welcome to CrewQual" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start setup" })).toBeInTheDocument();
  });
});
