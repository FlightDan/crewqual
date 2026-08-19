"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getAdminRouteTitleKey } from "@/components/layout/navigation";
import { AdminAccountMenu } from "@/components/layout/admin-account-menu";
import { useAdminSession } from "@/services/admin-session-provider";
import { LocaleSwitcher, useI18n } from "@/components/i18n-provider";

export function AdminTopBar() {
  const pathname = usePathname();
  const { session, isSuperAdmin } = useAdminSession();
  const { t } = useI18n();
  return (
    <header
      data-testid="desktop-topbar"
      className="hidden h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6 lg:flex"
    >
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-primary">{t(getAdminRouteTitleKey(pathname))}</h1>
        <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-brand">
          {isSuperAdmin
            ? t("navigation.global")
            : t("navigation.unit", { unit: session?.unit?.name ?? t("navigation.unassigned") })}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <LocaleSwitcher />
        <Link
          href="/admin/notifications"
          aria-label={t("navigation.notifications")}
          className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-card text-secondary hover:bg-slate-50"
        >
          <Bell aria-hidden="true" className="size-4" />
        </Link>
        <div className="h-5 w-px bg-border" />
        <AdminAccountMenu />
      </div>
    </header>
  );
}
