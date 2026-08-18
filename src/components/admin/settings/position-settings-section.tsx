"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Trash2, Users } from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  SettingsSectionHeader,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/choice";
import {
  adminSettingsService,
  AdminSettingsServiceError,
  type PositionInput,
} from "@/services/admin-settings-service";
import type { SettingsPosition } from "@/types/admin-settings";

type PositionHistory = {
  memberAssignments?: number;
  qualificationRequirements?: number;
  qualificationAssignments?: number;
  upgradePlans?: number;
};

const emptyDraft: PositionInput = {
  code: "",
  name: "",
  description: "",
  active: true,
  sortOrder: 0,
  version: 1,
};

function validatePosition(draft: PositionInput) {
  if (!draft.name.trim()) return "请输入职位名称";
  if (!draft.code.trim()) return "请输入职位编码";
  if (!/^[A-Z][A-Z0-9_-]{0,63}$/.test(draft.code.trim().toUpperCase())) {
    return "职位编码只能包含大写字母、数字、下划线和连字符";
  }
  if (!Number.isInteger(draft.sortOrder) || draft.sortOrder < 0) return "导航排序必须是非负整数";
  return null;
}

export function PositionSettingsSection({
  positions,
  defaultOrganizationId,
  canWrite,
  isSuperAdmin,
  onPositionsChange,
  notify,
}: {
  positions: SettingsPosition[];
  defaultOrganizationId?: string;
  canWrite: boolean;
  isSuperAdmin: boolean;
  onPositionsChange: (positions: SettingsPosition[]) => void;
  notify: SettingsFeedback;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<PositionInput>(emptyDraft);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<SettingsPosition | null>(null);
  const [deleteHistory, setDeleteHistory] = React.useState<PositionHistory | null>(null);
  const [deleteError, setDeleteError] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [forceConfirm, setForceConfirm] = React.useState(false);
  const editing = Boolean(draft.id);

  const openCreate = () => {
    setDraft({
      ...emptyDraft,
      organizationId: defaultOrganizationId ?? positions[0]?.organizationId,
    });
    setError("");
    setOpen(true);
  };

  const openEdit = (position: SettingsPosition) => {
    setDraft({ ...position });
    setError("");
    setOpen(true);
  };

  const save = async () => {
    const normalized = { ...draft, code: draft.code.trim().toUpperCase() };
    const validation = validatePosition(normalized);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = editing
        ? await adminSettingsService.savePosition(normalized)
        : await adminSettingsService.createPosition(normalized);
      onPositionsChange(
        editing
          ? positions.map((item) => (item.id === saved.id ? saved : item))
          : [...positions, saved].sort((left, right) => left.sortOrder - right.sortOrder),
      );
      setOpen(false);
      notify("success", editing ? "职位设置已保存" : "职位已创建", `${saved.name} 已更新。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "职位保存失败");
    } finally {
      setSaving(false);
    }
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteHistory(null);
    setDeleteError("");
    setForceConfirm(false);
  };

  const remove = async (force = false) => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await adminSettingsService.deletePosition({
        id: deleteTarget.id,
        version: deleteTarget.version,
        force,
      });
      onPositionsChange(positions.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteHistory(null);
      setDeleteError("");
      setForceConfirm(false);
      notify(
        "success",
        force ? "职位已强制删除" : "职位已删除",
        force ? "当前任职已结束，历史记录已保留。" : `${deleteTarget.name} 已从职位列表移除。`,
      );
    } catch (reason) {
      if (reason instanceof AdminSettingsServiceError && reason.code === "POSITION_HAS_HISTORY") {
        setDeleteHistory((reason.details ?? {}) as PositionHistory);
      } else {
        setDeleteError(reason instanceof Error ? reason.message : "职位删除失败");
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="space-y-5" aria-label="职位管理">
      <SettingsSectionHeader
        title="职位管理"
        description="创建和维护组织内的职位；每个职位自动拥有成员列表、资质管理和升级计划。"
        action={
          canWrite ? (
            <Button type="button" onClick={openCreate}>
              <Plus aria-hidden="true" className="size-4" />
              新增职位
            </Button>
          ) : null
        }
      />
      {!positions.length ? (
        <Card className="p-8 text-center text-sm text-muted">当前组织还没有职位。</Card>
      ) : (
        <div className="space-y-3">
          {positions
            .slice()
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((position) => (
              <Card
                key={position.id}
                className="flex items-center justify-between gap-4 p-5 shadow-none"
              >
                <div className="flex min-w-0 items-center gap-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-brand">
                    <Users aria-hidden="true" className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-primary">{position.name}</h3>
                      <span className="text-xs text-muted">{position.code}</span>
                    </div>
                    <p className="mt-1 text-sm text-secondary">
                      {position.memberCount} 名成员 <span className="mx-2">·</span>{" "}
                      {position.qualificationCount} 项资质
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-5">
                  <Badge tone={position.active ? "success" : "neutral"}>
                    {position.active ? "启用" : "停用"}
                  </Badge>
                  <div className="flex items-center gap-3 text-sm font-medium text-brand">
                    {canWrite ? (
                      <button type="button" onClick={() => openEdit(position)}>
                        编辑
                      </button>
                    ) : null}
                    <Link
                      href={`/admin/members/positions/${encodeURIComponent(position.code)}/qualifications`}
                    >
                      {canWrite ? "分配资质" : "查看资质"}
                    </Link>
                    {canWrite ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-danger hover:underline"
                        onClick={() => {
                          setDeleteTarget(position);
                          setDeleteHistory(null);
                          setDeleteError("");
                          setForceConfirm(false);
                        }}
                      >
                        <Trash2 aria-hidden="true" className="size-3.5" />
                        删除
                      </button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
        </div>
      )}

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent side="right" className="w-[min(25rem,calc(100vw-3rem))] overflow-y-auto p-6">
          <DrawerTitle className="text-lg font-bold text-primary">
            {editing ? "编辑职位" : "新增职位"}
          </DrawerTitle>
          <DrawerDescription className="mt-2 text-sm text-secondary">
            {editing ? "更新职位名称、描述和导航状态" : "定义系统中新的机组岗位"}
          </DrawerDescription>
          <div className="mt-8 space-y-4">
            {error ? (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
            <Input
              label="职位名称"
              required
              placeholder="例如：签派员"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <Input
              label="职位编码"
              required
              disabled={editing}
              placeholder="例如：DISPATCHER"
              value={draft.code}
              onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })}
              helperText={editing ? "创建后不可修改" : "创建后作为组织内唯一键值"}
            />
            <Textarea
              label="职位描述"
              placeholder="请输入该职位的主要职责和工作范畴描述..."
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
            <Input
              label="导航排序"
              type="number"
              min={0}
              value={draft.sortOrder}
              onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })}
            />
            <Switch
              label="是否启用"
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
              helperText="停用后仍保留历史数据，但不显示在成员管理导航中。"
            />
          </div>
          <div className="mt-10 flex justify-end gap-3">
            <DrawerClose asChild>
              <Button type="button" variant="secondary">
                取消
              </Button>
            </DrawerClose>
            <Button type="button" loading={saving} onClick={() => void save()}>
              保存
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeDelete();
        }}
      >
        <DialogContent>
          <DialogTitle className="text-lg font-bold text-primary">
            删除职位{deleteTarget ? `：${deleteTarget.name}` : ""}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-secondary">
            普通删除仅适用于没有任何历史关联的职位。
          </DialogDescription>
          <div className="mt-5 space-y-4">
            {deleteError ? (
              <p className="text-sm text-danger" role="alert">
                {deleteError}
              </p>
            ) : null}
            {forceConfirm && deleteTarget ? (
              <Alert tone="danger" title="确认强制删除并保留历史？">
                <p>
                  当前任职会自动结束，职位将从业务导航中消失；成员资质和升级计划历史会保留为“已删除职位”快照。
                </p>
              </Alert>
            ) : deleteHistory ? (
              <Alert tone="warning" title="该职位存在历史关联，无法安全删除">
                <div className="space-y-2">
                  <p>
                    任职记录 {deleteHistory.memberAssignments ?? 0} 条，资质要求{" "}
                    {deleteHistory.qualificationRequirements ?? 0} 条，资质分配{" "}
                    {deleteHistory.qualificationAssignments ?? 0} 条，升级计划{" "}
                    {deleteHistory.upgradePlans ?? 0} 条。
                  </p>
                  {!isSuperAdmin ? (
                    <p>请先停用职位，或联系超级管理员执行强制删除。</p>
                  ) : (
                    <p>
                      强制删除会自动结束当前任职、解除职位关联，并将历史记录保留为“已删除职位”快照。
                    </p>
                  )}
                </div>
              </Alert>
            ) : (
              <p className="text-sm leading-6 text-secondary">
                确定删除该职位吗？删除后职位将从业务导航中移除，且操作不可恢复。
              </p>
            )}
          </div>
          <div className="mt-7 flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={closeDelete} disabled={deleting}>
              取消
            </Button>
            {forceConfirm ? (
              <Button
                type="button"
                variant="danger"
                loading={deleting}
                onClick={() => void remove(true)}
              >
                确认强制删除
              </Button>
            ) : deleteHistory && isSuperAdmin ? (
              <Button type="button" variant="danger" onClick={() => setForceConfirm(true)}>
                强制删除并保留历史
              </Button>
            ) : !deleteHistory ? (
              <Button
                type="button"
                variant="danger"
                loading={deleting}
                onClick={() => void remove()}
              >
                确认删除
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
