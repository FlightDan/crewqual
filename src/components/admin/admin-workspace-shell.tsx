"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/layout/admin-shell";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import { useAdminSession } from "@/services/admin-session-provider";
import { AdminAccessDenied } from "@/components/admin/admin-access-denied";
import { Button } from "@/components/ui/button";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { useI18n } from "@/components/i18n-provider";
import { Toast } from "@/components/ui/toast";
import {
  adminSettingsService,
  isSecurityRiskSummaryComplete,
} from "@/services/admin-settings-service";
import { formatSettingsDate } from "@/components/admin/settings/settings-shared";
import type { SecurityLoginSummary } from "@/types/admin-settings";

const displayedSecuritySessions = new Set<string>();
const securitySummaryStorageKey = (id: string) => `crewqual:security-summary:${id}`;

function summaryWasDisplayed(id: string) {
  if (displayedSecuritySessions.has(id)) return true;
  try {
    return window.sessionStorage.getItem(securitySummaryStorageKey(id)) === "shown";
  } catch {
    return displayedSecuritySessions.has(id);
  }
}
function rememberDisplayedSummary(id: string) {
  displayedSecuritySessions.add(id);
  if (displayedSecuritySessions.size > 50)
    displayedSecuritySessions.delete(displayedSecuritySessions.values().next().value!);
  try {
    window.sessionStorage.setItem(securitySummaryStorageKey(id), "shown");
  } catch {
    /* A blocked storage API must not break login or navigation. */
  }
}

export function AdminLoginSecuritySummary() {
  const session = useAdminSession();
  const { locale, t } = useI18n();
  const sessionId =
    session.session?.sessionId ?? session.session?.sessions.find((item) => item.current)?.id;
  const enabled =
    isRemoteServiceMode() &&
    session.status === "authenticated" &&
    session.hasPermission("audit.read");
  const [toast, setToast] = React.useState<{
    sessionId: string;
    summary: SecurityLoginSummary | null;
  } | null>(null);
  React.useEffect(() => {
    setToast(null);
    if (!enabled || !sessionId || summaryWasDisplayed(sessionId)) return;
    let stale = false;
    const display = (summary: SecurityLoginSummary | null) => {
      if (stale || summaryWasDisplayed(sessionId)) return;
      rememberDisplayedSummary(sessionId);
      setToast({ sessionId, summary });
    };
    void adminSettingsService
      .loadSecuritySummary()
      .then((summary) => {
        // A response obtained after another login must not mark the old session as read.
        if (summary.sessionId !== sessionId) return;
        display(summary);
      })
      .catch(() => display(null));
    return () => {
      stale = true;
    };
  }, [enabled, sessionId]);
  if (!toast || toast.sessionId !== sessionId || !enabled) return null;
  const summary = toast.summary;
  const complete = summary ? isSecurityRiskSummaryComplete(summary) : false;
  const sources =
    summary?.sources === null
      ? Object.entries(summary.sourceSegments)
          .map(([version, count]) => t("securityRisk.sourceSegment", { version, count }))
          .join("; ")
      : String(summary?.sources ?? "—");
  const description = !complete
    ? t("securityRisk.summaryUnavailable")
    : summary!.requests === 0
      ? t("securityRisk.summaryEmpty")
      : t("securityRisk.summaryCounts", {
          batches: summary!.batches,
          requests: summary!.requests,
          sources,
        });
  return (
    <Toast
      open
      title={t("securityRisk.summaryTitle")}
      tone={complete && summary!.requests === 0 ? "info" : "warning"}
      onClose={() => setToast(null)}
    >
      {description}
      {summary?.keyRotation ? <> {t("securityRisk.keyRotation")}</> : null}
      {summary ? (
        <span className="mt-2 block">
          {t("securityRisk.period", {
            since: formatSettingsDate(summary.since, locale),
            until: formatSettingsDate(summary.until, locale),
          })}
        </span>
      ) : null}
      <a
        className="mt-2 inline-block rounded font-semibold text-brand underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        href="/admin/settings?section=security"
      >
        {t("securityRisk.viewStatistics")}
      </a>
    </Toast>
  );
}

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
      <AdminLoginSecuritySummary />
      {missingUnit ? <AdminAccessDenied reason="no-unit" /> : children}
    </AdminShell>
  );
}
