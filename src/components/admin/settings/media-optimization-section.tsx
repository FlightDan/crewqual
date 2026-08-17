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

export function MediaOptimizationSection({
  canWrite,
  notify,
}: {
  canWrite: boolean;
  notify: SettingsFeedback;
}) {
  const [setting, setSetting] = React.useState<MediaOptimizationSetting | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    void adminSettingsService
      .loadMediaOptimization()
      .then(setSetting)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "图库优化设置加载失败"),
      )
      .finally(() => setLoading(false));
  }, []);
  const save = async () => {
    if (!setting) return;
    setSaving(true);
    try {
      const next = await adminSettingsService.saveMediaOptimization(setting);
      setSetting(next);
      notify(
        "success",
        "图库优化设置已保存",
        next.enabled ? "后台会在识别队列空闲时转换 JPEG。" : "后台不会自动转换图片。",
      );
    } catch (reason) {
      notify(
        "danger",
        "图库优化设置保存失败",
        reason instanceof Error ? reason.message : "请稍后重试",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-5">
      <SettingsSectionHeader
        title="图库优化"
        description="上传继续使用 JPEG；开启后，后台会在识别队列空闲时以像素无损方式转换为 AVIF。"
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Card>
        <CardContent className="space-y-5 p-5">
          {loading || !setting ? (
            <p className="text-sm text-secondary">正在加载…</p>
          ) : (
            <>
              <Switch
                checked={setting.enabled}
                disabled={!canWrite}
                onChange={(event) => setSetting({ ...setting, enabled: event.target.checked })}
                label="启用空闲时 AVIF 优化"
                helperText="已完成识别且已关联的 JPEG 会逐步转换；失败任务会保留并可重试。"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="空闲等待分钟"
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
                  label="每批处理数量"
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
                  保存优化设置
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
