import * as React from "react";
import Link from "next/link";
import { Bell, ChevronLeft } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PilotProfile } from "@/types/services";
import { LocaleSwitcher, useI18n } from "@/components/i18n-provider";

export const anonymousMockPilotProfile: PilotProfile = {
  id: "anonymous-mock",
  employeeNumber: "未验证",
  displayName: "匿名 Mock 预览",
  initials: "匿",
  role: "开发直达",
  unit: "未绑定中队",
};

export function PilotShell({
  children,
  title,
  showBack = false,
  backHref,
  portal = "pilot",
  variant = "profile",
  profile = anonymousMockPilotProfile,
  className,
}: {
  children: React.ReactNode;
  title?: string;
  showBack?: boolean;
  backHref?: string;
  portal?: "pilot" | "member";
  variant?: "profile" | "page";
  profile?: PilotProfile;
  className?: string;
}) {
  const isPageHeader = variant === "page";
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const resolvedBackHref = backHref ?? `${portalPath}/qualifications`;
  const { t } = useI18n();
  const resolvedTitle = title ?? t("qualifications.title");
  return (
    <div data-testid="pilot-shell" className="min-h-dvh w-full overflow-x-hidden bg-surface">
      <div
        data-testid="pilot-content-frame"
        className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-surface shadow-sm"
      >
        <header
          className={cn(
            "flex min-h-[70px] items-center justify-between px-4",
            isPageHeader ? "border-b border-border bg-card text-primary" : "bg-nav text-white",
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            {showBack ? (
              <Link
                href={resolvedBackHref}
                aria-label={t("common.back")}
                className={cn(
                  "-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                  isPageHeader
                    ? "text-primary hover:bg-slate-100"
                    : "text-white hover:bg-slate-800 hover:text-white",
                )}
              >
                <ChevronLeft aria-hidden="true" className="size-5" />
              </Link>
            ) : (
              <Avatar
                initials={profile.initials}
                className="size-10 bg-brand text-white"
                label={portal === "member" ? t("portal.memberAccount") : t("portal.pilotAccount")}
              />
            )}
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-base font-bold">
                  {showBack || isPageHeader ? resolvedTitle : profile.displayName}
                </p>
                {!showBack && !isPageHeader ? (
                  <span className="rounded-sm bg-brand px-1.5 py-0.5 text-[10px] font-semibold">
                    {profile.role}
                  </span>
                ) : null}
              </div>
              {!showBack && !isPageHeader ? (
                <p className="truncate text-[11px] text-slate-400">
                  {t("portal.employeeInfo", {
                    employeeNumber: profile.employeeNumber,
                    unit: profile.unit,
                  })}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            {!showBack && !isPageHeader ? (
              <Link
                href={`${portalPath}/notifications`}
                aria-label={t("navigation.notifications")}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon" }),
                  "text-white hover:bg-slate-800 hover:text-white",
                )}
              >
                <Bell aria-hidden="true" className="size-5" />
              </Link>
            ) : null}
          </div>
        </header>
        <main className={cn("flex-1 px-4 py-5", className)}>{children}</main>
      </div>
    </div>
  );
}
