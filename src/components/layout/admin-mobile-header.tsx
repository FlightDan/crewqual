"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Bell, Menu } from "lucide-react";
import { getAdminRouteTitleKey } from "@/components/layout/navigation";
import { Avatar } from "@/components/ui/misc";
import { IconButton } from "@/components/ui/button";
import { useAdminSession } from "@/services/admin-session-provider";
import { useI18n } from "@/components/i18n-provider";

export function AdminMobileHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();
  const { session, isSuperAdmin } = useAdminSession();
  const { t } = useI18n();
  return (
    <header
      data-testid="mobile-header"
      className="sticky top-0 z-[var(--z-header)] flex min-h-[84px] items-center justify-between bg-nav px-4 py-3 text-white lg:hidden"
    >
      <div className="flex min-w-0 items-center gap-3">
        <IconButton
          label={t("navigation.openMenu")}
          variant="ghost"
          className="shrink-0 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
          onClick={onMenuClick}
        >
          <Menu aria-hidden="true" className="size-5" />
        </IconButton>
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{t(getAdminRouteTitleKey(pathname))}</p>
          <p className="truncate text-xs text-slate-400">
            {isSuperAdmin
              ? t("navigation.global")
              : (session?.unit?.name ?? t("navigation.unassigned"))}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/admin/notifications"
          aria-label={t("navigation.notifications")}
          className="inline-flex size-11 items-center justify-center rounded-md bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
        >
          <Bell aria-hidden="true" className="size-4" />
        </Link>
        <Avatar
          initials={session?.displayName.slice(0, 1) || t("navigation.adminInitials")}
          className="size-9 bg-brand text-white"
          label={session?.displayName ?? t("navigation.adminAccount")}
        />
      </div>
    </header>
  );
}
