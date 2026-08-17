"use client";

import * as React from "react";
import { Building2, Plus, Search } from "lucide-react";
import {
  SettingsSectionHeader,
  FieldGrid,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/choice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adminSettingsService } from "@/services/admin-settings-service";
import { cn } from "@/lib/utils";
import type { SettingsUnit } from "@/types/admin-settings";

const timezoneOptions = [
  { label: "Asia/Shanghai（中国标准时间）", value: "Asia/Shanghai" },
  { label: "Asia/Hong_Kong（香港时间）", value: "Asia/Hong_Kong" },
  { label: "UTC（协调世界时）", value: "UTC" },
];

const emptyUnit = {
  code: "",
  name: "",
  timezone: "Asia/Shanghai",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  active: true,
};

function validateUnit(values: typeof emptyUnit) {
  if (!values.name.trim()) return "请输入单位名称";
  if (!values.code.trim()) return "请输入单位编码";
  if (!/^[A-Z0-9-]{2,32}$/.test(values.code.trim().toUpperCase()))
    return "单位编码只能包含大写字母、数字和连字符";
  if (values.contactEmail && !/^\S+@\S+\.\S+$/.test(values.contactEmail))
    return "联系邮箱格式不正确";
  return null;
}

export function OrganizationSettingsSection({
  units,
  isSuperAdmin,
  canWrite,
  onUnitsChange,
  notify,
}: {
  units: SettingsUnit[];
  isSuperAdmin: boolean;
  canWrite: boolean;
  onUnitsChange: (units: SettingsUnit[]) => void;
  notify: SettingsFeedback;
}) {
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState(units[0]?.id ?? "");
  const selected = units.find((item) => item.id === selectedId) ?? units[0];
  const [draft, setDraft] = React.useState<SettingsUnit | null>(selected ?? null);
  const [saving, setSaving] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createDraft, setCreateDraft] = React.useState(emptyUnit);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(selected ? { ...selected } : null);
    setError(null);
  }, [selected]);

  const filtered = units.filter((item) =>
    `${item.name}${item.code}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const save = async () => {
    if (!draft) return;
    const validation = validateUnit(draft);
    if (validation) {
      setError(validation);
      notify("danger", "无法保存单位设置", validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await adminSettingsService.saveUnit(draft);
      onUnitsChange(units.map((item) => (item.id === saved.id ? saved : item)));
      setDraft(saved);
      notify("success", "单位设置已保存", `${saved.name} 的基础信息已更新。`);
    } catch (reason) {
      notify("danger", "单位设置保存失败", reason instanceof Error ? reason.message : "请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const createUnit = async () => {
    const validation = validateUnit(createDraft);
    if (validation) {
      setError(validation);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await adminSettingsService.createUnit({
        ...createDraft,
        code: createDraft.code.toUpperCase(),
      });
      onUnitsChange([...units, created]);
      setSelectedId(created.id);
      setCreateDraft(emptyUnit);
      setCreateOpen(false);
      notify("success", "单位已创建", `${created.name} 已加入组织。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "单位创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="organization-settings-title">
      <SettingsSectionHeader
        title="组织与单位"
        description={
          isSuperAdmin
            ? "管理多个运行单位，维护单位状态、时区和联系人信息。"
            : "维护所属单位的基础信息；单位编码和状态由超级管理员管理。"
        }
        action={
          isSuperAdmin && canWrite ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" className="size-4" />
              新增单位
            </Button>
          ) : null
        }
      />

      <div className={cn("grid gap-4", isSuperAdmin && "xl:grid-cols-[300px_minmax(0,1fr)]")}>
        {isSuperAdmin ? (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="搜索单位"
                  placeholder="搜索单位名称或编码"
                  className="min-h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>
              <div className="max-h-[560px] space-y-2 overflow-y-auto" aria-label="单位列表">
                {filtered.map((unit) => (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => setSelectedId(unit.id)}
                    className={cn(
                      "w-full rounded-md border p-3 text-left transition",
                      selected?.id === unit.id
                        ? "border-brand bg-blue-50"
                        : "border-border bg-card hover:bg-slate-50",
                    )}
                    aria-pressed={selected?.id === unit.id}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-primary">{unit.name}</span>
                      <Badge tone={unit.active ? "success" : "neutral"}>
                        {unit.active ? "启用" : "停用"}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-xs text-muted">{unit.code}</span>
                    <span className="mt-2 block text-xs text-secondary">
                      {unit.pilotCount} 名飞行员 · {unit.adminCount} 名管理员
                    </span>
                  </button>
                ))}
                {!filtered.length ? (
                  <p className="py-8 text-center text-sm text-muted">没有匹配的单位</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {draft ? (
          <Card>
            <CardContent className="space-y-5 p-5">
              <div className="flex items-center gap-3 border-b border-border pb-4">
                <span className="inline-flex size-11 items-center justify-center rounded-md bg-blue-50 text-brand">
                  <Building2 aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-bold text-primary">{draft.name}</h3>
                  <p className="mt-1 text-xs text-muted">单位编码创建后不可修改</p>
                </div>
                <Badge tone={draft.active ? "success" : "neutral"}>
                  {draft.active ? "启用" : "停用"}
                </Badge>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <FieldGrid>
                <Input
                  label="单位名称"
                  required
                  value={draft.name}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
                <Input label="单位编码" value={draft.code} disabled />
                <Select
                  label="时区"
                  options={timezoneOptions}
                  value={draft.timezone}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
                />
                <Input
                  label="管理员联系人"
                  value={draft.contactName}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, contactName: event.target.value })}
                />
                <Input
                  label="联系邮箱"
                  type="email"
                  value={draft.contactEmail}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })}
                />
                <Input
                  label="联系电话"
                  value={draft.contactPhone}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, contactPhone: event.target.value })}
                />
              </FieldGrid>
              {isSuperAdmin ? (
                <div className="rounded-md border border-border p-3">
                  <Switch
                    label="启用该单位"
                    checked={draft.active}
                    disabled={!canWrite}
                    onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                    helperText="停用后，该单位管理员不能登录，历史数据仍保留。"
                  />
                </div>
              ) : null}
              {canWrite ? (
                <div className="flex justify-end">
                  <Button type="button" loading={saving} onClick={() => void save()}>
                    保存单位设置
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent aria-describedby="create-unit-description">
          <DialogTitle className="text-lg font-bold">新增运行单位</DialogTitle>
          <DialogDescription id="create-unit-description" className="mt-1 text-sm text-secondary">
            创建后可分配管理员和飞行员。单位编码保存后不可修改。
          </DialogDescription>
          <div className="mt-5 space-y-4">
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Input
              label="单位名称"
              required
              value={createDraft.name}
              onChange={(event) => setCreateDraft({ ...createDraft, name: event.target.value })}
            />
            <Input
              label="单位编码"
              required
              placeholder="例如 FLT-01-SQ-03"
              value={createDraft.code}
              onChange={(event) =>
                setCreateDraft({ ...createDraft, code: event.target.value.toUpperCase() })
              }
            />
            <Select
              label="时区"
              options={timezoneOptions}
              value={createDraft.timezone}
              onChange={(event) => setCreateDraft({ ...createDraft, timezone: event.target.value })}
            />
            <Input
              label="管理员联系人"
              value={createDraft.contactName}
              onChange={(event) =>
                setCreateDraft({ ...createDraft, contactName: event.target.value })
              }
            />
            <Input
              label="联系邮箱"
              type="email"
              value={createDraft.contactEmail}
              onChange={(event) =>
                setCreateDraft({ ...createDraft, contactEmail: event.target.value })
              }
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button type="button" loading={creating} onClick={() => void createUnit()}>
              创建单位
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
