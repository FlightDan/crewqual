import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AdminSettingsView } from "@/components/admin/admin-settings-view";
import {
  adminSettingsStorageKey,
  defaultAdminSettingsSnapshot,
} from "@/services/admin-settings-service";
import { mockStorageKey } from "@/services/temp-storage";

const storageKey = mockStorageKey(adminSettingsStorageKey);

describe("AdminSettingsView", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.sessionStorage.setItem(storageKey, JSON.stringify(defaultAdminSettingsSnapshot));
    window.history.replaceState(null, "", "/admin/settings");
  });

  it("provides real second-level sections for administrator accounts and AI", async () => {
    const user = userEvent.setup();
    render(<AdminSettingsView />);

    expect(await screen.findByRole("heading", { name: "组织与单位" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /管理员与权限/ }));
    expect(screen.getByRole("heading", { name: "管理员与权限" })).toBeVisible();
    expect(screen.getAllByText("admin@crewqual.local")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /AI 与系统集成/ }));
    expect(screen.getByRole("heading", { name: "AI 与系统集成" })).toBeVisible();
    expect(screen.getByLabelText(/模型名称/)).toHaveValue("Qwen3.7-35B");
    expect(window.location.search).toBe("?section=ai");
  });

  it("creates an administrator and confirms the result with a success toast", async () => {
    const user = userEvent.setup();
    render(<AdminSettingsView />);
    await screen.findByRole("heading", { name: "组织与单位" });
    await user.click(screen.getByRole("button", { name: /管理员与权限/ }));
    await user.click(screen.getByRole("button", { name: "新增管理员" }));

    const dialog = screen.getByRole("dialog", { name: "新增管理员" });
    await user.type(within(dialog).getByLabelText("姓名 *"), "测试管理员");
    await user.type(within(dialog).getByLabelText("邮箱 *"), "settings-admin@example.com");
    await user.type(within(dialog).getByLabelText("临时密码 *"), "safe-password-2026");
    await user.click(within(dialog).getByRole("button", { name: "创建管理员" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("管理员账号已创建"));
    expect(screen.getAllByText("settings-admin@example.com")).not.toHaveLength(0);
  });

  it("never stores a newly entered AI secret in plaintext", async () => {
    const user = userEvent.setup();
    render(<AdminSettingsView />);
    await screen.findByRole("heading", { name: "组织与单位" });
    await user.click(screen.getByRole("button", { name: /AI 与系统集成/ }));
    await user.type(screen.getByLabelText("API Key"), "plain-text-secret-must-not-persist");
    await user.click(screen.getByRole("button", { name: "保存 AI/OCR 配置" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("AI/OCR 配置已保存"));
    expect(window.sessionStorage.getItem(storageKey)).not.toContain(
      "plain-text-secret-must-not-persist",
    );
  });
});
