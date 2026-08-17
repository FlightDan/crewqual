"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plane } from "lucide-react";
import { Avatar, Divider } from "@/components/ui/misc";
import {
  adminNavItems,
  canAccessAdminNavItem,
  isAdminNavItemActive,
} from "@/components/layout/navigation";
import { cn } from "@/lib/utils";
import { adminRoleLabels, useAdminSession } from "@/services/admin-session-provider";

export function AdminDesktopSidebar({ pendingReviewCount = 0 }: { pendingReviewCount?: number }) {
  const pathname = usePathname();
  const { session, hasPermission, isSuperAdmin } = useAdminSession();
  const role = session?.roles[0] ?? "SUPER_ADMIN";
  const visibleItems = adminNavItems.filter((item) => canAccessAdminNavItem(item, hasPermission));
  return (
    <aside
      data-testid="desktop-sidebar"
      className="hidden min-h-dvh w-60 shrink-0 flex-col gap-6 bg-nav px-4 py-6 text-white lg:flex"
    >
      <div className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md bg-brand">
          <Plane aria-hidden="true" className="size-4" />
        </div>
        <div>
          <p className="text-base font-bold leading-5">CrewQual</p>
          <p className="text-[10px] font-medium text-slate-400">机组资质合规系统</p>
        </div>
      </div>
      <nav aria-label="管理员主导航" className="flex flex-1 flex-col gap-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = isAdminNavItemActive(pathname, item);
          const content = (
            <>
              <Icon aria-hidden="true" className="size-[18px]" />
              <span>{item.label}</span>
              {item.label === "待审核" && pendingReviewCount > 0 ? (
                <span className="ml-auto rounded-full bg-danger px-1.5 py-0.5 text-[10px] text-white">
                  {pendingReviewCount}
                </span>
              ) : null}
            </>
          );
          const className = cn(
            "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition",
            active
              ? "bg-slate-800 text-slate-50"
              : item.available
                ? "text-slate-400 hover:bg-slate-800 hover:text-white"
                : "cursor-not-allowed text-slate-600",
          );
          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={className}
            >
              {content}
            </Link>
          ) : (
            <div key={item.label} aria-disabled="true" className={className}>
              {content}
            </div>
          );
        })}
      </nav>
      <div className="space-y-2">
        <Divider className="bg-slate-800" />
        <div className="flex items-center gap-2 px-1">
          <Avatar initials="管" className="size-8 bg-slate-800 text-white" label="系统管理员" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{session?.displayName ?? "系统管理员"}</p>
            <p className="truncate text-[10px] text-slate-400">
              {adminRoleLabels[role] ?? role} · {isSuperAdmin ? "全局" : session?.unit?.name}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
