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
        "单位通知配置加载失败",
        reason instanceof Error ? reason.message : "请稍后重试",
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
      notify("danger", "通知规则无法保存", "每类事件至少需要保留一个通知渠道。 ");
      return;
    }
    if (!selectedUnitId) {
      notify("danger", "请选择运行单位", "超级管理员必须明确选择要维护的单位。");
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
      notify("success", "通知规则已保存", "新的路由只影响后续产生的通知。 ");
    } catch (reason) {
      notify("danger", "通知规则保存失败", reason instanceof Error ? reason.message : "请稍后重试");
    } finally {
      setSavingRoutes(false);
    }
  };

  const toggleBuiltIn = async (enabled: boolean) => {
    if (!selectedUnitId) {
      notify("danger", "请选择运行单位", "超级管理员必须明确选择要维护的单位。");
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
      notify("success", enabled ? "站内通知已启用" : "站内通知已停用");
    } catch (reason) {
      notify("danger", "渠道状态更新失败", reason instanceof Error ? reason.message : "请稍后重试");
    }
  };

  const saveConfig = async () => {
    if (!configDraft || (configDraft.key !== "feishu" && configDraft.key !== "sms")) return;
    if (configDraft.enabled && !configDraft.endpoint.trim()) {
      notify("danger", "渠道配置不完整", "启用外部渠道前必须填写 Webhook 地址。 ");
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
        `${saved.label}配置已保存`,
        newSecret ? "新密钥已加密保存，原文不会再次显示。" : "现有密钥保持不变。 ",
      );
    } catch (reason) {
      notify("danger", "渠道配置保存失败", reason instanceof Error ? reason.message : "请稍后重试");
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
        result.ok ? "连接测试成功" : "连接测试失败",
        result.message,
      );
    } catch (reason) {
      notify(
        "danger",
        "连接测试失败",
        reason instanceof Error ? reason.message : "请检查网络和服务地址",
      );
    } finally {
      setTestingKey(null);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="notification-settings-title">
      <SettingsSectionHeader
        title="通知设置"
        description="配置飞书、短信和站内通知渠道，并为审核、资质预警和升级计划选择送达方式。"
      />

      <Select
        label="通知配置单位"
        required
        value={selectedUnitId}
        onChange={(event) => void selectUnit(event.target.value)}
        options={[
          ...(isSuperAdmin ? [{ value: "", label: "请选择运行单位" }] : []),
          ...units
            .filter((unit) => unit.active)
            .map((unit) => ({ value: unit.id, label: unit.name })),
        ]}
      />

      {!canWriteSecrets ? (
        <Alert tone="info" title="密钥由超级管理员维护">
          你可以修改所属单位的通知路由，但不能查看或替换外部渠道密钥。
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
                    <dt className="text-muted">渠道状态</dt>
                    <dd className="mt-1 font-medium">{item.enabled ? "已启用" : "已停用"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">最近测试</dt>
                    <dd className="mt-1 font-medium">{formatSettingsDate(item.lastTestAt)}</dd>
                  </div>
                  {external ? (
                    <div>
                      <dt className="text-muted">认证密钥</dt>
                      <dd className="mt-1 font-medium">
                        {item.secretConfigured ? "•••••••• 已配置" : "未配置"}
                      </dd>
                    </div>
                  ) : null}
                  {external ? (
                    <div>
                      <dt className="text-muted">失败重试</dt>
                      <dd className="mt-1 font-medium">最多 {item.retryLimit} 次</dd>
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
                      配置
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
                      测试连接
                    </Button>
                  </div>
                ) : (
                  <Switch
                    label="启用站内通知"
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
            <h3 className="font-bold">通知路由规则</h3>
            <p className="mt-1 text-xs text-muted">
              每类事件至少选择一个渠道；停用渠道不会收到新任务。
            </p>
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
                保存通知规则
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(configKey)} onOpenChange={(open) => !open && setConfigKey(null)}>
        <DialogContent aria-describedby="channel-config-description">
          <DialogTitle className="text-lg font-bold">
            配置{configDraft?.label ?? "通知渠道"}
          </DialogTitle>
          <DialogDescription
            id="channel-config-description"
            className="mt-1 text-sm text-secondary"
          >
            密钥由服务端加密保存，保存后无法查看或复制原文。
          </DialogDescription>
          {configDraft ? (
            <div className="mt-5 space-y-4">
              <Switch
                label={`启用${configDraft.label}`}
                checked={configDraft.enabled}
                onChange={(event) =>
                  setConfigDraft({ ...configDraft, enabled: event.target.checked })
                }
              />
              <Input
                label="Webhook 地址"
                required={configDraft.enabled}
                value={configDraft.endpoint}
                onChange={(event) =>
                  setConfigDraft({ ...configDraft, endpoint: event.target.value })
                }
              />
              <Input
                label="认证 Token"
                type="password"
                placeholder={
                  configDraft.secretConfigured ? "•••••••• 已配置；留空表示保留" : "输入认证 Token"
                }
                helperText="输入新值会替换现有密钥；留空不会清除。"
                value={newSecret}
                onChange={(event) => setNewSecret(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="请求超时（秒）"
                  type="number"
                  min={1}
                  max={60}
                  value={configDraft.timeoutSeconds}
                  onChange={(event) =>
                    setConfigDraft({ ...configDraft, timeoutSeconds: Number(event.target.value) })
                  }
                />
                <Input
                  label="最大重试次数"
                  type="number"
                  min={0}
                  max={10}
                  value={configDraft.retryLimit}
                  onChange={(event) =>
                    setConfigDraft({ ...configDraft, retryLimit: Number(event.target.value) })
                  }
                />
              </div>
              {newSecret ? (
                <Alert tone="warning">保存后无法再次查看密钥原文，请确认已安全备份。</Alert>
              ) : null}
            </div>
          ) : null}
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setConfigKey(null)}>
              取消
            </Button>
            <Button type="button" loading={savingConfig} onClick={() => void saveConfig()}>
              保存渠道配置
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
