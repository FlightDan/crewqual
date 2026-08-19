"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/choice";
import { Alert } from "@/components/ui/alert";
import {
  SettingsSectionHeader,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { adminSettingsService } from "@/services/admin-settings-service";
import type { MediaOptimizationSetting } from "@/types/admin-settings";
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";

export function MediaOptimizationSection({
  canWrite,
  notify,
}: {
  canWrite: boolean;
  notify: SettingsFeedback;
}) {
  const { t } = useI18n();
  const [setting, setSetting] = React.useState<MediaOptimizationSetting | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    void adminSettingsService
      .loadMediaOptimization()
      .then(setSetting)
      .catch((reason) => setError(localizeError(reason, t, "settingsMedia.loadError")))
      .finally(() => setLoading(false));
  }, [t]);
  const save = async () => {
    if (!setting) return;
    setSaving(true);
    try {
      const next = await adminSettingsService.saveMediaOptimization(setting);
      setSetting(next);
      notify(
        "success",
        t("settingsMedia.saved"),
        next.enabled ? t("settingsMedia.enabledNotice") : t("settingsMedia.disabledNotice"),
      );
    } catch (reason) {
      notify("danger", t("settingsMedia.saveError"), localizeError(reason, t));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-5">
      <SettingsSectionHeader
        title={t("settingsMedia.title")}
        description={t("settingsMedia.description")}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Card>
        <CardContent className="space-y-5 p-5">
          {loading || !setting ? (
            <p className="text-sm text-secondary">{t("settingsMedia.loading")}</p>
          ) : (
            <>
              <Switch
                checked={setting.enabled}
                disabled={!canWrite}
                onChange={(event) => setSetting({ ...setting, enabled: event.target.checked })}
                label={t("settingsMedia.toggle")}
                helperText={t("settingsMedia.toggleHelp")}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={t("settingsMedia.idleMinutes")}
                  type="number"
                  min={1}
                  max={1440}
                  value={setting.idleMinutes}
                  disabled={!canWrite}
                  onChange={(event) =>
                    setSetting({ ...setting, idleMinutes: Number(event.target.value) || 5 })
                  }
                />
                <Input
                  label={t("settingsMedia.batchSize")}
                  type="number"
                  min={1}
                  max={20}
                  value={setting.batchSize}
                  disabled={!canWrite}
                  onChange={(event) =>
                    setSetting({ ...setting, batchSize: Number(event.target.value) || 5 })
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  loading={saving}
                  disabled={!canWrite}
                  onClick={() => void save()}
                >
                  {t("settingsMedia.save")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
