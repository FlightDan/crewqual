"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getAdminRouteTitle } from "@/components/layout/navigation";
import { AdminAccountMenu } from "@/components/layout/admin-account-menu";
import { useAdminSession } from "@/services/admin-session-provider";

export function AdminTopBar() {
  const pathname = usePathname();
  const { session, isSuperAdmin } = useAdminSession();
  return (
    <header
      data-testid="desktop-topbar"
      className="hidden h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6 lg:flex"
    >
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-primary">{getAdminRouteTitle(pathname)}</h1>
        <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-brand">
          {isSuperAdmin ? "数据范围：全局" : `所属单位：${session?.unit?.name ?? "未分配"}`}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/admin/notifications"
          aria-label="通知记录"
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
