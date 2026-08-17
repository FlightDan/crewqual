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

const emptyTarget = {
  name: "",
  type: "LOCAL",
  endpoint: "/var/backups/crewqual",
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
        .catch((reason) => setError(reason instanceof Error ? reason.message : "备份设置加载失败")),
    [],
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
      notify("success", "备份目标已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "备份目标保存失败");
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
      notify("success", "备份计划已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "备份计划保存失败");
    } finally {
      setSaving(false);
    }
  };
  const runNow = async (planId: string) => {
    try {
      await backupSettingsService.runNow(planId);
      await load();
      notify("success", "备份已加入队列");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "备份启动失败");
    }
  };
  const restore = async (runId: string) => {
    const confirmation = window.prompt("这是破坏性操作，请输入：恢复");
    if (confirmation !== "恢复") return;
    try {
      await backupSettingsService.restore(runId, confirmation);
      await load();
      notify("success", "恢复任务已提交");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复失败");
    }
  };
  const testTarget = async (targetId: string) => {
    try {
      const result = await backupSettingsService.testTarget(targetId);
      notify(
        result.ok ? "success" : "danger",
        result.ok ? "目标连接成功" : "目标连接失败",
        result.message,
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "目标测试失败");
    }
  };
  return (
    <div className="space-y-5">
      <SettingsSectionHeader
        title="备份与恢复"
        description="图库和数据库分别配置备份计划，支持本地、SMB、FTP/FTPS、WebDAV 和 S3 目标。数据库当前只允许全量备份。"
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Card>
        <CardContent className="space-y-4 p-5">
          <h3 className="font-semibold">新增备份目标</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="名称"
              value={target.name}
              disabled={!canWrite}
              onChange={(event) => setTarget({ ...target, name: event.target.value })}
            />
            <Select
              label="类型"
              value={target.type}
              disabled={!canWrite}
              options={[
                { label: "本地", value: "LOCAL" },
                { label: "SMB", value: "SMB" },
                { label: "FTP / FTPS", value: "FTP" },
                { label: "WebDAV", value: "WEBDAV" },
                { label: "S3", value: "S3" },
              ]}
              onChange={(event) => setTarget({ ...target, type: event.target.value })}
            />
            <Input
              label="端点 / 本地目录"
              value={target.endpoint}
              disabled={!canWrite}
              onChange={(event) => setTarget({ ...target, endpoint: event.target.value })}
            />
            <Input
              label="目标目录"
              value={target.basePath}
              disabled={!canWrite}
              onChange={(event) => setTarget({ ...target, basePath: event.target.value })}
            />
            <Input
              label="账号与密钥 JSON（可选）"
              type="password"
              value={target.secret}
              disabled={!canWrite}
              placeholder='{"username":"...","password":"..."}'
              onChange={(event) => setTarget({ ...target, secret: event.target.value })}
            />
          </div>
          <Switch
            checked={target.encryptionEnabled}
            disabled={!canWrite}
            onChange={(event) => setTarget({ ...target, encryptionEnabled: event.target.checked })}
            label="备份文件加密"
            helperText="关闭前请确认目标存储可信；密钥只保存加密后的密文。"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              loading={saving}
              disabled={!canWrite || !target.name || (target.encryptionEnabled && !target.secret)}
              onClick={() => void createTarget()}
            >
              保存目标
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold">已配置目标</h3>
          <div className="mt-3 space-y-2 text-sm">
            {snapshot?.targets.length ? (
              snapshot.targets.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
                >
                  <span>
                    {item.name} · {item.type} ·{" "}
                    {item.secretConfigured ? "已配置密钥" : "未配置密钥"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!canWrite}
                    onClick={() => void testTarget(item.id)}
                  >
                    测试连接
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-secondary">暂无备份目标</p>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 p-5">
          <h3 className="font-semibold">新增备份计划</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="计划名称"
              value={plan.name}
              disabled={!canWrite}
              onChange={(event) => setPlan({ ...plan, name: event.target.value })}
            />
            <Select
              label="数据源"
              value={plan.source}
              disabled={!canWrite}
              options={[
                { label: "图库", value: "GALLERY" },
                { label: "数据库", value: "DATABASE" },
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
              label="模式"
              value={plan.mode}
              disabled={!canWrite || plan.source === "DATABASE"}
              options={[
                { label: "全量", value: "FULL" },
                { label: "增量", value: "INCREMENTAL" },
              ]}
              onChange={(event) => setPlan({ ...plan, mode: event.target.value })}
            />
            <Select
              label="备份目标"
              value={plan.targetId}
              disabled={!canWrite}
              options={[
                { label: "请选择", value: "" },
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
              label="时区"
              value={plan.timezone}
              disabled={!canWrite}
              onChange={(event) => setPlan({ ...plan, timezone: event.target.value })}
            />
            <Input
              label="最多保留份数"
              type="number"
              min={1}
              value={plan.retentionCount}
              disabled={!canWrite}
              onChange={(event) => setPlan({ ...plan, retentionCount: Number(event.target.value) })}
            />
            <Input
              label="最长保留天数"
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
              保存计划
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold">最近运行</h3>
          <div className="mt-3 space-y-2 text-sm">
            {snapshot?.runs.length ? (
              snapshot.runs.map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap justify-between gap-2 border-b border-border py-2"
                >
                  <span>
                    {run.planName} · {run.source === "GALLERY" ? "图库" : "数据库"} ·{" "}
                    {run.mode === "FULL" ? "全量" : "增量"}
                  </span>
                  <span>{run.status}</span>
                </div>
              ))
            ) : (
              <p className="text-secondary">暂无运行记录</p>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold">计划与操作</h3>
          <div className="mt-3 space-y-2 text-sm">
            {snapshot?.plans.length ? (
              snapshot.plans.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
                >
                  <span>
                    {item.name} · {item.source === "GALLERY" ? "图库" : "数据库"} · {item.cron}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canWrite}
                    onClick={() => void runNow(item.id)}
                  >
                    立即备份
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-secondary">暂无备份计划</p>
            )}
          </div>
          <div className="mt-4 space-y-2 text-sm">
            {snapshot?.runs
              .filter((run) => run.status === "SUCCEEDED")
              .slice(0, 5)
              .map((run) => (
                <div key={`restore-${run.id}`} className="flex items-center justify-between gap-2">
                  <span>
                    恢复：{run.planName} · {run.createdAt.slice(0, 16).replace("T", " ")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!canWrite}
                    onClick={() => void restore(run.id)}
                  >
                    恢复
                  </Button>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
