"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LockKeyhole, Plane, Smartphone, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { identitySchema } from "@/lib/pilot-validation";
import { useApplicationServices } from "@/services/application-services-provider";
import type { AccessLinkRequest } from "@/types/services";
import { useI18n } from "@/components/i18n-provider";
import type { MemberLoginMode } from "@/types/admin-settings";
import { Alert } from "@/components/ui/alert";

export function PilotIdentityForm({
  portal = "pilot",
  loginMode = "SMS_LINK",
  fidoRequired = false,
}: {
  portal?: "pilot" | "member";
  loginMode?: MemberLoginMode;
  fidoRequired?: boolean;
}) {
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const router = useRouter();
  const { pilotIdentity } = useApplicationServices();
  const [interactive, setInteractive] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [loginError, setLoginError] = React.useState("");
  const { t } = useI18n();
  React.useEffect(() => setInteractive(true), []);
  const passwordLogin = loginMode !== "SMS_LINK";
  const needsFido = fidoRequired || loginMode === "PASSWORD_FIDO2";
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AccessLinkRequest & { password?: string; totpCode?: string }>({
    resolver: zodResolver(
      passwordLogin
        ? identitySchema.omit({ mobile: true }).extend({
            password: z.string().min(1, "请输入密码"),
            ...(loginMode === "PASSWORD_TOTP"
              ? { totpCode: z.string().regex(/^\d{6}$/, "请输入6位动态验证码") }
              : {}),
          })
        : identitySchema,
    ) as never,
    defaultValues: { employeeNumber: "", mobile: "" },
  });

  const submit = handleSubmit(async (values) => {
    setLoginError("");
    if (passwordLogin) {
      try {
        let fido: { challengeId: string; response: unknown } | undefined;
        if (needsFido) {
          const optionsResponse = await fetch("/api/member/login/fido-options", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ employeeNumber: values.employeeNumber }),
          });
          const payload = (await optionsResponse.json().catch(() => ({}))) as {
            data?: { challengeId?: string; [key: string]: unknown };
            error?: { message?: string };
          };
          if (!optionsResponse.ok || !payload.data?.challengeId)
            throw new Error(payload.error?.message ?? "无法开始 FIDO2 验证");
          const { startAuthentication } = await import("@simplewebauthn/browser");
          fido = {
            challengeId: payload.data.challengeId,
            response: await startAuthentication({ optionsJSON: payload.data as never }),
          };
        }
        const response = await fetch("/api/member/login", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            employeeNumber: values.employeeNumber,
            password: values.password,
            ...(values.totpCode ? { totpCode: values.totpCode } : {}),
            ...(fido ? { fidoChallengeId: fido.challengeId, fidoResponse: fido.response } : {}),
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(body.error?.message ?? "登录失败");
        }
        router.push(`${portalPath}/qualifications`);
      } catch (error) {
        setLoginError(error instanceof Error ? error.message : "登录失败");
      }
      return;
    }
    const result = await pilotIdentity.requestAccessLink(values);
    if (result.source === "mock") router.push(`${portalPath}/qualifications`);
    else setSent(true);
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-surface px-6 pb-safe-bottom pt-12 shadow-sm">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-lg bg-brand text-white">
          <Plane aria-hidden="true" className="size-8" />
        </div>
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <p className="text-2xl font-bold text-primary">CrewQual</p>
            <p className="mt-1 text-xs font-semibold text-muted">
              {t("navigation.system")} ·{" "}
              {portal === "member" ? t("portal.member") : t("portal.pilot")}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={submit} className="my-auto space-y-5 py-10" noValidate>
        <div>
          <h1 className="text-xl font-bold text-primary">
            {passwordLogin
              ? portal === "member"
                ? "成员密码登录"
                : "人员密码登录"
              : portal === "member"
                ? t("portal.memberLookup")
                : t("portal.pilotLookup")}
          </h1>
          <p className="mt-1 text-[13px] text-secondary">
            {passwordLogin
              ? needsFido
                ? "请输入密码并完成动态验证码与硬件验证器确认。"
                : "请输入密码和动态验证码完成登录。"
              : t("portal.identityHint")}
          </p>
          {sent && !passwordLogin ? (
            <p className="mt-3 rounded-md bg-emerald-50 p-3 text-xs leading-5 text-success">
              {t("portal.requestAccepted")}
            </p>
          ) : null}
        </div>
        <div className="space-y-4">
          <div className="relative">
            <UserRound
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-[35px] z-10 size-4 text-secondary"
            />
            <Input
              label={t("portal.employeeNumber")}
              required
              disabled={!interactive}
              autoComplete="username"
              placeholder={t("portal.employeePlaceholder")}
              className="pl-9"
              error={errors.employeeNumber?.message}
              {...register("employeeNumber")}
            />
          </div>
          {!passwordLogin ? (
            <div className="relative">
              <Smartphone
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-[35px] z-10 size-4 text-secondary"
              />
              <Input
                label={t("portal.mobile")}
                required
                disabled={!interactive}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={11}
                placeholder={t("portal.mobilePlaceholder")}
                className="pl-9"
                error={errors.mobile?.message}
                {...register("mobile")}
              />
            </div>
          ) : null}
          {passwordLogin ? (
            <>
              <Input
                label="密码"
                type="password"
                autoComplete="current-password"
                required
                {...register("password")}
              />
              {loginMode === "PASSWORD_TOTP" ? (
                <Input
                  label="动态验证码"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  {...register("totpCode")}
                />
              ) : null}
              {needsFido ? (
                <Alert tone="info">提交后将调用已绑定的 FIDO2 硬件验证器，请准备触摸确认。</Alert>
              ) : null}
              {loginError ? <Alert tone="danger">{loginError}</Alert> : null}
            </>
          ) : null}
        </div>
        <div className="space-y-2">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!interactive}
            loading={isSubmitting}
          >
            {passwordLogin ? "登录" : t("portal.requestLink")}
          </Button>
          <p className="text-center text-[11px] leading-5 text-muted">{t("portal.linkRule")}</p>
        </div>
      </form>

      <p className="flex items-center gap-2 pb-6 text-[11px] text-muted">
        <LockKeyhole aria-hidden="true" className="size-3.5" />
        {t("portal.privacy")}
      </p>
    </main>
  );
}
