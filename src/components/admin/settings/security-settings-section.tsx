"use client";

import * as React from "react";
import { History, Laptop, LogOut, ShieldCheck } from "lucide-react";
import {
  SettingsSectionHeader,
  formatSettingsDate,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { adminSettingsService } from "@/services/admin-settings-service";
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";
import type {
  AdminLoginMode,
  SecurityPolicy,
  SettingsAuditItem,
  SettingsSectionId,
  SettingsSession,
} from "@/types/admin-settings";

export function SecuritySettingsSection({
  policy,
  sessions,
  audit,
  canWrite,
  onPolicyChange,
  onSessionsChange,
  notify,
}: {
  policy: SecurityPolicy;
  sessions: SettingsSession[];
  audit: SettingsAuditItem[];
  canWrite: boolean;
  onPolicyChange: (policy: SecurityPolicy) => void;
  onSessionsChange: (sessions: SettingsSession[]) => void;
  notify: SettingsFeedback;
}) {
  const { t } = useI18n();
  const loginModeOptions: Array<{ label: string; value: AdminLoginMode }> = [
    { label: t("settingsSecurity.passwordTotp"), value: "PASSWORD_TOTP" },
    { label: t("settingsSecurity.totpOnly"), value: "TOTP_ONLY" },
    { label: t("settingsSecurity.passwordOnly"), value: "PASSWORD_ONLY" },
  ];
  const auditSectionOptions: Array<{ label: string; value: "all" | SettingsSectionId }> = [
    { label: t("settingsSecurity.allAreas"), value: "all" },
    { label: t("settingsOrg.title"), value: "organization" },
    { label: t("settingsAccount.title"), value: "admins" },
    { label: t("settingsNotify.title"), value: "notifications" },
    { label: t("settings.ai.title"), value: "ai" },
    { label: t("settingsSecurity.title"), value: "security" },
  ];
  const [draft, setDraft] = React.useState(policy);
  const [saving, setSaving] = React.useState(false);
  const [sessionTarget, setSessionTarget] = React.useState<SettingsSession | null>(null);
  const [revoking, setRevoking] = React.useState(false);
  const [auditSection, setAuditSection] = React.useState<"all" | SettingsSectionId>("all");
  const [auditQuery, setAuditQuery] = React.useState("");
  const [credentialDialogOpen, setCredentialDialogOpen] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [currentTotpCode, setCurrentTotpCode] = React.useState("");

  React.useEffect(() => setDraft(policy), [policy]);

  const persist = async (credentials?: { currentPassword?: string; currentTotpCode?: string }) => {
    setSaving(true);
    try {
      const saved = await adminSettingsService.saveSecurity({ ...draft, ...credentials });
      onPolicyChange(saved.policy);
      setDraft(saved.policy);
      setCredentialDialogOpen(false);
      setCurrentPassword("");
      setCurrentTotpCode("");
      if (saved.reauthenticate && isRemoteServiceMode()) {
        notify("success", t("settingsSecurity.saveSuccess"), t("settingsSecurity.reauthRemote"));
        window.location.assign("/admin/login?reason=security-policy-changed");
        return;
      }
      notify(
        "success",
        t("settingsSecurity.saveSuccess"),
        saved.reauthenticate ? t("settingsSecurity.reauthDemo") : t("settingsSecurity.applied"),
      );
    } catch (reason) {
      notify("danger", t("settingsSecurity.saveError"), localizeError(reason, t));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (
      draft.adminSessionTtlHours < 1 ||
      draft.pilotAccessLinkTtlMinutes < 5 ||
      draft.pilotSessionTtlMinutes < 15 ||
      draft.maxFailedAttempts < 3 ||
      draft.lockoutMinutes < 5
    ) {
      notify(
        "danger",
        t("settingsSecurity.invalidPolicy"),
        t("settingsSecurity.invalidPolicyHelp"),
      );
      return;
    }
    if (draft.adminLoginMode !== policy.adminLoginMode) {
      setCredentialDialogOpen(true);
      return;
    }
    await persist();
  };

  const confirmModeChange = async () => {
    await persist({
      ...(draft.adminLoginMode !== "TOTP_ONLY" ? { currentPassword } : {}),
      ...(draft.adminLoginMode !== "PASSWORD_ONLY" ? { currentTotpCode } : {}),
    });
  };

  const revoke = async () => {
    if (!sessionTarget) return;
    setRevoking(true);
    try {
      await adminSettingsService.revokeSession(sessionTarget.id);
      onSessionsChange(sessions.filter((item) => item.id !== sessionTarget.id));
      setSessionTarget(null);
      notify("success", t("settingsSecurity.sessionEnded"), t("settingsSecurity.sessionEndedHelp"));
    } catch (reason) {
      notify("danger", t("settingsSecurity.endError"), localizeError(reason, t));
    } finally {
      setRevoking(false);
    }
  };

  const filteredAudit = audit.filter((item) => {
    const matchesSection = auditSection === "all" || item.section === auditSection;
    const matchesQuery = `${item.actor}${item.action}${item.unitName}${item.summary}`
      .toLowerCase()
      .includes(auditQuery.trim().toLowerCase());
    return matchesSection && matchesQuery;
  });

  return (
    <section className="space-y-5" aria-labelledby="security-settings-title">
      <SettingsSectionHeader
        title={t("settingsSecurity.title")}
        description={t("settingsSecurity.description")}
      />

      {!canWrite ? <Alert tone="info">{t("settingsSecurity.readonly")}</Alert> : null}

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-md bg-emerald-50 text-success">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h3 className="font-bold">{t("settingsSecurity.global")}</h3>
              <p className="mt-1 text-xs text-muted">{t("settingsSecurity.globalDescription")}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border border-border p-3">
            <Select
              label={t("settingsSecurity.loginMode")}
              options={loginModeOptions}
              value={draft.adminLoginMode}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, adminLoginMode: event.target.value as AdminLoginMode })
              }
            />
            <p className="mt-2 text-xs text-muted">{t("settingsSecurity.modeHelp")}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Input
              label={t("settingsSecurity.adminTtl")}
              type="number"
              min={1}
              max={72}
              value={draft.adminSessionTtlHours}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, adminSessionTtlHours: Number(event.target.value) })
              }
            />
            <Input
              label={t("settingsSecurity.linkTtl")}
              type="number"
              min={5}
              max={60}
              value={draft.pilotAccessLinkTtlMinutes}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, pilotAccessLinkTtlMinutes: Number(event.target.value) })
              }
            />
            <Input
              label={t("settingsSecurity.pilotTtl")}
              type="number"
              min={15}
              max={480}
              value={draft.pilotSessionTtlMinutes}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, pilotSessionTtlMinutes: Number(event.target.value) })
              }
            />
            <Input
              label={t("settingsSecurity.failedAttempts")}
              type="number"
              min={3}
              max={20}
              value={draft.maxFailedAttempts}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, maxFailedAttempts: Number(event.target.value) })
              }
            />
            <Input
              label={t("settingsSecurity.lockout")}
              type="number"
              min={5}
              max={1440}
              value={draft.lockoutMinutes}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, lockoutMinutes: Number(event.target.value) })
              }
            />
          </div>
          {canWrite ? (
            <div className="flex justify-end">
              <Button type="button" loading={saving} onClick={() => void save()}>
                {t("settingsSecurity.savePolicy")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={credentialDialogOpen} onOpenChange={setCredentialDialogOpen}>
        <DialogContent aria-describedby="security-mode-confirmation-description">
          <DialogTitle className="text-lg font-bold">
            {t("settingsSecurity.modeConfirmTitle")}
          </DialogTitle>
          <DialogDescription
            id="security-mode-confirmation-description"
            className="mt-1 text-sm text-secondary"
          >
            {t("settingsSecurity.modeConfirmDescription")}
          </DialogDescription>
          <div className="mt-5 space-y-4">
            {draft.adminLoginMode !== "TOTP_ONLY" ? (
              <Input
                label={t("settingsSecurity.currentPassword")}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            ) : null}
            {draft.adminLoginMode !== "PASSWORD_ONLY" ? (
              <Input
                label={t("settingsSecurity.currentTotp")}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={currentTotpCode}
                onChange={(event) => setCurrentTotpCode(event.target.value)}
                required
              />
            ) : null}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCredentialDialogOpen(false)}
            >
              {t("settingsSecurity.cancel")}
            </Button>
            <Button type="button" loading={saving} onClick={() => void confirmModeChange()}>
              {t("settingsSecurity.confirmSwitch")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div>
            <h3 className="font-bold">{t("settingsSecurity.sessions")}</h3>
            <p className="mt-1 text-xs text-muted">{t("settingsSecurity.sessionsDescription")}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border p-4"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-md bg-slate-100 text-secondary">
                <Laptop aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-[180px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{session.adminName}</p>
                  {session.current ? (
                    <Badge tone="success">{t("settingsSecurity.currentSession")}</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {session.browser} · {session.maskedIp}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs text-secondary">
                <div>
                  <dt className="text-muted">{t("settingsSecurity.login")}</dt>
                  <dd>{formatSettingsDate(session.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t("settingsSecurity.recentActivity")}</dt>
                  <dd>{formatSettingsDate(session.lastSeenAt)}</dd>
                </div>
              </dl>
              {!session.current && canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setSessionTarget(session)}
                >
                  <LogOut aria-hidden="true" className="size-4" />
                  {t("settingsSecurity.endSession")}
                </Button>
              ) : null}
            </div>
          ))}
          {!sessions.length ? (
            <p className="py-8 text-center text-sm text-muted">
              {t("settingsSecurity.noSessions")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <History aria-hidden="true" className="mt-0.5 size-5 text-secondary" />
            <div>
              <h3 className="font-bold">{t("settingsSecurity.audit")}</h3>
              <p className="mt-1 text-xs text-muted">{t("settingsSecurity.auditDescription")}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <Input
              aria-label={t("settingsSecurity.searchAudit")}
              placeholder={t("settingsSecurity.searchPlaceholder")}
              value={auditQuery}
              onChange={(event) => setAuditQuery(event.target.value)}
            />
            <Select
              aria-label={t("settingsSecurity.filterAudit")}
              options={auditSectionOptions}
              value={auditSection}
              onChange={(event) => setAuditSection(event.target.value as "all" | SettingsSectionId)}
            />
          </div>
          <div className="space-y-2">
            {filteredAudit.map((item) => (
              <div key={item.id} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{item.action}</p>
                    <p className="mt-1 text-xs text-muted">
                      {item.actor} · {item.unitName}
                    </p>
                  </div>
                  <time className="text-xs text-muted">{formatSettingsDate(item.occurredAt)}</time>
                </div>
                <p className="mt-3 text-sm leading-6 text-secondary">{item.summary}</p>
              </div>
            ))}
            {!filteredAudit.length ? (
              <p className="py-8 text-center text-sm text-muted">{t("settingsSecurity.noAudit")}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(sessionTarget)}
        onOpenChange={(open) => !open && setSessionTarget(null)}
      >
        <DialogContent aria-describedby="revoke-session-description">
          <DialogTitle className="text-lg font-bold">{t("settingsSecurity.endTitle")}</DialogTitle>
          <DialogDescription
            id="revoke-session-description"
            className="mt-2 text-sm leading-6 text-secondary"
          >
            {sessionTarget
              ? t("settingsSecurity.endDescription", {
                  name: sessionTarget.adminName,
                  browser: sessionTarget.browser,
                })
              : null}
          </DialogDescription>
          <Alert tone="warning" className="mt-4">
            {t("settingsSecurity.endWarning")}
          </Alert>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setSessionTarget(null)}>
              {t("settingsSecurity.cancel")}
            </Button>
            <Button type="button" variant="danger" loading={revoking} onClick={() => void revoke()}>
              {t("settingsSecurity.confirmEnd")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
