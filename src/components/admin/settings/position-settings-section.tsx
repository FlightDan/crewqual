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
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";

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

function validatePosition(draft: PositionInput, t: (key: string) => string) {
  if (!draft.name.trim()) return t("settingsPosition.requiredName");
  if (!draft.code.trim()) return t("settingsPosition.requiredCode");
  if (!/^[A-Z][A-Z0-9_-]{0,63}$/.test(draft.code.trim().toUpperCase())) {
    return t("settingsPosition.codeFormat");
  }
  if (!Number.isInteger(draft.sortOrder) || draft.sortOrder < 0)
    return t("settingsPosition.sortFormat");
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
  const { locale, t } = useI18n();
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
    const validation = validatePosition(normalized, t);
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
      notify(
        "success",
        editing ? t("settingsPosition.saved") : t("settingsPosition.created"),
        t("settingsPosition.updated", { name: saved.name }),
      );
    } catch (reason) {
      setError(localizeError(reason, t, "settingsPosition.saveError"));
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
        force ? t("settingsPosition.forceDeleted") : t("settingsPosition.deleted"),
        force
          ? t("settingsPosition.ended")
          : t("settingsPosition.removed", { name: deleteTarget.name }),
      );
    } catch (reason) {
      if (reason instanceof AdminSettingsServiceError && reason.code === "POSITION_HAS_HISTORY") {
        setDeleteHistory((reason.details ?? {}) as PositionHistory);
      } else {
        setDeleteError(localizeError(reason, t, "settingsPosition.deleteError"));
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="space-y-5" aria-label={t("settingsPosition.aria")}>
      <SettingsSectionHeader
        title={t("settingsPosition.title")}
        description={t("settingsPosition.description")}
        action={
          canWrite ? (
            <Button type="button" onClick={openCreate}>
              <Plus aria-hidden="true" className="size-4" />
              {t("settingsPosition.add")}
            </Button>
          ) : null
        }
      />
      {!positions.length ? (
        <Card className="p-8 text-center text-sm text-muted">{t("settingsPosition.empty")}</Card>
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
                      {t("settingsPosition.counts", {
                        members: position.memberCount,
                        qualifications: position.qualificationCount,
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-5">
                  <Badge tone={position.active ? "success" : "neutral"}>
                    {position.active
                      ? t("settingsPosition.enabled")
                      : t("settingsPosition.disabled")}
                  </Badge>
                  <div className="flex items-center gap-3 text-sm font-medium text-brand">
                    {canWrite ? (
                      <button type="button" onClick={() => openEdit(position)}>
                        {t("settingsPosition.edit")}
                      </button>
                    ) : null}
                    <Link
                      href={`/admin/members/positions/${encodeURIComponent(position.code)}/qualifications`}
                    >
                      {canWrite ? t("settingsPosition.assign") : t("settingsPosition.view")}
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
                        {t("settingsPosition.delete")}
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
            {editing ? t("settingsPosition.editTitle") : t("settingsPosition.createTitle")}
          </DrawerTitle>
          <DrawerDescription className="mt-2 text-sm text-secondary">
            {editing
              ? t("settingsPosition.editDescription")
              : t("settingsPosition.createDescription")}
          </DrawerDescription>
          <div className="mt-8 space-y-4">
            {error ? (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
            <Input
              label={t("settingsPosition.name")}
              required
              placeholder={t("settingsPosition.nameExample")}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <Input
              label={t("settingsPosition.code")}
              required
              disabled={editing}
              placeholder={t("settingsPosition.codeExample")}
              value={draft.code}
              onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })}
              helperText={
                editing ? t("settingsPosition.codeLocked") : t("settingsPosition.codeUnique")
              }
            />
            <Textarea
              label={t("settingsPosition.descriptionField")}
              placeholder={t("settingsPosition.descriptionExample")}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
            <Input
              label={t("settingsPosition.sort")}
              type="number"
              min={0}
              value={draft.sortOrder}
              onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })}
            />
            <Switch
              label={t("settingsPosition.active")}
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
              helperText={t("settingsPosition.activeHelp")}
            />
          </div>
          <div className="mt-10 flex justify-end gap-3">
            <DrawerClose asChild>
              <Button type="button" variant="secondary">
                {t("common.cancel")}
              </Button>
            </DrawerClose>
            <Button type="button" loading={saving} onClick={() => void save()}>
              {t("settingsPosition.save")}
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
            {t("settingsPosition.deleteTitle", {
              suffix: deleteTarget ? `${locale === "zh-CN" ? "：" : ": "}${deleteTarget.name}` : "",
            })}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-secondary">
            {t("settingsPosition.deleteDescription")}
          </DialogDescription>
          <div className="mt-5 space-y-4">
            {deleteError ? (
              <p className="text-sm text-danger" role="alert">
                {deleteError}
              </p>
            ) : null}
            {forceConfirm && deleteTarget ? (
              <Alert tone="danger" title={t("settingsPosition.forceTitle")}>
                <p>{t("settingsPosition.forceDescription")}</p>
              </Alert>
            ) : deleteHistory ? (
              <Alert tone="warning" title={t("settingsPosition.historyTitle")}>
                <div className="space-y-2">
                  <p>
                    {t("settingsPosition.historyCounts", {
                      members: deleteHistory.memberAssignments ?? 0,
                      requirements: deleteHistory.qualificationRequirements ?? 0,
                      assignments: deleteHistory.qualificationAssignments ?? 0,
                      plans: deleteHistory.upgradePlans ?? 0,
                    })}
                  </p>
                  {!isSuperAdmin ? (
                    <p>{t("settingsPosition.contactSuper")}</p>
                  ) : (
                    <p>{t("settingsPosition.forceHistory")}</p>
                  )}
                </div>
              </Alert>
            ) : (
              <p className="text-sm leading-6 text-secondary">
                {t("settingsPosition.confirmDescription")}
              </p>
            )}
          </div>
          <div className="mt-7 flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={closeDelete} disabled={deleting}>
              {t("common.cancel")}
            </Button>
            {forceConfirm ? (
              <Button
                type="button"
                variant="danger"
                loading={deleting}
                onClick={() => void remove(true)}
              >
                {t("settingsPosition.confirmForce")}
              </Button>
            ) : deleteHistory && isSuperAdmin ? (
              <Button type="button" variant="danger" onClick={() => setForceConfirm(true)}>
                {t("settingsPosition.force")}
              </Button>
            ) : !deleteHistory ? (
              <Button
                type="button"
                variant="danger"
                loading={deleting}
                onClick={() => void remove()}
              >
                {t("settingsPosition.confirmDelete")}
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
