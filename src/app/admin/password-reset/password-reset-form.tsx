"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function PasswordResetForm() {
  const params = useSearchParams();
  const [token, setToken] = React.useState(params.get("token") ?? "");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [currentTotpCode, setCurrentTotpCode] = React.useState("");
  const [state, setState] = React.useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    if (token) return;
    void fetch("/api/admin/password-reset", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          data?: { token?: string };
          error?: { message?: string };
        };
        if (!response.ok || !body.data?.token) {
          setMessage(body.error?.message ?? "请在目标管理员已登录的浏览器中打开此页面");
          setState("error");
          return;
        }
        setToken(body.data.token);
      })
      .catch(() => {
        setMessage("无法读取待完成的密码恢复，请重试");
        setState("error");
      });
  }, [token]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 12 || password !== confirm) {
      setState("error");
      setMessage(password.length < 12 ? "密码至少需要 12 个字符" : "两次输入的密码不一致");
      return;
    }
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/admin/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword: password,
          ...(currentTotpCode ? { currentTotpCode } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "重置链接无效或已过期");
      setState("done");
      setPassword("");
      setConfirm("");
      setCurrentTotpCode("");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "密码重置失败");
    }
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-8">
      <Card className="w-full max-w-md space-y-6 p-6 sm:p-8">
        <div>
          <p className="text-sm font-semibold text-brand">CrewQual</p>
          <h1 className="mt-2 text-2xl font-bold text-primary">设置新的管理员密码</h1>
          <p className="mt-2 text-sm leading-6 text-secondary">
            此链接只能使用一次，并在 30 分钟后失效。请由账号本人完成设置。
          </p>
        </div>
        {state === "done" ? (
          <div className="space-y-4">
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-success">
              密码已设置，请返回管理员登录页。
            </p>
            <a className="inline-flex font-semibold text-brand underline" href="/admin/login">
              返回登录
            </a>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <Input
              label="新密码"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Input
              label="确认密码"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
            <Input
              label="当前动态验证码（如账号已启用）"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={currentTotpCode}
              onChange={(event) => setCurrentTotpCode(event.target.value)}
            />
            {message ? (
              <p role="alert" className="text-sm text-danger">
                {message}
              </p>
            ) : null}
            <Button className="w-full" type="submit" loading={state === "saving"} disabled={!token}>
              设置密码
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
