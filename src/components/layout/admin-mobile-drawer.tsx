"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Avatar, Divider } from "@/components/ui/misc";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  adminNavItems,
  canAccessAdminNavItem,
  isAdminNavItemActive,
} from "@/components/layout/navigation";
import { cn } from "@/lib/utils";
import { adminRoleLabels, useAdminSession } from "@/services/admin-session-provider";

export function AdminMobileDrawer({
  open,
  onOpenChange,
  pendingReviewCount = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingReviewCount?: number;
}) {
  const pathname = usePathname();
  const { session, hasPermission, isSuperAdmin, logout } = useAdminSession();
  const role = session?.roles[0] ?? "SUPER_ADMIN";
  const visibleItems = adminNavItems.filter((item) => canAccessAdminNavItem(item, hasPermission));
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        data-testid="mobile-drawer"
        className="flex flex-col overflow-y-auto"
        side="left"
      >
        <DrawerTitle className="sr-only">管理员菜单</DrawerTitle>
        <DrawerDescription className="sr-only">CrewQual 管理员导航</DrawerDescription>
        <div className="flex items-center gap-3 px-4 pb-4 pt-5">
          <Avatar initials="护" className="size-10 bg-blue-50 text-brand" label="机组资质" />
          <div>
            <p className="text-base font-bold">
              CrewQual{" "}
              <span className="rounded bg-nav px-1.5 py-0.5 text-[10px] text-white">机组资质</span>
            </p>
            <p className="text-xs text-secondary">{session?.displayName ?? "系统管理员"}</p>
            <p className="text-[11px] text-muted">
              {adminRoleLabels[role] ?? role} · {isSuperAdmin ? "全局" : session?.unit?.name}
            </p>
          </div>
        </div>
        <Divider />
        <nav aria-label="管理员移动导航" className="flex-1 space-y-1 px-3 py-3">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = isAdminNavItemActive(pathname, item);
            const className = cn(
              "flex min-h-11 items-center gap-4 rounded-md px-4 text-sm font-semibold",
              active
                ? "bg-brand text-white"
                : item.available
                  ? "text-primary hover:bg-slate-100"
                  : "cursor-not-allowed text-muted",
            );
            const content = (
              <>
                <Icon aria-hidden="true" className="size-5" />
                <span>{item.label}</span>
                {item.label === "待审核" && pendingReviewCount > 0 ? (
                  <span className="ml-auto rounded-full bg-danger px-2 py-0.5 text-[10px] text-white">
                    {pendingReviewCount}
                  </span>
                ) : null}
              </>
            );
            return item.href ? (
              <DrawerClose asChild key={item.label}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={className}
                >
                  {content}
                </Link>
              </DrawerClose>
            ) : (
              <div key={item.label} aria-disabled="true" className={className}>
                {content}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-border p-4 pb-safe-bottom">
          <DrawerClose asChild>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-11 w-full items-center gap-3 rounded-md bg-red-50 px-4 text-sm font-semibold text-danger"
            >
              <LogOut aria-hidden="true" className="size-5" />
              退出登录
            </button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
