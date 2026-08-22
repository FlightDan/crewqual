"use client";

import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  SettingsSectionHeader,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { systemUpdatesService } from "@/services/system-updates-service";
import type { SystemUpdateSnapshot, UpdatePhase } from "@/types/system-updates";
import { useI18n } from "@/components/i18n-provider";

const activePhases = new Set<UpdatePhase>([
  "CHECKING",
  "PREFLIGHT",
  "DOWNLOADING",
  "BACKING_UP",
  "MIGRATING",
  "RESTARTING",
  "HEALTH_CHECKING",
]);

export function SystemUpdatesSection({ notify }: { notify: SettingsFeedback }) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = React.useState<SystemUpdateSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [working, setWorking] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [totp, setTotp] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [error, setError] = React.useState("");

  const load = React.useCallback(
    async (refresh = false) => {
      try {
        setError("");
        const next = refresh
          ? await systemUpdatesService.check()
          : await systemUpdatesService.load();
        setSnapshot(next);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t("settings.updates.loadError"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!snapshot?.job || !activePhases.has(snapshot.job.phase)) return;
    const timer = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(timer);
  }, [load, snapshot?.job]);

  const install = async () => {
    if (!snapshot?.latestVersion) return;
    setWorking(true);
    try {
      const result = await systemUpdatesService.install({
        version: snapshot.latestVersion,
        confirmation,
        ...(password ? { currentPassword: password } : {}),
        ...(totp ? { currentTotpCode: totp } : {}),
      });
      setSnapshot({ ...snapshot, job: result.job });
      notify("info", t("settings.updates.started"), t("settings.updates.disconnectNotice"));
      setPassword("");
      setTotp("");
      setConfirmation("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.updates.installError"));
    } finally {
      setWorking(false);
    }
  };

  if (loading)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted">{t("common.loading")}</CardContent>
      </Card>
    );
  if (!snapshot) return <Alert tone="danger">{error || t("settings.updates.loadError")}</Alert>;

  const active = snapshot.job && activePhases.has(snapshot.job.phase);
  const hasUpdate = Boolean(
    snapshot.latestVersion && snapshot.latestVersion !== snapshot.currentVersion,
  );
  return (
    <section className="space-y-5" aria-labelledby="system-updates-title">
      <SettingsSectionHeader
        title={t("settings.updates.title")}
        description={t("settings.updates.description")}
        action={
          <Button
            type="button"
            variant="secondary"
            loading={working}
            onClick={() => void load(true)}
          >
            {t("settings.updates.check")}
          </Button>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted">{t("settings.updates.current")}</p>
              <p className="font-semibold">{snapshot.currentVersion}</p>
            </div>
            <div>
              <p className="text-xs text-muted">{t("settings.updates.latest")}</p>
              <p className="font-semibold">{snapshot.latestVersion ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">{t("settings.updates.mode")}</p>
              <Badge tone={snapshot.mode === "managed" ? "success" : "warning"}>
                {snapshot.mode === "managed"
                  ? t("settings.updates.managed")
                  : t("settings.updates.manual")}
              </Badge>
            </div>
          </div>
          {snapshot.reason ? (
            <Alert tone={snapshot.canInstall ? "info" : "warning"}>{snapshot.reason}</Alert>
          ) : null}
          {snapshot.releaseNotesUrl ? (
            <a
              className="text-sm text-brand underline"
              href={snapshot.releaseNotesUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t("settings.updates.releaseNotes")}
            </a>
          ) : null}
          {snapshot.job ? (
            <div className="rounded-md bg-slate-50 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span>{t("settings.updates.progress")}</span>
                <strong>{snapshot.job.phase}</strong>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200">
                <div
                  className="h-full bg-brand transition-all"
                  style={{ width: `${snapshot.job.progress}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-secondary">{snapshot.job.message}</p>
            </div>
          ) : null}
          {active ? <Alert tone="info">{t("settings.updates.disconnectNotice")}</Alert> : null}
          {hasUpdate && snapshot.canInstall && !active ? (
            <div className="space-y-3 rounded-md border border-border p-4">
              <p className="text-sm font-semibold">
                {t("settings.updates.confirmTitle", { version: snapshot.latestVersion! })}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label={t("settings.updates.confirmVersion")}
                  value={confirmation}
                  placeholder={snapshot.latestVersion ?? "vX.Y.Z"}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                <Input
                  label={t("settings.updates.password")}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Input
                  label={t("settings.updates.totp")}
                  inputMode="numeric"
                  value={totp}
                  onChange={(event) => setTotp(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={confirmation !== snapshot.latestVersion}
                loading={working}
                onClick={() => void install()}
              >
                {t("settings.updates.install")}
              </Button>
            </div>
          ) : null}
          {!hasUpdate && !active ? (
            <p className="text-sm text-secondary">{t("settings.updates.upToDate")}</p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
