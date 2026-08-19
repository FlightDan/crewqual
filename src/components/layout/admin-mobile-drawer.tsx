"use client";

import { LogOut } from "lucide-react";
import { Avatar, Divider } from "@/components/ui/misc";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { AdminNavigationTree } from "@/components/layout/admin-navigation-tree";
import { useAdminSession } from "@/services/admin-session-provider";
import { useI18n } from "@/components/i18n-provider";

export function AdminMobileDrawer({
  open,
  onOpenChange,
  pendingReviewCount = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingReviewCount?: number;
}) {
  const { session, isSuperAdmin, logout } = useAdminSession();
  const role = session?.roles[0] ?? "SUPER_ADMIN";
  const { t } = useI18n();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        data-testid="mobile-drawer"
        className="flex flex-col overflow-y-auto"
        side="left"
      >
        <DrawerTitle className="sr-only">{t("navigation.adminMenu")}</DrawerTitle>
        <DrawerDescription className="sr-only">
          {t("navigation.adminDescription")}
        </DrawerDescription>
        <div className="flex items-center gap-3 px-4 pb-4 pt-5">
          <Avatar
            initials="C"
            className="size-10 bg-blue-50 text-brand"
            label={t("navigation.system")}
          />
          <div>
            <p className="text-base font-bold">
              CrewQual{" "}
              <span className="rounded bg-nav px-1.5 py-0.5 text-[10px] text-white">
                {t("navigation.crewQualification")}
              </span>
            </p>
            <p className="text-xs text-secondary">
              {session?.displayName ?? t("navigation.adminAccount")}
            </p>
            <p className="text-[11px] text-muted">
              {t(`navigation.role.${role}`)} ·{" "}
              {isSuperAdmin ? t("navigation.all") : session?.unit?.name}
            </p>
          </div>
        </div>
        <Divider />
        <nav aria-label={t("navigation.adminMobile")} className="flex-1 space-y-1 px-3 py-3">
          <AdminNavigationTree
            mobile
            pendingReviewCount={pendingReviewCount}
            onNavigate={() => onOpenChange(false)}
          />
        </nav>
        <div className="border-t border-border p-4 pb-safe-bottom">
          <DrawerClose asChild>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-11 w-full items-center gap-3 rounded-md bg-red-50 px-4 text-sm font-semibold text-danger"
            >
              <LogOut aria-hidden="true" className="size-5" />
              {t("navigation.logout")}
            </button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
