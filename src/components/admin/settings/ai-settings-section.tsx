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
  const [draft, setDraft] = React.useState(ai);
  const [newSecret, setNewSecret] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => setDraft(ai), [ai]);

  const save = async () => {
    if (draft.enabled && (!draft.endpoint.trim() || !draft.model.trim())) {
      notify("danger", "AI/OCR 配置不完整", "启用服务前必须填写服务地址和模型名称。 ");
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
        "AI/OCR 配置已保存",
        newSecret ? "新 API Key 已加密保存，原文不会再次显示。" : "现有 API Key 保持不变。",
      );
    } catch (reason) {
      notify(
        "danger",
        "AI/OCR 配置保存失败",
        reason instanceof Error ? reason.message : "请稍后重试",
      );
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
        result.ok ? "AI 服务连接正常" : "AI 服务连接失败",
        result.message,
      );
    } catch (reason) {
      notify(
        "danger",
        "AI 服务连接失败",
        reason instanceof Error ? reason.message : "请检查服务地址和网络",
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="ai-settings-title">
      <SettingsSectionHeader
        title="AI 与系统集成"
        description="配置证照识别辅助服务，并检查数据库、对象存储和后台任务的运行状态。"
      />

      <Alert tone="info" title="AI 只提供识别与核验辅助">
        AI/OCR 不产生自动审批决定。所有资质审核仍必须由管理员人工确认。
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-md bg-violet-50 text-violet-600">
              <BrainCircuit aria-hidden="true" className="size-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold">证照 AI/OCR 辅助服务</h3>
                <ConnectionBadge status={draft.status} />
              </div>
              <p className="mt-1 text-xs text-muted">
                最近测试：{formatSettingsDate(draft.lastTestAt)} · {draft.lastTestMessage}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!canWrite ? <Alert tone="info">当前角色只能查看 AI/OCR 配置状态。</Alert> : null}
          <div className="rounded-md border border-border p-3">
            <Switch
              label="启用证照识别辅助"
              checked={draft.enabled}
              disabled={!canWrite}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              helperText="停用后，飞行员仍可手动填写并提交资质更新。"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="服务地址"
              required={draft.enabled}
              placeholder="https://ai.example.com/v1"
              value={draft.endpoint}
              disabled={!canWrite}
              onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })}
            />
            <Input
              label="模型名称"
              required={draft.enabled}
              placeholder="Qwen3.7-35B"
              value={draft.model}
              disabled={!canWrite}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            />
            <Input
              label="API Key"
              type="password"
              placeholder={
                draft.secretConfigured ? "•••••••• 已配置；留空表示保留" : "输入 API Key"
              }
              helperText="现有密钥永不回显；输入新值会替换旧密钥。"
              value={newSecret}
              disabled={!canWrite}
              onChange={(event) => setNewSecret(event.target.value)}
            />
            <Input
              label="请求超时（秒）"
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
          {newSecret ? (
            <Alert tone="warning">保存后无法再次查看 API Key 原文，请确认已安全备份。</Alert>
          ) : null}
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
                测试连接
              </Button>
              <Button type="button" loading={saving} onClick={() => void save()}>
                保存 AI/OCR 配置
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div>
        <h3 className="font-bold">基础设施状态</h3>
        <p className="mt-1 text-xs text-muted">基础设施凭据只能通过服务器环境或密钥管理器维护。</p>
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
                  检查于 {formatSettingsDate(item.checkedAt)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
