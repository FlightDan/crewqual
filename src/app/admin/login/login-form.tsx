"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plane } from "lucide-react";
import type { AdminLoginMode } from "@/types/admin-settings";
import { LocaleSwitcher, useI18n } from "@/components/i18n-provider";

export function AdminLoginForm({ mode, mockMode }: { mode: AdminLoginMode; mockMode: boolean }) {
  const router = useRouter();
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const { t } = useI18n();

  React.useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "session-expired") setNotice(t("auth.expired"));
    if (reason === "logged-out") setNotice(t("auth.loggedOut"));
    if (reason === "security-policy-changed") setNotice(t("auth.policyChanged"));
  }, [t]);

  const needsPassword = mode !== "TOTP_ONLY";
  const needsTotp = mode !== "PASSWORD_ONLY";
  const description =
    mode === "TOTP_ONLY"
      ? t("auth.description.totp")
      : mode === "PASSWORD_ONLY"
        ? t("auth.description.password")
        : t("auth.description.both");

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
      setError(response.status === 429 ? t("auth.rateLimited") : t("auth.invalid"));
    } catch {
      setError(t("auth.unavailable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-[430px] rounded-xl border border-border bg-card p-6 shadow-card sm:p-8">
        <div className="mb-3 flex justify-end">
          <LocaleSwitcher />
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-lg bg-brand text-white">
            <Plane aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-lg font-bold text-primary">CrewQual</p>
            <p className="text-xs text-muted">{t("navigation.system")}</p>
          </div>
        </div>
        <h1 className="mt-6 text-xl font-bold text-primary">{t("auth.adminLogin")}</h1>
        <p className="mt-1 text-sm text-secondary">{description}</p>
        {mode === "TOTP_ONLY" ? (
          <Alert tone="warning" className="mt-4">
            {t("auth.totpOnlyNotice")}
          </Alert>
        ) : null}
        {mockMode ? (
          <Alert tone="info" className="mt-4">
            {t("auth.mockNotice")}
          </Alert>
        ) : null}
        {notice ? (
          <Alert tone="info" className="mt-4">
            {notice}
          </Alert>
        ) : null}
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <Input
            label={t("auth.email")}
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            required
          />
          {needsPassword ? (
            <Input
              label={t("auth.password")}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          ) : null}
          {needsTotp ? (
            <Input
              label={t("auth.totp")}
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
            {t("auth.login")}
          </Button>
        </form>
        <ul className="mt-5 space-y-1 text-xs leading-5 text-muted">
          <li>{t("auth.sessionRule")}</li>
          <li>{t("auth.lockoutRule")}</li>
        </ul>
      </div>
      <p className="mt-6 text-center text-xs text-muted">{t("auth.footer")}</p>
    </main>
  );
}
