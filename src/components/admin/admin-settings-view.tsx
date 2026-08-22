"use client";

import * as React from "react";
import {
  Bell,
  Bot,
  Building2,
  Database,
  RefreshCw,
  ShieldCheck,
  Users,
  ImageDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AdminAccessDenied } from "@/components/admin/admin-access-denied";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminAccountSettingsSection } from "@/components/admin/settings/admin-account-settings-section";
import { AiSettingsSection } from "@/components/admin/settings/ai-settings-section";
import { NotificationSettingsSection } from "@/components/admin/settings/notification-settings-section";
import { OrganizationSettingsSection } from "@/components/admin/settings/organization-settings-section";
import { PositionSettingsSection } from "@/components/admin/settings/position-settings-section";
import { SecuritySettingsSection } from "@/components/admin/settings/security-settings-section";
import { MediaOptimizationSection } from "@/components/admin/settings/media-optimization-section";
import { BackupSettingsSection } from "@/components/admin/settings/backup-settings-section";
import { ObjectStorageSettingsSection } from "@/components/admin/settings/object-storage-settings-section";
import { SystemUpdatesSection } from "@/components/admin/settings/system-updates-section";
import {
  SettingsSkeleton,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { PageContainer } from "@/components/layout/page-container";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { adminSettingsService } from "@/services/admin-settings-service";
import { useAdminSession } from "@/services/admin-session-provider";
import type { AdminSettingsSnapshot, SettingsSectionId } from "@/types/admin-settings";
import { useI18n } from "@/components/i18n-provider";

type SectionDefinition = {
  id: SettingsSectionId;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  superAdminOnly?: boolean;
};

const sections: SectionDefinition[] = [
  {
    id: "organization",
    labelKey: "settings.section.organization",
    descriptionKey: "settings.section.organizationDescription",
    icon: Building2,
  },
  {
    id: "positions",
    labelKey: "settings.section.positions",
    descriptionKey: "settings.section.positionsDescription",
    icon: Users,
  },
  {
    id: "admins",
    labelKey: "settings.section.admins",
    descriptionKey: "settings.section.adminsDescription",
    icon: Users,
    superAdminOnly: true,
  },
  {
    id: "notifications",
    labelKey: "settings.section.notifications",
    descriptionKey: "settings.section.notificationsDescription",
    icon: Bell,
  },
  {
    id: "ai",
    labelKey: "settings.section.ai",
    descriptionKey: "settings.section.aiDescription",
    icon: Bot,
    superAdminOnly: true,
  },
  {
    id: "security",
    labelKey: "settings.section.security",
    descriptionKey: "settings.section.securityDescription",
    icon: ShieldCheck,
  },
  {
    id: "storage",
    labelKey: "settings.section.storage",
    descriptionKey: "settings.section.storageDescription",
    icon: Database,
    superAdminOnly: true,
  },
  {
    id: "media",
    labelKey: "settings.section.media",
    descriptionKey: "settings.section.mediaDescription",
    icon: ImageDown,
    superAdminOnly: true,
  },
  {
    id: "backups",
    labelKey: "settings.section.backups",
    descriptionKey: "settings.section.backupsDescription",
    icon: ShieldCheck,
    superAdminOnly: true,
  },
  {
    id: "updates",
    labelKey: "settings.section.updates",
    descriptionKey: "settings.section.updatesDescription",
    icon: RefreshCw,
    superAdminOnly: true,
  },
];

function sectionFromLocation(available: SectionDefinition[]) {
  if (typeof window === "undefined") return available[0]?.id ?? "organization";
  const value = new URLSearchParams(window.location.search).get(
    "section",
  ) as SettingsSectionId | null;
  return available.some((item) => item.id === value)
    ? value!
    : (available[0]?.id ?? "organization");
}

export function AdminSettingsView() {
  const { session, hasPermission, isSuperAdmin } = useAdminSession();
  const { t } = useI18n();
  const availableSections = React.useMemo(
    () => sections.filter((item) => !item.superAdminOnly || isSuperAdmin),
    [isSuperAdmin],
  );
  const [activeSection, setActiveSection] = React.useState<SettingsSectionId>("organization");
  const [snapshot, setSnapshot] = React.useState<AdminSettingsSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{
    tone: "info" | "success" | "warning" | "danger";
    title: string;
    description?: string;
  } | null>(null);

  const notify = React.useCallback<SettingsFeedback>((tone, title, description) => {
    setToast({ tone, title, description });
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await adminSettingsService.load();
      setSnapshot({ ...data, positions: data.positions ?? [] });
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : t("settings.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    setActiveSection(sectionFromLocation(availableSections));
    void load();
  }, [availableSections, load]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!hasPermission("settings.read")) return <AdminAccessDenied />;

  const selectSection = (id: SettingsSectionId) => {
    setActiveSection(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("section", id);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }
  };

  return (
    <PageContainer className="space-y-6">
      <AdminPageHeader
        title={t("settings.title")}
        description={t("settings.description")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">
              {isSuperAdmin
                ? t("settings.globalScope")
                : (session?.unit?.name ?? t("settings.unitScope"))}
            </Badge>
            {process.env.NEXT_PUBLIC_SERVICE_MODE !== "remote" ? (
              <Badge tone="warning">{t("settings.localDemo")}</Badge>
            ) : null}
          </div>
        }
      />

      {!isSuperAdmin ? (
        <Alert tone="info" title={t("settings.unitPermissionTitle")}>
          {t("settings.unitPermissionDescription")}
        </Alert>
      ) : null}

      {loading ? <SettingsSkeleton /> : null}
      {!loading && loadError ? (
        <Alert tone="danger" title={t("settings.loadFailed")}>
          {loadError} {t("settings.refreshRetry")}
        </Alert>
      ) : null}

      {!loading && snapshot ? (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
          <aside className="hidden lg:block" aria-label={t("settings.secondaryNav")}>
            <Card className="sticky top-6">
              <CardContent className="space-y-1 p-2">
                {availableSections.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === activeSection;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectSection(item.id)}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition",
                        active
                          ? "bg-blue-50 text-brand"
                          : "text-secondary hover:bg-slate-50 hover:text-primary",
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon aria-hidden="true" className="size-5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{t(item.labelKey)}</span>
                        <span
                          className={cn(
                            "mt-0.5 block text-[11px]",
                            active ? "text-blue-600" : "text-muted",
                          )}
                        >
                          {t(item.descriptionKey)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </aside>

          <div className="min-w-0 space-y-5">
            <div className="lg:hidden">
              <Select
                label={t("settings.category")}
                options={availableSections.map((item) => ({
                  label: t(item.labelKey),
                  value: item.id,
                }))}
                value={activeSection}
                onChange={(event) => selectSection(event.target.value as SettingsSectionId)}
              />
            </div>

            {activeSection === "organization" ? (
              <OrganizationSettingsSection
                units={snapshot.units}
                isSuperAdmin={isSuperAdmin}
                canWrite={hasPermission("settings.units.write")}
                onUnitsChange={(units) => setSnapshot({ ...snapshot, units })}
                notify={notify}
              />
            ) : null}

            {activeSection === "positions" ? (
              <PositionSettingsSection
                positions={snapshot.positions}
                defaultOrganizationId={
                  snapshot.positions[0]?.organizationId ?? snapshot.units[0]?.id
                }
                canWrite={hasPermission("settings.positions.write")}
                isSuperAdmin={isSuperAdmin}
                onPositionsChange={(positions) => setSnapshot({ ...snapshot, positions })}
                notify={notify}
              />
            ) : null}

            {activeSection === "admins" && isSuperAdmin ? (
              <AdminAccountSettingsSection
                admins={snapshot.admins}
                units={snapshot.units}
                canWrite={hasPermission("settings.admins.write")}
                onAdminsChange={(admins) => setSnapshot({ ...snapshot, admins })}
                notify={notify}
              />
            ) : null}

            {activeSection === "notifications" ? (
              <NotificationSettingsSection
                channels={snapshot.notificationChannels}
                routes={snapshot.notificationRoutes}
                units={snapshot.units}
                initialUnitId={snapshot.notificationUnitId}
                isSuperAdmin={isSuperAdmin}
                canWriteRoutes={hasPermission("settings.notifications.write")}
                canWriteSecrets={isSuperAdmin}
                onChannelsChange={(notificationChannels) =>
                  setSnapshot({ ...snapshot, notificationChannels })
                }
                onRoutesChange={(notificationRoutes) =>
                  setSnapshot({ ...snapshot, notificationRoutes })
                }
                notify={notify}
              />
            ) : null}

            {activeSection === "ai" && isSuperAdmin ? (
              <AiSettingsSection
                ai={snapshot.ai}
                health={snapshot.systemHealth}
                canWrite={hasPermission("settings.security.write")}
                onAiChange={(ai) => setSnapshot({ ...snapshot, ai })}
                notify={notify}
              />
            ) : null}

            {activeSection === "security" ? (
              <SecuritySettingsSection
                policy={snapshot.security}
                sessions={snapshot.sessions}
                audit={snapshot.audit}
                canWrite={hasPermission("settings.security.write")}
                onPolicyChange={(security) => setSnapshot({ ...snapshot, security })}
                onSessionsChange={(sessions) => setSnapshot({ ...snapshot, sessions })}
                notify={notify}
              />
            ) : null}
            {activeSection === "media" && isSuperAdmin ? (
              <MediaOptimizationSection
                canWrite={hasPermission("settings.security.write")}
                notify={notify}
              />
            ) : null}
            {activeSection === "storage" && isSuperAdmin ? (
              <ObjectStorageSettingsSection
                canWrite={hasPermission("settings.security.write")}
                notify={notify}
              />
            ) : null}
            {activeSection === "backups" && isSuperAdmin ? (
              <BackupSettingsSection
                canWrite={hasPermission("settings.security.write")}
                notify={notify}
              />
            ) : null}
            {activeSection === "updates" && isSuperAdmin ? (
              <SystemUpdatesSection notify={notify} />
            ) : null}
          </div>
        </div>
      ) : null}

      <Toast
        open={Boolean(toast)}
        tone={toast?.tone}
        title={toast?.title ?? ""}
        onClose={() => setToast(null)}
      >
        {toast?.description}
      </Toast>
    </PageContainer>
  );
}
