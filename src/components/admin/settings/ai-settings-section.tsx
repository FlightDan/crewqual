"use client";

import * as React from "react";
import { BrainCircuit, Database, HardDrive, ListChecks, RefreshCw, ServerCog } from "lucide-react";
import {
  ConnectionBadge,
  SettingsSectionHeader,
  formatSettingsDate,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { adminSettingsService } from "@/services/admin-settings-service";
import type { AiIntegrationSetting, SystemHealthItem } from "@/types/admin-settings";
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";

const healthIcons = {
  database: Database,
  storage: HardDrive,
  worker: ServerCog,
  queue: ListChecks,
} as const;

export function AiSettingsSection({
  ai,
  health,
  canWrite,
  onAiChange,
  notify,
}: {
  ai: AiIntegrationSetting;
  health: SystemHealthItem[];
  canWrite: boolean;
  onAiChange: (ai: AiIntegrationSetting) => void;
  notify: SettingsFeedback;
}) {
  const { locale, t } = useI18n();
  const [draft, setDraft] = React.useState(ai);
  const [newSecret, setNewSecret] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => setDraft(ai), [ai]);

  const save = async () => {
    if (draft.enabled && (!draft.endpoint.trim() || !draft.model.trim())) {
      notify("danger", t("settings.ai.service"), t("settings.ai.endpoint"));
      return;
    }
    setSaving(true);
    try {
      const saved = (await adminSettingsService.saveIntegration({
        ...draft,
        key: "vlm",
        newSecret: newSecret || undefined,
      })) as AiIntegrationSetting;
      onAiChange(saved);
      setNewSecret("");
      notify(
        "success",
        t("settings.ai.saved"),
        newSecret ? t("settings.ai.secretWarning") : t("settings.ai.secretHelp"),
      );
    } catch (reason) {
      notify("danger", t("settings.ai.service"), localizeError(reason, t));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await adminSettingsService.testIntegration("vlm");
      const updated: AiIntegrationSetting = {
        ...draft,
        status: result.ok ? "connected" : "error",
        lastTestAt: result.testedAt,
        lastTestMessage: result.message,
      };
      setDraft(updated);
      onAiChange(updated);
      notify(
        result.ok ? "success" : "danger",
        result.ok ? t("settings.status.connected") : t("settings.status.error"),
        result.message,
      );
    } catch (reason) {
      notify("danger", t("settings.status.error"), localizeError(reason, t, "errors.network"));
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="ai-settings-title">
      <SettingsSectionHeader
        title={t("settings.ai.title")}
        description={t("settings.ai.description")}
      />

      <Alert tone="info" title={t("settings.ai.noticeTitle")}>
        {t("settings.ai.notice")}
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-md bg-violet-50 text-violet-600">
              <BrainCircuit aria-hidden="true" className="size-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold">{t("settings.ai.service")}</h3>
                <ConnectionBadge status={draft.status} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {t("settings.ai.lastTest", {
                  date: formatSettingsDate(draft.lastTestAt, locale),
                  message: draft.lastTestMessage,
                })}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!canWrite ? <Alert tone="info">{t("settings.ai.readOnly")}</Alert> : null}
          <div className="rounded-md border border-border p-3">
            <Switch
              label={t("settings.ai.enable")}
              checked={draft.enabled}
              disabled={!canWrite}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              helperText={t("settings.ai.enableHelp")}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label={t("settings.ai.endpoint")}
              required={draft.enabled}
              placeholder="https://ai.example.com/v1"
              value={draft.endpoint}
              disabled={!canWrite}
              onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })}
            />
            <Input
              label={t("settings.ai.model")}
              required={draft.enabled}
              placeholder="Qwen3.7-35B"
              value={draft.model}
              disabled={!canWrite}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            />
            <Input
              label={t("settings.ai.apiKey")}
              type="password"
              placeholder={
                draft.secretConfigured
                  ? t("settings.ai.secretConfigured")
                  : t("settings.ai.enterApiKey")
              }
              helperText={t("settings.ai.secretHelp")}
              value={newSecret}
              disabled={!canWrite}
              onChange={(event) => setNewSecret(event.target.value)}
            />
            <Input
              label={t("settings.ai.timeout")}
              type="number"
              min={10}
              max={300}
              value={draft.timeoutSeconds}
              disabled={!canWrite}
              onChange={(event) =>
                setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })
              }
            />
          </div>
          {newSecret ? <Alert tone="warning">{t("settings.ai.secretWarning")}</Alert> : null}
          {canWrite ? (
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                loading={testing}
                disabled={!draft.enabled}
                onClick={() => void test()}
              >
                <RefreshCw aria-hidden="true" className="size-4" />
                {t("settings.ai.test")}
              </Button>
              <Button type="button" loading={saving} onClick={() => void save()}>
                {t("settings.ai.save")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div>
        <h3 className="font-bold">{t("settings.ai.infrastructure")}</h3>
        <p className="mt-1 text-xs text-muted">{t("settings.ai.infrastructureHelp")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {health.map((item) => {
          const Icon = healthIcons[item.key];
          return (
            <Card key={item.key}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex size-9 items-center justify-center rounded-md bg-slate-100 text-secondary">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <ConnectionBadge status={item.status} />
                </div>
                <div>
                  <p className="font-semibold">{item.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{item.detail}</p>
                </div>
                <p className="text-[11px] text-muted">
                  {t("settings.ai.checkedAt", { date: formatSettingsDate(item.checkedAt, locale) })}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
