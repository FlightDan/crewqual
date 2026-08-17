"use client";

import * as React from "react";
import { Plus, Search } from "lucide-react";
import {
  SettingsSectionHeader,
  formatSettingsDate,
  type SettingsFeedback,
} from "@/components/admin/settings/settings-shared";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/choice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  adminSettingsService,
  settingsRoleLabels,
  type AdminCredentialResult,
  type AdminAction,
  type AdminInput,
} from "@/services/admin-settings-service";
import type { SettingsAdminAccount, SettingsAdminRole, SettingsUnit } from "@/types/admin-settings";

const roleOptions = (Object.entries(settingsRoleLabels) as Array<[SettingsAdminRole, string]>).map(
  ([value, label]) => ({ value, label }),
);

const permissions = [
  ["业务数据查看", "全部单位", "所属单位", "所属单位", "所属单位"],
  ["业务数据变更", "允许", "所属单位", "禁止", "禁止"],
  ["人工审核决定", "允许", "允许", "允许", "禁止"],
  ["系统设置", "全部管理", "单位与通知", "禁止", "禁止"],
  ["管理员与安全", "允许", "禁止", "禁止", "禁止"],
] as const;

type AccountDraft = AdminInput & { temporaryPassword: string };

const emptyDraft: AccountDraft = {
  id: "",
  displayName: "",
  email: "",
  unitId: null,
  role: "ADMIN",
  active: true,
  temporaryPassword: "",
};

function validateAccount(input: AccountDraft, creating: boolean) {
  if (!input.displayName.trim()) return "请输入管理员姓名";
  if (!/^\S+@\S+\.\S+$/.test(input.email)) return "请输入正确的邮箱地址";
  if (input.role !== "SUPER_ADMIN" && !input.unitId) return "非超级管理员必须选择所属单位";
  if (creating && input.temporaryPassword.length < 12) return "临时密码至少需要 12 个字符";
  return null;
}

