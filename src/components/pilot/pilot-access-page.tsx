"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CircleAlert, Loader2, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export function PilotAccessPage({ portal = "pilot" }: { portal?: "pilot" | "member" }) {
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const [state, setState] = React.useState<{
    kind: "verifying" | "expired" | "used" | "invalid" | "network";
    message: string;
  }>({ kind: "verifying", message: "系统正在校验您的一次性登录凭证，请稍候。" });
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
              router.replace(`${portalPath}/qualifications`);
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
                ? "此一次性登录链接已超过 15 分钟有效期。"
                : kind === "used"
                  ? "此一次性登录链接已被成功兑换，无法重复使用。"
                  : "无法识别此登录链接，链接可能无效或已被篡改。",
          });
          return;
        }
        router.replace(`${portalPath}/qualifications`);
      })
      .catch(() =>
        setState({ kind: "network", message: "无法连接安全验证服务，请检查网络后重试。" }),
      );
  }, [params.token, portalPath, router]);
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
            ? "正在验证安全链接…"
            : state.kind === "expired"
              ? "链接已过期"
              : state.kind === "used"
                ? "链接已使用"
                : state.kind === "network"
                  ? "网络连接异常"
                  : "链接无效"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-secondary">{state.message}</p>
        <p className="mt-4 text-xs text-muted">
          链接有效期 15 分钟，仅可成功兑换一次；兑换后的访问会话有效 60 分钟。
        </p>
        {!verifying ? (
          <Link
            href={`${portalPath}/identity`}
            className={buttonVariants({ className: "mt-6 w-full" })}
          >
            重新申请访问链接
          </Link>
        ) : null}
      </div>
    </main>
  );
}
