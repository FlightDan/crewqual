"use client";

import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/layout/admin-shell";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import { useAdminSession } from "@/services/admin-session-provider";
import { AdminAccessDenied } from "@/components/admin/admin-access-denied";
import { Button } from "@/components/ui/button";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { useI18n } from "@/components/i18n-provider";

export function AdminWorkspaceShell({ children }: { children: React.ReactNode }) {
  const state = useAdminState();
  const services = useApplicationServices();
  const adminSession = useAdminSession();
  const remoteMode = isRemoteServiceMode();
  const { t } = useI18n();
  const pendingReviewCountQuery = useQuery({
    queryKey: ["admin", "pending-review-count"],
    queryFn: async () =>
      (
        await services.reviews.list({
          status: "pending",
          page: 1,
          pageSize: 1,
        })
      ).data.total,
    enabled:
      remoteMode &&
      adminSession.status === "authenticated" &&
      (adminSession.isSuperAdmin || Boolean(adminSession.session?.unit)),
  });
  const pendingReviewCount = remoteMode
    ? (pendingReviewCountQuery.data ?? 0)
    : state.reviews.filter((review) => review.humanStatus === "pending").length;
  if (remoteMode && ["loading", "unauthenticated"].includes(adminSession.status)) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface p-6 text-sm text-secondary">
        {t("navigation.sessionChecking")}
      </main>
    );
  }
  if (remoteMode && adminSession.status === "error") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
        <p className="text-sm text-danger">
          {adminSession.error ?? t("navigation.sessionUnavailable")}
        </p>
        <Button type="button" variant="secondary" onClick={() => void adminSession.refresh()}>
          {t("navigation.reauthenticate")}
        </Button>
      </main>
    );
  }
  const missingUnit = remoteMode && !adminSession.isSuperAdmin && !adminSession.session?.unit;
  return (
    <AdminShell pendingReviewCount={pendingReviewCount}>
      {missingUnit ? <AdminAccessDenied reason="no-unit" /> : children}
    </AdminShell>
  );
}
