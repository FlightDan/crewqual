"use client";

import { Plane } from "lucide-react";
import { AdminNavigationTree } from "@/components/layout/admin-navigation-tree";

export function AdminDesktopSidebar({ pendingReviewCount = 0 }: { pendingReviewCount?: number }) {
  return (
    <aside
      data-testid="desktop-sidebar"
      className="hidden min-h-dvh w-[260px] shrink-0 flex-col gap-6 bg-nav px-4 py-6 text-white lg:flex"
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
        <AdminNavigationTree pendingReviewCount={pendingReviewCount} />
      </nav>
    </aside>
  );
}
