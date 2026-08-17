"use client";

import * as React from "react";
import { AdminDesktopSidebar } from "@/components/layout/admin-sidebar";
import { AdminTopBar } from "@/components/layout/admin-topbar";
import { AdminMobileHeader } from "@/components/layout/admin-mobile-header";
import { AdminMobileBottomNav } from "@/components/layout/admin-mobile-bottom-nav";
import { AdminMobileDrawer } from "@/components/layout/admin-mobile-drawer";

export function AdminShell({
  children,
  initialDrawerOpen = false,
  pendingReviewCount = 0,
}: {
  children: React.ReactNode;
  initialDrawerOpen?: boolean;
  pendingReviewCount?: number;
}) {
  const [drawerOpen, setDrawerOpen] = React.useState(initialDrawerOpen);
  React.useEffect(() => {
    setDrawerOpen(initialDrawerOpen);
  }, [initialDrawerOpen]);
  return (
    <div
      data-testid="admin-shell"
      className="flex min-h-screen w-full overflow-x-hidden bg-surface"
    >
      <AdminDesktopSidebar pendingReviewCount={pendingReviewCount} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopBar />
        <AdminMobileHeader onMenuClick={() => setDrawerOpen(true)} />
        <AdminMobileDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          pendingReviewCount={pendingReviewCount}
        />
        {children}
      </div>
      <AdminMobileBottomNav pendingReviewCount={pendingReviewCount} />
    </div>
  );
}
