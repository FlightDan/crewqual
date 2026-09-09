"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type SessionData = {
  id: string;
  employeeNumber: string;
  displayName: string;
  authState?: string;
  memberLoginMode?: "PASSWORD_TOTP" | "PASSWORD_FIDO2" | "SMS_LINK";
  memberFido2Required?: boolean;
};

function csrfToken() {
  const value = document.cookie
    .split("; ")
    .find((item) => item.startsWith("crewqual_member_session_csrf="))
    ?.slice("crewqual_member_session_csrf=".length);
  return value ? decodeURIComponent(value) : "";
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "请求失败");
  return payload.data;
}

export function PilotSecurityEnrollment({ portal = "pilot" }: { portal?: "pilot" | "member" }) {
  const router = useRouter();
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const [session, setSession] = React.useState<SessionData | null>(null);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [totpSecret, setTotpSecret] = React.useState("");
  const [totpCode, setTotpCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const refresh = React.useCallback(async () => {
    const response = await fetch("/api/member/session", {
      credentials: "include",
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as { data?: SessionData };
    if (!response.ok || !body.data) throw new Error("登录状态已失效，请重新获取访问链接");
    setSession(body.data);
    if (body.data.authState === "AUTHENTICATED") router.replace(`${portalPath}/qualifications`);
    return body.data;
  }, [portalPath, router]);

  React.useEffect(() => {
    void refresh().catch((reason) =>
      setError(reason instanceof Error ? reason.message : "登录状态读取失败"),
    );
  }, [refresh]);

  const savePassword = async () => {
    setBusy(true);
    setError("");
    try {
      if (password.length < 12) throw new Error("密码至少需要 12 个字符");
      if (password !== confirm) throw new Error("两次输入的密码不一致");
      const result = await request<{ authenticated: boolean }>("/api/member/security/password", {
        newPassword: password,
      });
      setPassword("");
      setConfirm("");
      setNotice(result.authenticated ? "安全设置完成" : "密码已保存，请继续绑定其他因素");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "密码设置失败");
    } finally {
      setBusy(false);
    }
  };

  const provisionTotp = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ secret: string; uri: string }>(
        "/api/member/security/totp",
        {},
      );
      setTotpSecret(result.secret);
      setNotice(`请在验证器中添加账户，密钥：${result.secret}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法生成动态密码密钥");
    } finally {
      setBusy(false);
    }
  };

  const verifyTotp = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ authenticated: boolean }>("/api/member/security/totp", {
        secret: totpSecret,
        code: totpCode,
      });
      setTotpCode("");
      setNotice(result.authenticated ? "安全设置完成" : "动态密码已绑定，请继续完成其他因素");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "动态密码验证失败");
    } finally {
      setBusy(false);
    }
  };

  const bindFido = async () => {
    setBusy(true);
    setError("");
    try {
      const options = await request<{ challengeId: string; [key: string]: unknown }>(
        "/api/member/security/fido",
        { action: "options" },
      );
      const { startRegistration } = await import("@simplewebauthn/browser");
      const response = await startRegistration({ optionsJSON: options as never });
      const result = await request<{ authenticated: boolean }>("/api/member/security/fido", {
        action: "verify",
        challengeId: options.challengeId,
        response,
        label: "成员硬件验证器",
      });
      setNotice(result.authenticated ? "安全设置完成" : "硬件验证器已绑定，请继续完成其他因素");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "FIDO2 绑定失败");
    } finally {
      setBusy(false);
    }
  };

  const needsTotp = session?.memberLoginMode === "PASSWORD_TOTP";
  const needsFido = Boolean(
    session?.memberFido2Required || session?.memberLoginMode === "PASSWORD_FIDO2",
  );
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-8">
      <Card className="w-full max-w-lg space-y-6 p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-md bg-blue-50 text-brand">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-primary">完成安全登录设置</h1>
            <p className="mt-1 text-sm leading-6 text-secondary">
              {session?.displayName ?? "成员"}（{session?.employeeNumber ?? ""}
              ）需要完成账号安全因素绑定后才能查看资质。
            </p>
          </div>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Alert tone="info">{notice}</Alert> : null}
        <section className="space-y-3">
          <h2 className="font-semibold text-primary">1. 设置登录密码</h2>
          <Input
            label="新密码"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Input
            label="确认密码"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <Button type="button" loading={busy} onClick={() => void savePassword()}>
            保存密码
          </Button>
        </section>
        {needsTotp ? (
          <section className="space-y-3 border-t border-border pt-5">
            <h2 className="font-semibold text-primary">2. 绑定动态密码</h2>
            {!totpSecret ? (
              <Button
                type="button"
                variant="secondary"
                loading={busy}
                onClick={() => void provisionTotp()}
              >
                生成验证器密钥
              </Button>
            ) : (
              <>
                <code className="block break-all rounded-md bg-slate-100 p-3 text-sm">
                  {totpSecret}
                </code>
                <Input
                  label="动态验证码"
                  inputMode="numeric"
                  maxLength={6}
                  value={totpCode}
                  onChange={(event) =>
                    setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
                <Button type="button" loading={busy} onClick={() => void verifyTotp()}>
                  验证并绑定
                </Button>
              </>
            )}
          </section>
        ) : null}
        {needsFido ? (
          <section className="space-y-3 border-t border-border pt-5">
            <h2 className="flex items-center gap-2 font-semibold text-primary">
              <KeyRound aria-hidden="true" className="size-4" />
              绑定 FIDO2 硬件验证器
            </h2>
            <p className="text-xs leading-5 text-secondary">
              需要支持用户验证的安全钥匙，并在 HTTPS 安全上下文中操作。
            </p>
            <Button
              type="button"
              variant="secondary"
              loading={busy}
              onClick={() => void bindFido()}
            >
              绑定硬件验证器
            </Button>
          </section>
        ) : null}
      </Card>
    </main>
  );
}