export function AdminAccountSettingsSection({
  admins,
  units,
  canWrite,
  onAdminsChange,
  notify,
}: {
  admins: SettingsAdminAccount[];
  units: SettingsUnit[];
  canWrite: boolean;
  onAdminsChange: (admins: SettingsAdminAccount[]) => void;
  notify: SettingsFeedback;
}) {
  const [query, setQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<AccountDraft>(emptyDraft);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionTarget, setActionTarget] = React.useState<SettingsAdminAccount | null>(null);
  const [pendingAction, setPendingAction] = React.useState<AdminAction | null>(null);
  const [actionValue, setActionValue] = React.useState("");
  const [acting, setActing] = React.useState(false);
  const [provisioning, setProvisioning] = React.useState<AdminCredentialResult | null>(null);

  const filtered = admins.filter((admin) => {
    const matchesQuery = `${admin.displayName}${admin.email}${admin.unitName}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    return matchesQuery && (roleFilter === "all" || admin.role === roleFilter);
  });

  const openCreate = () => {
    setEditingId(null);
    setDraft({ ...emptyDraft, unitId: units.find((item) => item.active)?.id ?? null });
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (admin: SettingsAdminAccount) => {
    setEditingId(admin.id);
    setDraft({
      id: admin.id,
      displayName: admin.displayName,
      email: admin.email,
      unitId: admin.unitId,
      role: admin.role,
      active: admin.active,
      temporaryPassword: "",
    });
    setError(null);
    setDialogOpen(true);
  };

  const saveAccount = async () => {
    const validation = validateAccount(draft, !editingId);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = editingId
        ? await adminSettingsService.saveAdmin(draft)
        : await adminSettingsService.createAdmin(draft);
      const { oneTimeTotpSecret, oneTimeTotpUri, ...account } = saved as AdminCredentialResult;
      onAdminsChange(
        editingId
          ? admins.map((item) => (item.id === account.id ? account : item))
          : [...admins, account],
      );
      if (typeof oneTimeTotpSecret === "string") {
        setProvisioning({ ...account, oneTimeTotpSecret, oneTimeTotpUri });
      }
      setDialogOpen(false);
      notify(
        "success",
        editingId ? "管理员账号已更新" : "管理员账号已创建",
        `${saved.displayName} · ${settingsRoleLabels[saved.role]}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "管理员账号保存失败");
    } finally {
      setSaving(false);
    }
  };

  const requestAction = (admin: SettingsAdminAccount, action: AdminAction) => {
    setActionTarget(admin);
    setPendingAction(action);
    setActionValue("");
    setError(null);
  };

  const runAction = async () => {
    if (!actionTarget || !pendingAction) return;
    if (pendingAction === "resetPassword" && actionValue.length < 12) {
      setError("新临时密码至少需要 12 个字符");
      return;
    }
    setActing(true);
    setError(null);
    try {
      const saved = await adminSettingsService.runAdminAction(
        actionTarget.id,
        pendingAction,
        actionValue || undefined,
      );
      const { oneTimeTotpSecret, oneTimeTotpUri, ...account } = saved;
      onAdminsChange(admins.map((item) => (item.id === account.id ? account : item)));
      if (typeof oneTimeTotpSecret === "string") {
        setProvisioning({ ...account, oneTimeTotpSecret, oneTimeTotpUri });
      }
      setActionTarget(null);
      setPendingAction(null);
      notify(
        "success",
        actionSuccessTitle(pendingAction),
        `${saved.displayName} 的账号状态已更新。`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "账号操作失败");
    } finally {
      setActing(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="admin-account-settings-title">
      <SettingsSectionHeader
        title="管理员与权限"
        description="维护管理员账号、所属单位和内置角色。角色权限为系统固定定义，避免出现不可审计的自定义权限组合。"
        action={
          canWrite ? (
            <Button type="button" onClick={openCreate}>
              <Plus aria-hidden="true" className="size-4" />
              新增管理员
            </Button>
          ) : null
        }
      />

      {!canWrite ? (
        <Alert tone="info">当前角色只能查看管理员和角色定义，不能修改账号。</Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="搜索管理员"
                placeholder="搜索姓名、邮箱或单位"
                className="min-h-11 w-full rounded-md border border-border pl-9 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>
            <Select
              aria-label="筛选管理员角色"
              options={[{ label: "全部角色", value: "all" }, ...roleOptions]}
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            />
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted">
                <tr>
                  <th className="py-3 pr-4">管理员</th>
                  <th className="px-3 py-3">所属单位</th>
                  <th className="px-3 py-3">角色</th>
                  <th className="px-3 py-3">双重验证</th>
                  <th className="px-3 py-3">账号状态</th>
                  <th className="px-3 py-3">最后登录</th>
                  <th className="py-3 pl-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((admin) => (
                  <tr key={admin.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4">
                      <p className="font-semibold text-primary">{admin.displayName}</p>
                      <p className="mt-1 text-xs text-muted">{admin.email}</p>
                    </td>
                    <td className="px-3 py-3 text-secondary">{admin.unitName}</td>
                    <td className="px-3 py-3">
                      <Badge tone="info">{settingsRoleLabels[admin.role]}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={admin.totpEnabled ? "success" : "warning"}>
                        {admin.totpEnabled ? "已启用" : "待绑定"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={admin.active ? "success" : "neutral"}>
                        {admin.active ? "启用" : "停用"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-secondary">
                      {formatSettingsDate(admin.lastLoginAt)}
                    </td>
                    <td className="py-3 pl-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => openEdit(admin)}
                          disabled={!canWrite}
                        >
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => requestAction(admin, admin.active ? "disable" : "enable")}
                          disabled={!canWrite || admin.role === "SUPER_ADMIN"}
                        >
                          {admin.active ? "停用" : "启用"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => requestAction(admin, "resetPassword")}
                          disabled={!canWrite}
                        >
                          重置密码
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => requestAction(admin, "resetTotp")}
                          disabled={!canWrite}
                        >
                          重置 2FA
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => requestAction(admin, "revokeSessions")}
                          disabled={!canWrite || admin.activeSessionCount === 0}
                        >
                          结束会话
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 lg:hidden">
            {filtered.map((admin) => (
              <div key={admin.id} className="rounded-md border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{admin.displayName}</p>
                    <p className="mt-1 truncate text-xs text-muted">{admin.email}</p>
                  </div>
                  <Badge tone={admin.active ? "success" : "neutral"}>
                    {admin.active ? "启用" : "停用"}
                  </Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted">角色</dt>
                    <dd className="mt-1 font-medium">{settingsRoleLabels[admin.role]}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">所属单位</dt>
                    <dd className="mt-1 font-medium">{admin.unitName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">双重验证</dt>
                    <dd className="mt-1 font-medium">{admin.totpEnabled ? "已启用" : "待绑定"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">活跃会话</dt>
                    <dd className="mt-1 font-medium">{admin.activeSessionCount}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => openEdit(admin)}
                    disabled={!canWrite}
                  >
                    编辑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => requestAction(admin, admin.active ? "disable" : "enable")}
                    disabled={!canWrite || admin.role === "SUPER_ADMIN"}
                  >
                    {admin.active ? "停用" : "启用"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => requestAction(admin, "resetPassword")}
                    disabled={!canWrite}
                  >
                    重置密码
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => requestAction(admin, "resetTotp")}
                    disabled={!canWrite}
                  >
                    重置 2FA
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => requestAction(admin, "revokeSessions")}
                    disabled={!canWrite || admin.activeSessionCount === 0}
                  >
                    结束会话
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {!filtered.length ? (
            <p className="py-8 text-center text-sm text-muted">没有符合条件的管理员账号</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <h3 className="font-bold">内置角色权限矩阵</h3>
            <p className="mt-1 text-xs text-muted">首版不允许创建自定义角色或修改内置权限。</p>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="py-3 pr-4">权限项</th>
                <th className="px-3 py-3">超级管理员</th>
                <th className="px-3 py-3">管理员</th>
                <th className="px-3 py-3">审核员</th>
                <th className="px-3 py-3">只读查看员</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((row) => (
                <tr key={row[0]} className="border-b border-border last:border-0">
                  {row.map((cell, index) => (
                    <td
                      key={`${row[0]}-${index}`}
                      className={index ? "px-3 py-3 text-secondary" : "py-3 pr-4 font-medium"}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent aria-describedby="admin-dialog-description">
          <DialogTitle className="text-lg font-bold">
            {editingId ? "编辑管理员" : "新增管理员"}
          </DialogTitle>
          <DialogDescription id="admin-dialog-description" className="mt-1 text-sm text-secondary">
            {editingId
              ? "修改账号资料、所属单位和内置角色。"
              : "创建账号后，管理员首次登录时必须绑定双重验证。"}
          </DialogDescription>
          <div className="mt-5 space-y-4">
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Input
              label="姓名"
              required
              value={draft.displayName}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            />
            <Input
              label="邮箱"
              required
              type="email"
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
            <Select
              label="角色"
              options={roleOptions}
              value={draft.role}
              onChange={(event) => {
                const role = event.target.value as SettingsAdminRole;
                setDraft({
                  ...draft,
                  role,
                  unitId: role === "SUPER_ADMIN" ? null : (draft.unitId ?? units[0]?.id ?? null),
                });
              }}
            />
            <Select
              label="所属单位"
              options={[
                { label: "全局（仅超级管理员）", value: "" },
                ...units
                  .filter((item) => item.active)
                  .map((item) => ({ label: item.name, value: item.id })),
              ]}
              value={draft.unitId ?? ""}
              disabled={draft.role === "SUPER_ADMIN"}
              onChange={(event) => setDraft({ ...draft, unitId: event.target.value || null })}
            />
            {!editingId ? (
              <Input
                label="临时密码"
                required
                type="password"
                helperText="至少 12 个字符；请通过安全渠道交付。"
                value={draft.temporaryPassword}
                onChange={(event) => setDraft({ ...draft, temporaryPassword: event.target.value })}
              />
            ) : null}
            <Switch
              label="启用账号"
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button type="button" loading={saving} onClick={() => void saveAccount()}>
              {editingId ? "保存修改" : "创建管理员"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(provisioning)} onOpenChange={(open) => !open && setProvisioning(null)}>
        <DialogContent aria-describedby="totp-provisioning-description">
          <DialogTitle className="text-lg font-bold">交付一次性双重验证密钥</DialogTitle>
          <DialogDescription
            id="totp-provisioning-description"
            className="mt-1 text-sm text-secondary"
          >
            请立即复制到验证器或安全交付给管理员。关闭后系统不会再次显示完整密钥。
          </DialogDescription>
          {provisioning ? (
            <div className="mt-5 space-y-4">
              <Alert tone="warning">该密钥只在本次操作中显示，请勿写入工单、截图或聊天记录。</Alert>
              <div>
                <p className="text-xs font-semibold text-muted">管理员</p>
                <p className="mt-1 text-sm font-medium">{provisioning.email}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted">手动输入密钥</p>
                <code className="mt-1 block break-all rounded-md bg-slate-100 p-3 text-sm">
                  {provisioning.oneTimeTotpSecret}
                </code>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted">otpauth URI（可用于生成二维码）</p>
                <code className="mt-1 block max-h-28 overflow-auto break-all rounded-md bg-slate-100 p-3 text-xs">
                  {provisioning.oneTimeTotpUri}
                </code>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={() => setProvisioning(null)}>
                  我已安全保存
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(actionTarget && pendingAction)}
        onOpenChange={(open) => !open && setActionTarget(null)}
      >
        <DialogContent aria-describedby="admin-action-description">
          <DialogTitle className="text-lg font-bold">
            {pendingAction ? actionTitle(pendingAction) : "账号操作"}
          </DialogTitle>
          <DialogDescription
            id="admin-action-description"
            className="mt-2 text-sm leading-6 text-secondary"
          >
            {actionTarget && pendingAction ? actionDescription(actionTarget, pendingAction) : null}
          </DialogDescription>
          <div className="mt-4 space-y-4">
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            {pendingAction === "resetPassword" ? (
              <Input
                label="新临时密码"
                type="password"
                required
                helperText="至少 12 个字符；保存后立即使旧密码失效。"
                value={actionValue}
                onChange={(event) => setActionValue(event.target.value)}
              />
            ) : null}
            {pendingAction === "disable" ? (
              <Alert tone="warning">停用账号将同时结束该管理员的所有活跃会话。</Alert>
            ) : null}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setActionTarget(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant={pendingAction === "disable" ? "danger" : "primary"}
              loading={acting}
              onClick={() => void runAction()}
            >
              确认操作
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function actionTitle(action: AdminAction) {
  return {
    disable: "停用管理员账号",
    enable: "启用管理员账号",
    resetPassword: "重置管理员密码",
    resetTotp: "重置双重验证",
    revokeSessions: "结束全部活跃会话",
  }[action];
}

function actionSuccessTitle(action: AdminAction) {
  return {
    disable: "管理员账号已停用",
    enable: "管理员账号已启用",
    resetPassword: "临时密码已更新",
    resetTotp: "双重验证已重置",
    revokeSessions: "活跃会话已结束",
  }[action];
}

function actionDescription(admin: SettingsAdminAccount, action: AdminAction) {
  const prefix = `管理员“${admin.displayName}”（${admin.email}）`;
  return {
    disable: `${prefix}将无法继续登录，现有会话也会失效。`,
    enable: `${prefix}将恢复登录权限。`,
    resetPassword: `${prefix}的旧密码将立即失效。`,
    resetTotp: `${prefix}下次登录时必须重新绑定双重验证。`,
    revokeSessions: `${prefix}在其他设备上的 ${admin.activeSessionCount} 个会话将失效。`,
  }[action];
}
