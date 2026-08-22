"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/choice";
import { Alert } from "@/components/ui/alert";
import {
  SettingsSectionHeader,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { backupSettingsService } from "@/services/backup-settings-service";
import type { BackupSettingsSnapshot } from "@/types/admin-settings";
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";

const emptyTarget = {
  name: "",
  type: "LOCAL",
  endpoint: "/backups",
  basePath: "crewqual",
  secret: "",
  encryptionEnabled: true,
};

export function BackupSettingsSection({
  canWrite,
  notify,
}: {
  canWrite: boolean;
  notify: SettingsFeedback;
}) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = React.useState<BackupSettingsSnapshot | null>(null);
  const [target, setTarget] = React.useState(emptyTarget);
  const [plan, setPlan] = React.useState({
    name: "",
    source: "GALLERY",
    mode: "INCREMENTAL",
    targetId: "",
    cron: "0 2 * * *",
    timezone: "Asia/Shanghai",
    retentionCount: 30,
    retentionDays: 90,
    enabled: true,
  });
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const load = React.useCallback(
    () =>
      backupSettingsService
        .load()
        .then(setSnapshot)
        .catch((reason) => setError(localizeError(reason, t, "settingsBackup.loadError"))),
    [t],
  );
  React.useEffect(() => {
    void load();
  }, [load]);
  const createTarget = async () => {
    setSaving(true);
    try {
      await backupSettingsService.createTarget(target);
      setTarget(emptyTarget);
      await load();
      notify("success", t("settingsBackup.targetSaved"));
    } catch (reason) {
      setError(localizeError(reason, t, "settingsBackup.targetSaveError"));
    } finally {
      setSaving(false);
    }
  };
  const createPlan = async () => {
    setSaving(true);
    try {
      await backupSettingsService.createPlan({
        ...plan,
        retentionCount: Number(plan.retentionCount),
        retentionDays: Number(plan.retentionDays),
      });
      setPlan({ ...plan, name: "" });
      await load();
      notify("success", t("settingsBackup.planSaved"));
    } catch (reason) {
      setError(localizeError(reason, t, "settingsBackup.planSaveError"));
    } finally {
      setSaving(false);
    }
  };
  const runNow = async (planId: string) => {
    try {
      await backupSettingsService.runNow(planId);
      await load();
      notify("success", t("settingsBackup.queued"));
    } catch (reason) {
      setError(localizeError(reason, t, "settingsBackup.startError"));
    }
  };
  const restore = async (runId: string) => {
    const confirmation = window.prompt(t("settingsBackup.restorePrompt"));
    if (confirmation !== t("settingsBackup.restoreToken")) return;
    try {
      await backupSettingsService.restore(runId, confirmation);
      await load();
      notify("success", t("settingsBackup.restoreSubmitted"));
    } catch (reason) {
      setError(localizeError(reason, t, "settingsBackup.restoreError"));
    }
  };
  const testTarget = async (targetId: string) => {
    try {
      const result = await backupSettingsService.testTarget(targetId);
      notify(
        result.ok ? "success" : "danger",
        result.ok ? t("settingsBackup.connectionOk") : t("settingsBackup.connectionFailed"),
        result.message,
      );
      await load();
    } catch (reason) {
      setError(localizeError(reason, t, "settingsBackup.testError"));
    }
  };
  return (
    <div className="space-y-5">
      <SettingsSectionHeader
        title={t("settingsBackup.title")}
        description={t("settingsBackup.description")}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Card>
        <CardContent className="space-y-4 p-5">
          <h3 className="font-semibold">{t("settingsBackup.newTarget")}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label={t("settingsBackup.name")}
              value={target.name}
              disabled={!canWrite}
              onChange={(event) => setTarget({ ...target, name: event.target.value })}
            />
            <Select
              label={t("settingsBackup.type")}
              value={target.type}
              disabled={!canWrite}
              options={[
                { label: t("settingsBackup.local"), value: "LOCAL" },
                { label: "SMB", value: "SMB" },
                { label: "FTP / FTPS", value: "FTP" },
                { label: "WebDAV", value: "WEBDAV" },
                { label: "S3", value: "S3" },
              ]}
              onChange={(event) =>
                setTarget({
                  ...target,
                  type: event.target.value,
                  endpoint: event.target.value === "LOCAL" ? "/backups" : target.endpoint,
                })
              }
            />
            <Input
              label={t("settingsBackup.endpoint")}
              value={target.endpoint}
              disabled={!canWrite || target.type === "LOCAL"}
              onChange={(event) => setTarget({ ...target, endpoint: event.target.value })}
            />
            <Input
              label={t("settingsBackup.basePath")}
              value={target.basePath}
              disabled={!canWrite}
              onChange={(event) => setTarget({ ...target, basePath: event.target.value })}
            />
            <Input
              label={t("settingsBackup.secret")}
              type="password"
              value={target.secret}
              disabled={!canWrite}
              placeholder='{"username":"...","password":"..."}'
              onChange={(event) => setTarget({ ...target, secret: event.target.value })}
            />
          </div>
          <p className="text-xs text-muted">
            {target.type === "LOCAL"
              ? t("settingsBackup.localProtectionHint")
              : t("settingsBackup.remoteRecoveryHint")}
          </p>
          <Switch
            checked={target.encryptionEnabled}
            disabled={!canWrite}
            onChange={(event) => setTarget({ ...target, encryptionEnabled: event.target.checked })}
            label={t("settingsBackup.encrypt")}
            helperText={t("settingsBackup.encryptHelp")}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              loading={saving}
              disabled={
                !canWrite ||
                !target.name ||
                (target.type !== "LOCAL" && target.encryptionEnabled && !target.secret)
              }
              onClick={() => void createTarget()}
            >
              {t("settingsBackup.saveTarget")}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold">{t("settingsBackup.configuredTargets")}</h3>
          <div className="mt-3 space-y-2 text-sm">
            {snapshot?.targets.length ? (
              snapshot.targets.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
                >
                  <span>
                    {item.name} · {item.type} ·{" "}
                    {item.secretConfigured
                      ? t("settingsBackup.secretSet")
                      : t("settingsBackup.secretUnset")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!canWrite}
                    onClick={() => void testTarget(item.id)}
                  >
                    {t("settingsBackup.test")}
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-secondary">{t("settingsBackup.noTargets")}</p>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 p-5">
          <h3 className="font-semibold">{t("settingsBackup.newPlan")}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label={t("settingsBackup.planName")}
              value={plan.name}
              disabled={!canWrite}
              onChange={(event) => setPlan({ ...plan, name: event.target.value })}
            />
            <Select
              label={t("settingsBackup.source")}
              value={plan.source}
              disabled={!canWrite}
              options={[
                { label: t("settingsBackup.gallery"), value: "GALLERY" },
                { label: t("settingsBackup.database"), value: "DATABASE" },
              ]}
              onChange={(event) =>
                setPlan({
                  ...plan,
                  source: event.target.value,
                  mode: event.target.value === "DATABASE" ? "FULL" : plan.mode,
                })
              }
            />
            <Select
              label={t("settingsBackup.mode")}
              value={plan.mode}
              disabled={!canWrite || plan.source === "DATABASE"}
              options={[
                { label: t("settingsBackup.full"), value: "FULL" },
                { label: t("settingsBackup.incremental"), value: "INCREMENTAL" },
              ]}
              onChange={(event) => setPlan({ ...plan, mode: event.target.value })}
            />
            <Select
              label={t("settingsBackup.target")}
              value={plan.targetId}
              disabled={!canWrite}
              options={[
                { label: t("settingsBackup.choose"), value: "" },
                ...(snapshot?.targets ?? []).map((item) => ({ label: item.name, value: item.id })),
              ]}
              onChange={(event) => setPlan({ ...plan, targetId: event.target.value })}
            />
            <Input
              label="Cron"
              value={plan.cron}
              disabled={!canWrite}
              onChange={(event) => setPlan({ ...plan, cron: event.target.value })}
            />
            <Input
              label={t("settingsBackup.timezone")}
              value={plan.timezone}
              disabled={!canWrite}
              onChange={(event) => setPlan({ ...plan, timezone: event.target.value })}
            />
            <Input
              label={t("settingsBackup.retentionCount")}
              type="number"
              min={1}
              value={plan.retentionCount}
              disabled={!canWrite}
              onChange={(event) => setPlan({ ...plan, retentionCount: Number(event.target.value) })}
            />
            <Input
              label={t("settingsBackup.retentionDays")}
              type="number"
              min={1}
              value={plan.retentionDays}
              disabled={!canWrite}
              onChange={(event) => setPlan({ ...plan, retentionDays: Number(event.target.value) })}
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              loading={saving}
              disabled={!canWrite || !plan.name || !plan.targetId}
              onClick={() => void createPlan()}
            >
              {t("settingsBackup.savePlan")}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold">{t("settingsBackup.recentRuns")}</h3>
          <div className="mt-3 space-y-2 text-sm">
            {snapshot?.runs.length ? (
              snapshot.runs.map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap justify-between gap-2 border-b border-border py-2"
                >
                  <span>
                    {run.planName} ·{" "}
                    {run.source === "GALLERY"
                      ? t("settingsBackup.gallery")
                      : t("settingsBackup.database")}{" "}
                    ·{" "}
                    {run.mode === "FULL"
                      ? t("settingsBackup.full")
                      : t("settingsBackup.incremental")}
                  </span>
                  <span>{run.status}</span>
                </div>
              ))
            ) : (
              <p className="text-secondary">{t("settingsBackup.noRuns")}</p>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold">{t("settingsBackup.planOperations")}</h3>
          <div className="mt-3 space-y-2 text-sm">
            {snapshot?.plans.length ? (
              snapshot.plans.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
                >
                  <span>
                    {item.name} ·{" "}
                    {item.source === "GALLERY"
                      ? t("settingsBackup.gallery")
                      : t("settingsBackup.database")}{" "}
                    · {item.cron}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canWrite}
                    onClick={() => void runNow(item.id)}
                  >
                    {t("settingsBackup.runNow")}
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-secondary">{t("settingsBackup.noPlans")}</p>
            )}
          </div>
          <div className="mt-4 space-y-2 text-sm">
            {snapshot?.runs
              .filter((run) => run.status === "SUCCEEDED")
              .slice(0, 5)
              .map((run) => (
                <div key={`restore-${run.id}`} className="flex items-center justify-between gap-2">
                  <span>
                    {t("settingsBackup.restorePrefix")}
                    {run.planName} · {run.createdAt.slice(0, 16).replace("T", " ")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!canWrite}
                    onClick={() => void restore(run.id)}
                  >
                    {t("settingsBackup.restore")}
                  </Button>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
