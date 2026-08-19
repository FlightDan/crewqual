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
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";

const permissions = [
  ["permissionView", "allUnits", "ownUnit", "ownUnit", "ownUnit"],
  ["permissionChange", "allow", "ownUnit", "deny", "deny"],
  ["permissionReview", "allow", "allow", "allow", "deny"],
  ["permissionSettings", "allManage", "unitNotice", "deny", "deny"],
  ["permissionSecurity", "allow", "deny", "deny", "deny"],
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

function validateAccount(input: AccountDraft, creating: boolean, t: (key: string) => string) {
  if (!input.displayName.trim()) return t("settingsAccount.requiredName");
  if (!/^\S+@\S+\.\S+$/.test(input.email)) return t("settingsAccount.invalidEmail");
  if (input.role !== "SUPER_ADMIN" && !input.unitId) return t("settingsAccount.unitRequired");
  if (creating && input.temporaryPassword.length < 12) return t("settingsAccount.passwordShort");
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
  const { t } = useI18n();
  const roleOptions = (
    Object.entries(settingsRoleLabels) as Array<[SettingsAdminRole, string]>
  ).map(([value]) => ({ value, label: t(`settingsRole.${value}`) }));
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
    const validation = validateAccount(draft, !editingId, t);
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
        editingId ? t("settingsAccount.updated") : t("settingsAccount.created"),
        `${saved.displayName} · ${t(`settingsRole.${saved.role}`)}`,
      );
    } catch (reason) {
      setError(localizeError(reason, t, "settingsAccount.saveError"));
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
      setError(t("settingsAccount.newPasswordShort"));
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
        actionSuccessTitle(pendingAction, t),
        t("settingsAccount.statusUpdated", { name: saved.displayName }),
      );
    } catch (reason) {
      setError(localizeError(reason, t, "settingsAccount.actionError"));
    } finally {
      setActing(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="admin-account-settings-title">
      <SettingsSectionHeader
        title={t("settingsAccount.title")}
        description={t("settingsAccount.description")}
        action={
          canWrite ? (
            <Button type="button" onClick={openCreate}>
              <Plus aria-hidden="true" className="size-4" />
              {t("settingsAccount.add")}
            </Button>
          ) : null
        }
      />

      {!canWrite ? <Alert tone="info">{t("settingsAccount.readonly")}</Alert> : null}

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
                aria-label={t("settingsAccount.search")}
                placeholder={t("settingsAccount.searchPlaceholder")}
                className="min-h-11 w-full rounded-md border border-border pl-9 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>
            <Select
              aria-label={t("settingsAccount.filter")}
              options={[{ label: t("settingsAccount.allRoles"), value: "all" }, ...roleOptions]}
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            />
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted">
                <tr>
                  <th className="py-3 pr-4">{t("settingsAccount.adminLabel")}</th>
                  <th className="px-3 py-3">{t("settingsAccount.unit")}</th>
                  <th className="px-3 py-3">{t("settingsAccount.role")}</th>
                  <th className="px-3 py-3">{t("settingsAccount.totp")}</th>
                  <th className="px-3 py-3">{t("settingsAccount.status")}</th>
                  <th className="px-3 py-3">{t("settingsAccount.lastLogin")}</th>
                  <th className="py-3 pl-3 text-right">{t("settingsAccount.actions")}</th>
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
                      <Badge tone="info">{t(`settingsRole.${admin.role}`)}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={admin.totpStatus === "VERIFIED" ? "success" : "warning"}>
                        {admin.totpStatus === "VERIFIED"
                          ? t("settingsAccount.verified")
                          : t("settingsAccount.unverified")}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={admin.active ? "success" : "neutral"}>
                        {admin.active
                          ? t("settingsAccount.enabled")
                          : t("settingsAccount.disabled")}
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
                          {t("settingsAccount.edit")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => requestAction(admin, admin.active ? "disable" : "enable")}
                          disabled={!canWrite || admin.role === "SUPER_ADMIN"}
                        >
                          {admin.active
                            ? t("settingsAccount.disabled")
                            : t("settingsAccount.enabled")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => requestAction(admin, "resetPassword")}
                          disabled={!canWrite}
                        >
                          {t("settingsAccount.resetPassword")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => requestAction(admin, "resetTotp")}
                          disabled={!canWrite}
                        >
                          {t("settingsAccount.resetTotp")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => requestAction(admin, "revokeSessions")}
                          disabled={!canWrite || admin.activeSessionCount === 0}
                        >
                          {t("settingsAccount.revoke")}
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
                    {admin.active ? t("settingsAccount.enabled") : t("settingsAccount.disabled")}
                  </Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted">{t("settingsAccount.role")}</dt>
                    <dd className="mt-1 font-medium">{t(`settingsRole.${admin.role}`)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("settingsAccount.unit")}</dt>
                    <dd className="mt-1 font-medium">{admin.unitName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("settingsAccount.totp")}</dt>
                    <dd className="mt-1 font-medium">
                      {admin.totpStatus === "VERIFIED"
                        ? t("settingsAccount.verified")
                        : t("settingsAccount.unverified")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("settingsAccount.revoke")}</dt>
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
                    {t("settingsAccount.edit")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => requestAction(admin, admin.active ? "disable" : "enable")}
                    disabled={!canWrite || admin.role === "SUPER_ADMIN"}
                  >
                    {admin.active ? t("settingsAccount.disabled") : t("settingsAccount.enabled")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => requestAction(admin, "resetPassword")}
                    disabled={!canWrite}
                  >
                    {t("settingsAccount.resetPassword")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => requestAction(admin, "resetTotp")}
                    disabled={!canWrite}
                  >
                    {t("settingsAccount.resetTotp")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => requestAction(admin, "revokeSessions")}
                    disabled={!canWrite || admin.activeSessionCount === 0}
                  >
                    {t("settingsAccount.revoke")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {!filtered.length ? (
            <p className="py-8 text-center text-sm text-muted">{t("settingsAccount.noMatch")}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <h3 className="font-bold">{t("settingsAccount.matrix")}</h3>
            <p className="mt-1 text-xs text-muted">{t("settingsAccount.matrixDescription")}</p>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="py-3 pr-4">{t("settingsAccount.permission")}</th>
                <th className="px-3 py-3">{t("settingsAccount.superAdmin")}</th>
                <th className="px-3 py-3">{t("settingsAccount.admin")}</th>
                <th className="px-3 py-3">{t("settingsAccount.reviewer")}</th>
                <th className="px-3 py-3">{t("settingsAccount.readonlyRole")}</th>
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
                      {t(`settingsAccount.${cell}`)}
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
            {editingId ? t("settingsAccount.editTitle") : t("settingsAccount.createTitle")}
          </DialogTitle>
          <DialogDescription id="admin-dialog-description" className="mt-1 text-sm text-secondary">
            {editingId
              ? t("settingsAccount.editDescription")
              : t("settingsAccount.createDescription")}
          </DialogDescription>
          <div className="mt-5 space-y-4">
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Input
              label={t("settingsAccount.name")}
              required
              value={draft.displayName}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            />
            <Input
              label={t("settingsAccount.email")}
              required
              type="email"
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
            <Select
              label={t("settingsAccount.role")}
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
              label={t("settingsAccount.unit")}
              options={[
                { label: t("settingsAccount.global"), value: "" },
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
                label={t("settingsAccount.tempPassword")}
                required
                type="password"
                helperText={t("settingsAccount.passwordHelp")}
                value={draft.temporaryPassword}
                onChange={(event) => setDraft({ ...draft, temporaryPassword: event.target.value })}
              />
            ) : null}
            <Switch
              label={t("settingsAccount.enableAccount")}
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" loading={saving} onClick={() => void saveAccount()}>
              {editingId ? t("settingsAccount.saveEdit") : t("settingsAccount.createAction")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(provisioning)} onOpenChange={(open) => !open && setProvisioning(null)}>
        <DialogContent aria-describedby="totp-provisioning-description">
          <DialogTitle className="text-lg font-bold">
            {t("settingsAccount.provisionTitle")}
          </DialogTitle>
          <DialogDescription
            id="totp-provisioning-description"
            className="mt-1 text-sm text-secondary"
          >
            {t("settingsAccount.provisionDescription")}
          </DialogDescription>
          {provisioning ? (
            <div className="mt-5 space-y-4">
              <Alert tone="warning">{t("settingsAccount.secretWarning")}</Alert>
              <div>
                <p className="text-xs font-semibold text-muted">
                  {t("settingsAccount.adminLabel")}
                </p>
                <p className="mt-1 text-sm font-medium">{provisioning.email}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted">
                  {t("settingsAccount.manualSecret")}
                </p>
                <code className="mt-1 block break-all rounded-md bg-slate-100 p-3 text-sm">
                  {provisioning.oneTimeTotpSecret}
                </code>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted">{t("settingsAccount.uri")}</p>
                <code className="mt-1 block max-h-28 overflow-auto break-all rounded-md bg-slate-100 p-3 text-xs">
                  {provisioning.oneTimeTotpUri}
                </code>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={() => setProvisioning(null)}>
                  {t("settingsAccount.savedSecret")}
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
            {pendingAction ? actionTitle(pendingAction, t) : t("settingsAccount.accountAction")}
          </DialogTitle>
          <DialogDescription
            id="admin-action-description"
            className="mt-2 text-sm leading-6 text-secondary"
          >
            {actionTarget && pendingAction
              ? actionDescription(actionTarget, pendingAction, t)
              : null}
          </DialogDescription>
          <div className="mt-4 space-y-4">
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            {pendingAction === "resetPassword" ? (
              <Input
                label={t("settingsAccount.newPassword")}
                type="password"
                required
                helperText={t("settingsAccount.newPasswordHelp")}
                value={actionValue}
                onChange={(event) => setActionValue(event.target.value)}
              />
            ) : null}
            {pendingAction === "disable" ? (
              <Alert tone="warning">{t("settingsAccount.disableWarning")}</Alert>
            ) : null}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setActionTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant={pendingAction === "disable" ? "danger" : "primary"}
              loading={acting}
              onClick={() => void runAction()}
            >
              {t("settingsAccount.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function actionTitle(action: AdminAction, t: (key: string) => string) {
  return {
    disable: t("settingsAccount.disableTitle"),
    enable: t("settingsAccount.enableTitle"),
    resetPassword: t("settingsAccount.resetPasswordTitle"),
    resetTotp: t("settingsAccount.resetTotpTitle"),
    revokeSessions: t("settingsAccount.revokeTitle"),
  }[action];
}

function actionSuccessTitle(action: AdminAction, t: (key: string) => string) {
  return {
    disable: t("settingsAccount.disableSuccess"),
    enable: t("settingsAccount.enableSuccess"),
    resetPassword: t("settingsAccount.resetPasswordSuccess"),
    resetTotp: t("settingsAccount.resetTotpSuccess"),
    revokeSessions: t("settingsAccount.revokeSuccess"),
  }[action];
}

function actionDescription(
  admin: SettingsAdminAccount,
  action: AdminAction,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  const values = { name: admin.displayName, email: admin.email, count: admin.activeSessionCount };
  return {
    disable: t("settingsAccount.disableDescription", values),
    enable: t("settingsAccount.enableDescription", values),
    resetPassword: t("settingsAccount.resetPasswordDescription", values),
    resetTotp: t("settingsAccount.resetTotpDescription", values),
    revokeSessions: t("settingsAccount.revokeDescription", values),
  }[action];
}
