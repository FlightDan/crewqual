"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plane } from "lucide-react";
import type { AdminLoginMode } from "@/types/admin-settings";

export function AdminLoginForm({ mode, mockMode }: { mode: AdminLoginMode; mockMode: boolean }) {
  const router = useRouter();
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");

  React.useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "session-expired") setNotice("管理员会话已过期，请重新登录。");
    if (reason === "logged-out") setNotice("已安全退出管理员会话。");
    if (reason === "security-policy-changed") setNotice("安全登录策略已更新，请按新方式重新登录。");
  }, []);

  const needsPassword = mode !== "TOTP_ONLY";
  const needsTotp = mode !== "PASSWORD_ONLY";
  const description =
    mode === "TOTP_ONLY"
      ? "请输入邮箱和 6 位动态验证码"
      : mode === "PASSWORD_ONLY"
        ? "请输入邮箱和密码"
        : "请输入邮箱、密码和 6 位 TOTP 动态验证码";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          ...(needsPassword ? { password: form.get("password") } : {}),
          ...(needsTotp ? { totpCode: form.get("totpCode") } : {}),
        }),
      });
      if (response.ok) {
        const requested = new URLSearchParams(window.location.search).get("next") ?? "";
        const next =
          requested.startsWith("/admin/") && requested !== "/admin/login"
            ? requested
            : "/admin/dashboard";
        router.replace(next);
        router.refresh();
        return;
      }
      setError(
        response.status === 429
          ? "登录尝试过于频繁，请 15 分钟后重试"
          : "账号、密码或动态验证码错误",
      );
    } catch {
      setError("暂时无法连接安全验证服务，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-[430px] rounded-xl border border-border bg-card p-6 shadow-card sm:p-8">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-lg bg-brand text-white">
            <Plane aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-lg font-bold text-primary">CrewQual</p>
            <p className="text-xs text-muted">机组资质合规系统</p>
          </div>
        </div>
        <h1 className="mt-6 text-xl font-bold text-primary">管理员安全登录</h1>
        <p className="mt-1 text-sm text-secondary">{description}</p>
        {mode === "TOTP_ONLY" ? (
          <Alert tone="warning" className="mt-4">
            当前为仅动态验证码模式；动态验证码是唯一登录凭据，请妥善保管验证器和恢复密钥。
          </Alert>
        ) : null}
        {mockMode ? (
          <Alert tone="info" className="mt-4">
            当前为本地演示模式，不会连接真实管理员认证接口。
          </Alert>
        ) : null}
        {notice ? (
          <Alert tone="info" className="mt-4">
            {notice}
          </Alert>
        ) : null}
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <Input
            label="电子邮箱地址"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            required
          />
          {needsPassword ? (
            <Input
              label="密码"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          ) : null}
          {needsTotp ? (
            <Input
              label="动态安全验证码（6 位 TOTP）"
              name="totpCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button className="w-full" size="lg" loading={busy} type="submit">
            安全登录
          </Button>
        </form>
        <ul className="mt-5 space-y-1 text-xs leading-5 text-muted">
          <li>管理员会话绝对有效期为 8 小时。</li>
          <li>连续 5 次登录失败后，账号锁定 15 分钟。</li>
        </ul>
      </div>
      <p className="mt-6 text-center text-xs text-muted">CrewQual 管理员安全入口</p>
    </main>
  );
}
