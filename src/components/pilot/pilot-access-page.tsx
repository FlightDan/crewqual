"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CircleAlert, Loader2, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";

export function PilotAccessPage({ portal = "pilot" }: { portal?: "pilot" | "member" }) {
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const router = useRouter();
  const { t } = useI18n();
  const params = useParams<{ token: string }>();
  const [state, setState] = React.useState<{
    kind: "verifying" | "expired" | "used" | "invalid" | "network";
    message: string;
  }>({ kind: "verifying", message: t("pilotAccess.verifyingMessage") });
  React.useEffect(() => {
    const token = params.token;
    window.history.replaceState(null, "", `${portalPath}/identity?status=verifying`);
    void fetch("/api/member/session", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: { code?: string; message?: string };
          };
          if (body.error?.code === "ACCESS_TOKEN_USED") {
            const current = await fetch("/api/member/session", {
              credentials: "include",
              cache: "no-store",
            });
            if (current.ok) {
              const currentPayload = (await current.json().catch(() => ({}))) as {
                data?: { authState?: string };
              };
              router.replace(
                currentPayload.data?.authState === "PENDING_ENROLLMENT"
                  ? `${portalPath}/security`
                  : `${portalPath}/qualifications`,
              );
              return;
            }
          }
          const kind =
            body.error?.code === "ACCESS_TOKEN_EXPIRED"
              ? "expired"
              : body.error?.code === "ACCESS_TOKEN_USED"
                ? "used"
                : "invalid";
          setState({
            kind,
            message:
              kind === "expired"
                ? t("pilotAccess.expiredMessage")
                : kind === "used"
                  ? t("pilotAccess.usedMessage")
                  : t("pilotAccess.invalidMessage"),
          });
          return;
        }
        const payload = (await response.json().catch(() => ({}))) as {
          data?: { authState?: string };
          error?: { code?: string; message?: string };
        };
        router.replace(
          payload.data?.authState === "PENDING_ENROLLMENT"
            ? `${portalPath}/security`
            : `${portalPath}/qualifications`,
        );
      })
      .catch(() => setState({ kind: "network", message: t("pilotAccess.networkMessage") }));
  }, [params.token, portalPath, router, t]);
  const verifying = state.kind === "verifying";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] items-center justify-center bg-surface px-6 text-center">
      <div className="w-full rounded-xl border border-border bg-card p-7 shadow-card">
        <span className="mx-auto inline-flex size-14 items-center justify-center rounded-full bg-blue-50 text-brand">
          {verifying ? (
            <Loader2 aria-hidden="true" className="size-7 animate-spin" />
          ) : state.kind === "network" ? (
            <CircleAlert aria-hidden="true" className="size-7 text-danger" />
          ) : (
            <ShieldCheck aria-hidden="true" className="size-7" />
          )}
        </span>
        <h1 className="mt-5 text-xl font-bold">
          {verifying
            ? t("pilotAccess.verifying")
            : state.kind === "expired"
              ? t("pilotAccess.expired")
              : state.kind === "used"
                ? t("pilotAccess.used")
                : state.kind === "network"
                  ? t("pilotAccess.network")
                  : t("pilotAccess.invalid")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-secondary">{state.message}</p>
        <p className="mt-4 text-xs text-muted">{t("pilotAccess.rule")}</p>
        {!verifying ? (
          <Link
            href={`${portalPath}/identity`}
            className={buttonVariants({ className: "mt-6 w-full" })}
          >
            {t("pilotAccess.requestAgain")}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
