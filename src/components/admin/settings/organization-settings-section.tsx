"use client";

import { BUSINESS_TIMEZONES } from "@/lib/date-only";
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
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";
import type { SettingsUnit } from "@/types/admin-settings";

const emptyUnit = {
  code: "",
  name: "",
  timezone: "Asia/Shanghai",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  active: true,
};

function validateUnit(values: typeof emptyUnit, t: (key: string) => string) {
  if (!values.name.trim()) return t("settingsOrg.requiredName");
  if (!values.code.trim()) return t("settingsOrg.requiredCode");
  if (!/^[A-Z0-9-]{2,32}$/.test(values.code.trim().toUpperCase()))
    return t("settingsOrg.codeFormat");
  if (values.contactEmail && !/^\S+@\S+\.\S+$/.test(values.contactEmail))
    return t("settingsOrg.emailFormat");
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
  const { t, setLocale } = useI18n();
  const timezoneOptions = [
    ...new Set([...BUSINESS_TIMEZONES, ...units.map((unit) => unit.timezone)]),
  ].map((value) => ({
    value,
    label:
      value === "Asia/Shanghai"
        ? t("settingsOrg.tzShanghai")
        : value === "Asia/Hong_Kong"
          ? t("settingsOrg.tzHongKong")
          : value === "UTC"
            ? t("settingsOrg.tzUtc")
            : value,
  }));
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState(units[0]?.id ?? "");
  const selected = units.find((item) => item.id === selectedId) ?? units[0];
  const [draft, setDraft] = React.useState<SettingsUnit | null>(selected ?? null);
  const [saving, setSaving] = React.useState(false);
  const [savingLocale, setSavingLocale] = React.useState(false);
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
    const validation = validateUnit(draft, t);
    if (validation) {
      setError(validation);
      notify("danger", t("settingsOrg.saveError"), validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await adminSettingsService.saveUnit(draft);
      onUnitsChange(units.map((item) => (item.id === saved.id ? saved : item)));
      setDraft(saved);
      notify("success", t("settingsOrg.saved"), t("settingsOrg.updated", { name: saved.name }));
    } catch (reason) {
      notify("danger", t("settingsOrg.saveError"), localizeError(reason, t));
    } finally {
      setSaving(false);
    }
  };

  const saveSystemLocale = async (nextLocale: "zh-CN" | "en-US") => {
    if (!draft?.organizationId || !isSuperAdmin) return;
    setSavingLocale(true);
    setError(null);
    try {
      const saved = await adminSettingsService.saveOrganizationLocale({
        organizationId: draft.organizationId,
        defaultLocale: nextLocale,
        expectedVersion: draft.organizationVersion,
      });
      onUnitsChange(
        units.map((item) =>
          item.organizationId === saved.organizationId
            ? {
                ...item,
                defaultLocale: saved.defaultLocale,
                organizationVersion: saved.organizationVersion,
              }
            : item,
        ),
      );
      setDraft((current) =>
        current
          ? {
              ...current,
              defaultLocale: saved.defaultLocale,
              organizationVersion: saved.organizationVersion,
            }
          : current,
      );
      setLocale(nextLocale);
      notify("success", t("settingsOrg.localeSaved"));
    } catch (reason) {
      notify("danger", t("settingsOrg.localeSaveError"), localizeError(reason, t));
    } finally {
      setSavingLocale(false);
    }
  };

  const createUnit = async () => {
    const validation = validateUnit(createDraft, t);
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
      notify("success", t("settingsOrg.created"), t("settingsOrg.joined", { name: created.name }));
    } catch (reason) {
      setError(localizeError(reason, t, "settingsOrg.createError"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="organization-settings-title">
      <SettingsSectionHeader
        title={t("settingsOrg.title")}
        description={
          isSuperAdmin ? t("settingsOrg.superDescription") : t("settingsOrg.unitDescription")
        }
        action={
          isSuperAdmin && canWrite ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" className="size-4" />
              {t("settingsOrg.addUnit")}
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
                  aria-label={t("settingsOrg.search")}
                  placeholder={t("settingsOrg.searchPlaceholder")}
                  className="min-h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>
              <div
                className="max-h-[560px] space-y-2 overflow-y-auto"
                aria-label={t("settingsOrg.list")}
              >
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
                        {unit.active ? t("settingsOrg.enabled") : t("settingsOrg.disabled")}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-xs text-muted">{unit.code}</span>
                    <span className="mt-2 block text-xs text-secondary">
                      {t("settingsOrg.peopleAdmins", {
                        people: unit.pilotCount,
                        admins: unit.adminCount,
                      })}
                    </span>
                  </button>
                ))}
                {!filtered.length ? (
                  <p className="py-8 text-center text-sm text-muted">{t("settingsOrg.noMatch")}</p>
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
                  <p className="mt-1 text-xs text-muted">{t("settingsOrg.codeLocked")}</p>
                </div>
                <Badge tone={draft.active ? "success" : "neutral"}>
                  {draft.active ? t("settingsOrg.enabled") : t("settingsOrg.disabled")}
                </Badge>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <FieldGrid>
                <Select
                  label={t("settingsOrg.systemLocale")}
                  options={[
                    { value: "zh-CN", label: t("settingsOrg.localeZh") },
                    { value: "en-US", label: t("settingsOrg.localeEn") },
                  ]}
                  value={draft.defaultLocale}
                  disabled={!isSuperAdmin || !canWrite || savingLocale}
                  onChange={(event) =>
                    void saveSystemLocale(event.target.value as "zh-CN" | "en-US")
                  }
                  helperText={t("settingsOrg.systemLocaleHelp")}
                />
                <Input
                  label={t("settingsOrg.name")}
                  required
                  value={draft.name}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
                <Input label={t("settingsOrg.code")} value={draft.code} disabled />
                <Select
                  label={t("settingsOrg.timezone")}
                  options={timezoneOptions}
                  value={draft.timezone}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
                />
                <Input
                  label={t("settingsOrg.contact")}
                  value={draft.contactName}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, contactName: event.target.value })}
                />
                <Input
                  label={t("settingsOrg.email")}
                  type="email"
                  value={draft.contactEmail}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })}
                />
                <Input
                  label={t("settingsOrg.phone")}
                  value={draft.contactPhone}
                  disabled={!canWrite}
                  onChange={(event) => setDraft({ ...draft, contactPhone: event.target.value })}
                />
              </FieldGrid>
              {isSuperAdmin ? (
                <div className="rounded-md border border-border p-3">
                  <Switch
                    label={t("settingsOrg.enableUnit")}
                    checked={draft.active}
                    disabled={!canWrite}
                    onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                    helperText={t("settingsOrg.disableHelp")}
                  />
                </div>
              ) : null}
              {canWrite ? (
                <div className="flex justify-end">
                  <Button type="button" loading={saving} onClick={() => void save()}>
                    {t("settingsOrg.save")}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent aria-describedby="create-unit-description">
          <DialogTitle className="text-lg font-bold">{t("settingsOrg.createTitle")}</DialogTitle>
          <DialogDescription id="create-unit-description" className="mt-1 text-sm text-secondary">
            {t("settingsOrg.createDescription")}
          </DialogDescription>
          <div className="mt-5 space-y-4">
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Input
              label={t("settingsOrg.name")}
              required
              value={createDraft.name}
              onChange={(event) => setCreateDraft({ ...createDraft, name: event.target.value })}
            />
            <Input
              label={t("settingsOrg.code")}
              required
              placeholder="e.g. FLT-01-SQ-03"
              value={createDraft.code}
              onChange={(event) =>
                setCreateDraft({ ...createDraft, code: event.target.value.toUpperCase() })
              }
            />
            <Select
              label={t("settingsOrg.timezone")}
              options={timezoneOptions}
              value={createDraft.timezone}
              onChange={(event) => setCreateDraft({ ...createDraft, timezone: event.target.value })}
            />
            <Input
              label={t("settingsOrg.contact")}
              value={createDraft.contactName}
              onChange={(event) =>
                setCreateDraft({ ...createDraft, contactName: event.target.value })
              }
            />
            <Input
              label={t("settingsOrg.email")}
              type="email"
              value={createDraft.contactEmail}
              onChange={(event) =>
                setCreateDraft({ ...createDraft, contactEmail: event.target.value })
              }
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" loading={creating} onClick={() => void createUnit()}>
              {t("settingsOrg.create")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
