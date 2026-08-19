"use client";

import * as React from "react";
import { Bell, Send, Smartphone, Wrench } from "lucide-react";
import {
  ConnectionBadge,
  SettingsSectionHeader,
  formatSettingsDate,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox, Switch } from "@/components/ui/choice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adminSettingsService } from "@/services/admin-settings-service";
import type {
  NotificationChannelKey,
  NotificationChannelSetting,
  NotificationRoute,
  SettingsUnit,
} from "@/types/admin-settings";
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";

const channelIcons = {
  feishu: Send,
  sms: Smartphone,
  inApp: Bell,
} as const;

export function NotificationSettingsSection({
  channels,
  routes,
  units,
  initialUnitId,
  isSuperAdmin,
  canWriteRoutes,
  canWriteSecrets,
  onChannelsChange,
  onRoutesChange,
  notify,
}: {
  channels: NotificationChannelSetting[];
  routes: NotificationRoute[];
  units: SettingsUnit[];
  initialUnitId?: string | null;
  isSuperAdmin: boolean;
  canWriteRoutes: boolean;
  canWriteSecrets: boolean;
  onChannelsChange: (channels: NotificationChannelSetting[]) => void;
  onRoutesChange: (routes: NotificationRoute[]) => void;
  notify: SettingsFeedback;
}) {
  const { t } = useI18n();
  const [routeDraft, setRouteDraft] = React.useState(routes);
  const [selectedUnitId, setSelectedUnitId] = React.useState(
    initialUnitId ?? (isSuperAdmin ? "" : (units[0]?.id ?? "")),
  );
  const [savingRoutes, setSavingRoutes] = React.useState(false);
  const [configKey, setConfigKey] = React.useState<"feishu" | "sms" | null>(null);
  const channel = channels.find((item) => item.key === configKey) ?? null;
  const [configDraft, setConfigDraft] = React.useState<NotificationChannelSetting | null>(null);
  const [newSecret, setNewSecret] = React.useState("");
  const [savingConfig, setSavingConfig] = React.useState(false);
  const [testingKey, setTestingKey] = React.useState<string | null>(null);

  React.useEffect(() => setRouteDraft(routes), [routes]);
  React.useEffect(() => {
    setConfigDraft(channel ? { ...channel } : null);
    setNewSecret("");
  }, [channel]);

  const selectUnit = async (unitId: string) => {
    setSelectedUnitId(unitId);
    if (!unitId) return;
    try {
      const snapshot = await adminSettingsService.load(unitId);
      setRouteDraft(snapshot.notificationRoutes);
      onRoutesChange(snapshot.notificationRoutes);
      onChannelsChange(snapshot.notificationChannels);
    } catch (reason) {
      notify(
        "danger",
        t("settingsNotify.loadError"),
        localizeError(reason, t, "settingsNotify.loadRetry"),
      );
    }
  };

  const setRouteChannel = (
    routeKey: string,
    channelKey: NotificationChannelKey,
    checked: boolean,
  ) => {
    setRouteDraft((current) =>
      current.map((route) =>
        route.key === routeKey
          ? {
              ...route,
              channels: checked
                ? [...new Set([...route.channels, channelKey])]
                : route.channels.filter((item) => item !== channelKey),
            }
          : route,
      ),
    );
  };

  const saveRoutes = async () => {
    if (routeDraft.some((route) => route.channels.length === 0)) {
      notify("danger", t("settingsNotify.rulesInvalid"), t("settingsNotify.rulesRequired"));
      return;
    }
    if (!selectedUnitId) {
      notify("danger", t("settingsNotify.unitRequired"), t("settingsNotify.unitRequiredHelp"));
      return;
    }
    setSavingRoutes(true);
    try {
      const result = await adminSettingsService.saveNotifications({
        unitId: selectedUnitId,
        channels,
        routes: routeDraft,
      });
      onRoutesChange(result.routes);
      onChannelsChange(result.channels);
      notify("success", t("settingsNotify.rulesSaved"), t("settingsNotify.rulesSavedHelp"));
    } catch (reason) {
      notify(
        "danger",
        t("settingsNotify.rulesSaveError"),
        localizeError(reason, t, "settingsNotify.loadRetry"),
      );
    } finally {
      setSavingRoutes(false);
    }
  };

  const toggleBuiltIn = async (enabled: boolean) => {
    if (!selectedUnitId) {
      notify("danger", t("settingsNotify.unitRequired"), t("settingsNotify.unitRequiredHelp"));
      return;
    }
    const nextChannels = channels.map((item) =>
      item.key === "inApp" ? { ...item, enabled } : item,
    );
    try {
      const result = await adminSettingsService.saveNotifications({
        unitId: selectedUnitId,
        channels: nextChannels,
        routes,
      });
      onChannelsChange(result.channels);
      notify(
        "success",
        enabled ? t("settingsNotify.inAppEnabled") : t("settingsNotify.inAppDisabled"),
      );
    } catch (reason) {
      notify(
        "danger",
        t("settingsNotify.channelUpdateError"),
        localizeError(reason, t, "settingsNotify.loadRetry"),
      );
    }
  };

  const saveConfig = async () => {
    if (!configDraft || (configDraft.key !== "feishu" && configDraft.key !== "sms")) return;
    if (configDraft.enabled && !configDraft.endpoint.trim()) {
      notify("danger", t("settingsNotify.incomplete"), t("settingsNotify.endpointRequired"));
      return;
    }
    setSavingConfig(true);
    try {
      const saved = (await adminSettingsService.saveIntegration({
        ...configDraft,
        key: configDraft.key,
        newSecret: newSecret || undefined,
      })) as NotificationChannelSetting;
      onChannelsChange(channels.map((item) => (item.key === saved.key ? saved : item)));
      setConfigKey(null);
      notify(
        "success",
        t("settingsNotify.configSaved", { channel: saved.label }),
        newSecret ? t("settingsNotify.newSecretSaved") : t("settingsNotify.secretKept"),
      );
    } catch (reason) {
      notify(
        "danger",
        t("settingsNotify.configSaveError"),
        localizeError(reason, t, "settingsNotify.loadRetry"),
      );
    } finally {
      setSavingConfig(false);
    }
  };

  const test = async (key: "feishu" | "sms") => {
    setTestingKey(key);
    try {
      const result = await adminSettingsService.testIntegration(key);
      const next = channels.map((item) =>
        item.key === key
          ? {
              ...item,
              status: result.ok ? ("connected" as const) : ("error" as const),
              lastTestAt: result.testedAt,
              lastTestMessage: result.message,
            }
          : item,
      );
      onChannelsChange(next);
      notify(
        result.ok ? "success" : "danger",
        result.ok ? t("settingsNotify.connectionOk") : t("settingsNotify.connectionFailed"),
        result.message,
      );
    } catch (reason) {
      notify(
        "danger",
        t("settingsNotify.connectionFailed"),
        localizeError(reason, t, "settingsNotify.networkHelp"),
      );
    } finally {
      setTestingKey(null);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="notification-settings-title">
      <SettingsSectionHeader
        title={t("settingsNotify.title")}
        description={t("settingsNotify.description")}
      />

      <Select
        label={t("settingsNotify.unit")}
        required
        value={selectedUnitId}
        onChange={(event) => void selectUnit(event.target.value)}
        options={[
          ...(isSuperAdmin ? [{ value: "", label: t("settingsNotify.chooseUnit") }] : []),
          ...units
            .filter((unit) => unit.active)
            .map((unit) => ({ value: unit.id, label: unit.name })),
        ]}
      />

      {!canWriteSecrets ? (
        <Alert tone="info" title={t("settingsNotify.secretOwner")}>
          {t("settingsNotify.secretReadonly")}
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        {channels.map((item) => {
          const Icon = channelIcons[item.key];
          const external = item.key !== "inApp";
          return (
            <Card key={item.key}>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start gap-3">
                  <span className="inline-flex size-10 items-center justify-center rounded-md bg-blue-50 text-brand">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold">{item.label}</h3>
                      <ConnectionBadge status={item.status} />
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted">{item.lastTestMessage}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted">{t("settingsNotify.channelStatus")}</dt>
                    <dd className="mt-1 font-medium">
                      {item.enabled ? t("settingsNotify.enabled") : t("settingsNotify.disabled")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("settingsNotify.lastTest")}</dt>
                    <dd className="mt-1 font-medium">{formatSettingsDate(item.lastTestAt)}</dd>
                  </div>
                  {external ? (
                    <div>
                      <dt className="text-muted">{t("settingsNotify.secret")}</dt>
                      <dd className="mt-1 font-medium">
                        {item.secretConfigured
                          ? t("settingsNotify.secretConfigured")
                          : t("settingsNotify.notConfigured")}
                      </dd>
                    </div>
                  ) : null}
                  {external ? (
                    <div>
                      <dt className="text-muted">{t("settingsNotify.retry")}</dt>
                      <dd className="mt-1 font-medium">
                        {t("settingsNotify.retryCount", { count: item.retryLimit })}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {external ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      disabled={!canWriteSecrets}
                      onClick={() => setConfigKey(item.key as "feishu" | "sms")}
                    >
                      <Wrench aria-hidden="true" className="size-4" />
                      {t("settingsNotify.configure")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="flex-1"
                      loading={testingKey === item.key}
                      disabled={!canWriteSecrets || !item.enabled}
                      onClick={() => void test(item.key as "feishu" | "sms")}
                    >
                      {t("settingsNotify.test")}
                    </Button>
                  </div>
                ) : (
                  <Switch
                    label={t("settingsNotify.enableInApp")}
                    checked={item.enabled}
                    disabled={!canWriteRoutes}
                    onChange={(event) => void toggleBuiltIn(event.target.checked)}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div>
            <h3 className="font-bold">{t("settingsNotify.routes")}</h3>
            <p className="mt-1 text-xs text-muted">{t("settingsNotify.routesDescription")}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {routeDraft.map((route) => (
            <div
              key={route.key}
              className="grid gap-3 rounded-md border border-border p-4 lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-center"
            >
              <div>
                <p className="font-semibold text-primary">{route.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted">{route.description}</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {channels.map((channelItem) => (
                  <Checkbox
                    key={channelItem.key}
                    label={channelItem.label}
                    checked={route.channels.includes(channelItem.key)}
                    disabled={!canWriteRoutes || !channelItem.enabled}
                    onChange={(event) =>
                      setRouteChannel(route.key, channelItem.key, event.target.checked)
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          {canWriteRoutes ? (
            <div className="flex justify-end pt-2">
              <Button type="button" loading={savingRoutes} onClick={() => void saveRoutes()}>
                {t("settingsNotify.saveRoutes")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(configKey)} onOpenChange={(open) => !open && setConfigKey(null)}>
        <DialogContent aria-describedby="channel-config-description">
          <DialogTitle className="text-lg font-bold">
            {t("settingsNotify.configureTitle", {
              channel: configDraft?.label ?? t("settingsNotify.configureDefault"),
            })}
          </DialogTitle>
          <DialogDescription
            id="channel-config-description"
            className="mt-1 text-sm text-secondary"
          >
            {t("settingsNotify.configureDescription")}
          </DialogDescription>
          {configDraft ? (
            <div className="mt-5 space-y-4">
              <Switch
                label={t("settingsNotify.enableChannel", { channel: configDraft.label })}
                checked={configDraft.enabled}
                onChange={(event) =>
                  setConfigDraft({ ...configDraft, enabled: event.target.checked })
                }
              />
              <Input
                label={t("settingsNotify.webhook")}
                required={configDraft.enabled}
                value={configDraft.endpoint}
                onChange={(event) =>
                  setConfigDraft({ ...configDraft, endpoint: event.target.value })
                }
              />
              <Input
                label={t("settingsNotify.token")}
                type="password"
                placeholder={
                  configDraft.secretConfigured
                    ? t("settingsNotify.tokenConfigured")
                    : t("settingsNotify.tokenInput")
                }
                helperText={t("settingsNotify.tokenHelp")}
                value={newSecret}
                onChange={(event) => setNewSecret(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t("settingsNotify.timeout")}
                  type="number"
                  min={1}
                  max={60}
                  value={configDraft.timeoutSeconds}
                  onChange={(event) =>
                    setConfigDraft({ ...configDraft, timeoutSeconds: Number(event.target.value) })
                  }
                />
                <Input
                  label={t("settingsNotify.maxRetry")}
                  type="number"
                  min={0}
                  max={10}
                  value={configDraft.retryLimit}
                  onChange={(event) =>
                    setConfigDraft({ ...configDraft, retryLimit: Number(event.target.value) })
                  }
                />
              </div>
              {newSecret ? <Alert tone="warning">{t("settingsNotify.secretWarning")}</Alert> : null}
            </div>
          ) : null}
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setConfigKey(null)}>
              {t("settingsNotify.cancel")}
            </Button>
            <Button type="button" loading={savingConfig} onClick={() => void saveConfig()}>
              {t("settingsNotify.saveConfig")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
