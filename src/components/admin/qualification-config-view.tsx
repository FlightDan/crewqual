"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { PageContainer } from "@/components/layout/page-container";
import { useAdminPositions } from "@/components/layout/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Switch } from "@/components/ui/choice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { qualificationConfigInputSchema } from "@/lib/admin-operations-validation";
import { qualificationFieldValueTypeLabels } from "@/lib/qualification-fields";
import { localizeError } from "@/lib/error-i18n";
import { localizedQualificationName } from "@/lib/i18n";
import { useApplicationServices } from "@/services/application-services-provider";
import type { QualificationConfig, QualificationConfigInput, ValidityRule } from "@/types/services";
import { useAdminSession } from "@/services/admin-session-provider";
import { useI18n } from "@/components/i18n-provider";

const qualificationConfigsQueryKey = ["admin", "qualification-configs"] as const;
type QualificationKind = "core" | "supplemental";

function PositionQualificationHeader({
  positionName,
  canWrite,
  onCreate,
}: {
  positionName: string;
  canWrite: boolean;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
      <div>
        <p className="text-xs font-medium text-muted">
          {t("qualificationConfig.breadcrumb", { position: positionName })}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <h2 className="text-xl font-bold text-primary">
            {t("qualificationConfig.title", { position: positionName })}
          </h2>
          <Badge tone="info">{positionName}</Badge>
        </div>
        <p className="mt-1 text-sm text-secondary">
          {t("qualificationConfig.description", { position: positionName })}
        </p>
      </div>
      {canWrite ? (
        <Button onClick={onCreate}>
          <Plus className="size-4" />
          {t("qualificationConfig.create")}
        </Button>
      ) : null}
    </div>
  );
}

function CreateQualificationDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  kind,
  onKindChange,
  error,
  loading,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  kind: QualificationKind;
  onKindChange: (kind: QualificationKind) => void;
  error: string;
  loading: boolean;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-bold">
          {t("qualificationConfig.createTitle")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          {t("qualificationConfig.createDescription")}
        </DialogDescription>
        <div className="mt-4 space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Input
            label={t("qualificationConfig.name")}
            required
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <Select
            label={t("qualificationConfig.kind")}
            value={kind}
            onChange={(event) => onKindChange(event.target.value as QualificationKind)}
            options={[
              { value: "supplemental", label: t("qualificationConfig.supplemental") },
              { value: "core", label: t("qualificationConfig.core") },
            ]}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t("qualificationConfig.cancel")}
            </Button>
            <Button loading={loading} onClick={onCreate}>
              {t("qualificationConfig.createAction")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function configInput(
  config: QualificationConfig,
  locale: "zh-CN" | "en-US",
): QualificationConfigInput {
  return {
    name: localizedQualificationName(config.name, config.translations, locale),
    translations: { ...config.translations },
    locale,
    active: config.active,
    customFields: config.customFields ?? [],
    parameterRestriction: {
      ...config.parameterRestriction,
      version: 1,
      enforcement: config.parameterRestriction.enforcement ?? {
        mode: "none",
        allowedValues: [],
        pattern: "",
      },
    },
    validityRule: { ...config.validityRule } as ValidityRule,
    reminders: {
      ...config.reminders,
      dueRecipients: config.reminders.dueRecipients ?? ["PERSON"],
      expiredRecipients: config.reminders.expiredRecipients ?? ["PERSON"],
    },
    ocrChecks: { ...config.ocrChecks },
  };
}

export function QualificationConfigView({ positionCode = "PILOT" }: { positionCode?: string }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const positions = useAdminPositions(pathname);
  const { qualificationConfigs } = useApplicationServices();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission("operations.write");
  const queryClient = useQueryClient();
  const configsQuery = useQuery({
    queryKey: [...qualificationConfigsQueryKey, positionCode],
    queryFn: async () => (await qualificationConfigs.list(positionCode)).data,
  });
  const configs = React.useMemo(() => configsQuery.data ?? [], [configsQuery.data]);
  const positionNames: Record<string, string> = {
    PILOT: t("positions.pilot"),
    CABIN_CREW: t("positions.cabinCrew"),
    MAINTENANCE: t("positions.maintenance"),
  };
  const positionName =
    positions.find((position) => position.code === positionCode)?.name ??
    positionNames[positionCode] ??
    positionCode;
  const [filter, setFilter] = React.useState<"all" | "core" | "supplemental" | "inactive">("all");
  const filteredConfigs = React.useMemo(
    () =>
      configs.filter((config) =>
        filter === "all"
          ? true
          : filter === "core"
            ? config.core
            : filter === "supplemental"
              ? !config.core && config.active
              : !config.active,
      ),
    [configs, filter],
  );
  const [selectedId, setSelectedId] = React.useState("");
  const selected = configs.find((item) => item.id === selectedId);
  const [pendingSelectedId, setPendingSelectedId] = React.useState<string | null>(null);
  const [impactOpen, setImpactOpen] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newKind, setNewKind] = React.useState<QualificationKind>("supplemental");
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const {
    register,
    control,
    reset,
    watch,
    setValue,
    trigger,
    getValues,
    formState: { errors, isDirty },
  } = useForm<QualificationConfigInput>({
    resolver: zodResolver(qualificationConfigInputSchema),
    defaultValues: undefined,
  });
  const {
    fields: customFieldRows,
    append: appendCustomField,
    remove: removeCustomField,
  } = useFieldArray({ control, name: "customFields", keyName: "formId" });
  const initializedRef = React.useRef(false);
  const previousPositionCodeRef = React.useRef(positionCode);
  const replaceSelectedUrl = React.useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("config", id);
      const search = next.toString();
      const hash = typeof window === "undefined" ? "" : window.location.hash;
      const nextUrl = `${pathname}${search ? `?${search}` : ""}${hash}`;
      if (typeof window !== "undefined") {
        const currentUrl = `${window.location.pathname}${window.location.search}${hash}`;
        if (currentUrl !== nextUrl) {
          window.history.replaceState(window.history.state, "", nextUrl);
        }
      }
    },
    [params, pathname],
  );

  const applySelection = React.useCallback(
    (config: QualificationConfig) => {
      reset(configInput(config, locale));
      setSelectedId(config.id);
      setError("");
      setSuccess("");
      setReady(true);
      replaceSelectedUrl(config.id);
    },
    [locale, replaceSelectedUrl, reset],
  );

  React.useEffect(() => {
    if (!configsQuery.isSuccess || !configs.length || initializedRef.current) return;
    initializedRef.current = true;
    const requestedId = params.get("config");
    const target = configs.find((item) => item.id === requestedId) ?? configs[0];
    if (target) applySelection(target);
  }, [applySelection, configs, configsQuery.isSuccess, params]);

  React.useEffect(() => {
    if (previousPositionCodeRef.current === positionCode) return;
    previousPositionCodeRef.current = positionCode;
    initializedRef.current = false;
    setSelectedId("");
    setReady(false);
    setFilter("all");
  }, [positionCode]);

  const openCreate = () => {
    setError("");
    setNewName("");
    setNewKind("supplemental");
    setNewOpen(true);
  };

  const createQualification = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const created = await qualificationConfigs.create({
        positionCode,
        kind: newKind,
        name: newName,
        translations: { [locale]: newName },
        locale,
        active: true,
        customFields: [],
        parameterRestriction: {
          enabled: false,
          description: "",
          version: 1,
          enforcement: { mode: "none", allowedValues: [], pattern: "" },
        },
        validityRule: { kind: "manual_expiry" },
        reminders: { firstDays: 60, secondDays: 30 },
        ocrChecks: {
          enabled: false,
          credentialNumber: false,
          holderMatch: false,
          expiryDate: false,
          issuingAuthoritySeal: false,
        },
      });
      queryClient.setQueryData<QualificationConfig[]>(
        [...qualificationConfigsQueryKey, positionCode],
        (current) => [...(current ?? []), created.data],
      );
      initializedRef.current = true;
      applySelection(created.data);
      setNewName("");
      setNewKind("supplemental");
      setNewOpen(false);
      setSuccess(
        created.data.core
          ? t("qualificationConfig.createdCore")
          : t("qualificationConfig.createdSupplemental"),
      );
    } catch (reason) {
      setError(localizeError(reason, t, "qualificationConfig.createError"));
    } finally {
      setLoading(false);
    }
  };

  if (configsQuery.isPending)
    return (
      <PageContainer>
        <Skeleton className="h-96" />
      </PageContainer>
    );
  if (configsQuery.isError)
    return (
      <PageContainer>
        <Alert tone="danger" title={t("qualificationConfig.loadError")}>
          <div className="space-y-3">
            <p>
              {configsQuery.error instanceof Error
                ? configsQuery.error.message
                : t("qualificationConfig.retryLater")}
            </p>
            <Button variant="secondary" onClick={() => void configsQuery.refetch()}>
              {t("qualificationConfig.retry")}
            </Button>
          </div>
        </Alert>
      </PageContainer>
    );
  if (!configs.length)
    return (
      <PageContainer className="space-y-5">
        <PositionQualificationHeader
          positionName={positionName}
          canWrite={canWrite}
          onCreate={openCreate}
        />
        <Card className="p-8 shadow-none">
          <EmptyState
            title={t("qualificationConfig.emptyTitle")}
            description={t("qualificationConfig.emptyDescription")}
          />
        </Card>
        <CreateQualificationDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          name={newName}
          onNameChange={setNewName}
          kind={newKind}
          onKindChange={setNewKind}
          error={error}
          loading={loading}
          onCreate={() => void createQualification()}
        />
      </PageContainer>
    );
  if (!ready || !selected)
    return (
      <PageContainer>
        <Skeleton className="h-96" />
      </PageContainer>
    );
  const validityKind = watch("validityRule.kind");
  const parameterEnabled = watch("parameterRestriction.enabled");
  const parameterMode = watch("parameterRestriction.enforcement.mode") ?? "none";
  const parameterAllowedValues = watch("parameterRestriction.enforcement.allowedValues") ?? [];
  const ocrEnabled = watch("ocrChecks.enabled");
  const dueRecipients = watch("reminders.dueRecipients") ?? [];
  const expiredRecipients = watch("reminders.expiredRecipients") ?? [];
  const validityError = errors.validityRule as
    { months?: { message?: string }; message?: string } | undefined;
  const selectConfig = (id: string) => {
    if (id === selected.id) return;
    if (isDirty) {
      setPendingSelectedId(id);
      return;
    }
    const target = configs.find((item) => item.id === id);
    if (target) applySelection(target);
  };
  const discardAndSelect = () => {
    if (!pendingSelectedId) return;
    const target = configs.find((item) => item.id === pendingSelectedId);
    if (!target) {
      setPendingSelectedId(null);
      replaceSelectedUrl(selected.id);
      return;
    }
    setPendingSelectedId(null);
    applySelection(target);
  };
  const prepareSave = async () => {
    setError("");
    if (await trigger()) setImpactOpen(true);
  };
  const save = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const values = getValues();
      const saved = await qualificationConfigs.save(positionCode, selected.id, {
        ...values,
        name: locale === "zh-CN" ? values.name : selected.name,
        translations: { ...selected.translations, ...(values.translations ?? {}) },
        locale,
        expectedVersion: selected.version,
      });
      queryClient.setQueryData<QualificationConfig[]>(
        [...qualificationConfigsQueryKey, positionCode],
        (current) => current?.map((item) => (item.id === saved.data.id ? saved.data : item)),
      );
      reset(configInput(saved.data, locale));
      setImpactOpen(false);
      setSuccess(t("qualificationConfig.saved"));
    } catch (reason) {
      setError(localizeError(reason, t, "qualificationConfig.saveError"));
      setImpactOpen(false);
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer className="space-y-5">
      <PositionQualificationHeader
        positionName={positionName}
        canWrite={canWrite}
        onCreate={openCreate}
      />
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", t("qualificationConfig.filterAll", { count: configs.length })],
            [
              "core",
              t("qualificationConfig.filterCore", {
                count: configs.filter((item) => item.core).length,
              }),
            ],
            [
              "supplemental",
              t("qualificationConfig.filterSupplemental", {
                count: configs.filter((item) => !item.core && item.active).length,
              }),
            ],
            [
              "inactive",
              t("qualificationConfig.filterInactive", {
                count: configs.filter((item) => !item.active).length,
              }),
            ],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${filter === value ? "bg-brand text-white" : "border border-border bg-card text-secondary hover:border-brand"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Existing detailed configuration form remains unchanged below. */}
      {!canWrite ? <Alert tone="info">{t("qualificationConfig.readonly")}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="p-3 shadow-none">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold">
              {t("qualificationConfig.items", { count: configs.length })}
            </h3>
            <Badge tone="info">
              {t("qualificationConfig.coreCount", {
                count: configs.filter((item) => item.core).length,
              })}
            </Badge>
          </div>
          <div className="space-y-2">
            {filteredConfigs.map((config, index) => (
              <button
                type="button"
                key={config.id}
                data-testid={`qualification-config-${config.id}`}
                onClick={() => selectConfig(config.id)}
                className={`w-full rounded-lg border p-3 text-left ${config.id === selected.id ? "border-brand bg-blue-50" : "border-border bg-card"}`}
              >
                <div className="flex items-start gap-2">
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-brand">
                    {config.core ? index + 1 : "+"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">
                      {localizedQualificationName(config.name, config.translations, locale)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      <span>{config.code}</span>
                      <Badge tone="info">{positionName}</Badge>
                      <Badge tone={config.core ? "danger" : "info"}>
                        {config.core
                          ? t("qualificationConfig.core")
                          : t("qualificationConfig.supplemental")}
                      </Badge>
                      <Badge tone={config.active ? "success" : "neutral"}>
                        {config.active
                          ? t("qualificationConfig.enabled")
                          : t("qualificationConfig.disabled")}
                      </Badge>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
        <Card className="p-4 shadow-none" data-testid="qualification-config-editor">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <h3 className="text-base font-bold">
                {t("qualificationConfig.editorTitle", {
                  name: localizedQualificationName(selected.name, selected.translations, locale),
                })}
              </h3>
              <p className="mt-1 text-xs text-muted">
                {t("qualificationConfig.stableCode", { code: selected.code })}
              </p>
            </div>
            <Badge tone={selected.core ? "danger" : "info"}>
              {selected.core
                ? t("qualificationConfig.coreConstraint")
                : t("qualificationConfig.supplementalItem")}
            </Badge>
          </div>
          {selected.locked ? (
            <Alert tone="info" className="mt-4">
              {t("qualificationConfig.coreConstraintDescription")}
            </Alert>
          ) : null}
          <form
            className="mt-4 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void prepareSave();
            }}
          >
            <fieldset disabled={!canWrite} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label={t("qualificationConfig.name")}
                  required
                  disabled={!canWrite}
                  helperText={t("qualificationConfig.uniqueName")}
                  error={errors.name?.message}
                  {...register("name", {
                    onChange: (event) => {
                      setValue(`translations.${locale}`, event.target.value, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    },
                  })}
                />
                <Input
                  label={t("qualificationConfig.uniqueCode")}
                  disabled
                  value={selected.code}
                  readOnly
                />
              </div>
              <fieldset disabled={selected.locked} className="space-y-5">
                <section
                  className="space-y-3 rounded-lg border border-border p-4"
                  aria-label={t("qualificationConfig.customFieldsAria")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold">{t("qualificationConfig.customFields")}</h4>
                      <p className="mt-1 text-xs text-muted">
                        {t("qualificationConfig.customFieldsDescription")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        appendCustomField({
                          id: `field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                          label: "",
                          valueType: "text",
                          required: true,
                          minLength: 0,
                          maxLength: 0,
                          placeholder: "",
                        })
                      }
                    >
                      <Plus aria-hidden="true" className="size-4" />
                      {t("qualificationConfig.addField")}
                    </Button>
                  </div>
                  {!customFieldRows.length ? (
                    <p className="rounded-md bg-surface px-3 py-4 text-center text-xs text-muted">
                      {t("qualificationConfig.noCustomFields")}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {customFieldRows.map((field, index) => {
                        const fieldErrors = errors.customFields?.[index];
                        return (
                          <div
                            key={field.formId}
                            className="space-y-3 rounded-md border border-border bg-surface p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-bold text-secondary">
                                {t("qualificationConfig.field", { index: index + 1 })}
                              </p>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`${t("qualificationConfig.removeField")} ${index + 1}`}
                                className="text-danger"
                                onClick={() => removeCustomField(index)}
                              >
                                <Trash2 aria-hidden="true" className="size-4" />
                                {t("qualificationConfig.removeField")}
                              </Button>
                            </div>
                            <input type="hidden" {...register(`customFields.${index}.id`)} />
                            <div className="grid gap-3 md:grid-cols-2">
                              <Input
                                label={t("qualificationConfig.fieldName")}
                                required
                                placeholder={t("qualificationConfig.fieldExample")}
                                error={fieldErrors?.label?.message}
                                {...register(`customFields.${index}.label`)}
                              />
                              <Select
                                label={t("qualificationConfig.valueType")}
                                required
                                options={Object.entries(qualificationFieldValueTypeLabels).map(
                                  ([value, label]) => ({ value, label }),
                                )}
                                error={fieldErrors?.valueType?.message}
                                {...register(`customFields.${index}.valueType`)}
                              />
                              <Input
                                label={t("qualificationConfig.minLength")}
                                type="number"
                                min={0}
                                max={256}
                                helperText={t("qualificationConfig.noLimit")}
                                error={fieldErrors?.minLength?.message}
                                {...register(`customFields.${index}.minLength`, {
                                  valueAsNumber: true,
                                })}
                              />
                              <Input
                                label={t("qualificationConfig.maxLength")}
                                type="number"
                                min={0}
                                max={256}
                                helperText={t("qualificationConfig.fixedLength")}
                                error={fieldErrors?.maxLength?.message}
                                {...register(`customFields.${index}.maxLength`, {
                                  valueAsNumber: true,
                                })}
                              />
                            </div>
                            <Input
                              label={t("qualificationConfig.placeholder")}
                              placeholder={t("qualificationConfig.placeholderExample")}
                              error={fieldErrors?.placeholder?.message}
                              {...register(`customFields.${index}.placeholder`)}
                            />
                            <Switch
                              label={t("qualificationConfig.required")}
                              checked={watch(`customFields.${index}.required`)}
                              onChange={(event) =>
                                setValue(`customFields.${index}.required`, event.target.checked, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                })
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
                <Switch
                  label={t("qualificationConfig.parameterHelpToggle")}
                  checked={parameterEnabled}
                  onChange={(event) =>
                    setValue("parameterRestriction.enabled", event.target.checked, {
                      shouldDirty: true,
                    })
                  }
                />
                <Textarea
                  label={t("qualificationConfig.parameterHelp")}
                  disabled={!parameterEnabled}
                  error={errors.parameterRestriction?.description?.message}
                  {...register("parameterRestriction.description")}
                />
                {parameterEnabled ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Select
                      label={t("qualificationConfig.serverRule")}
                      value={parameterMode}
                      onChange={(event) =>
                        setValue(
                          "parameterRestriction.enforcement.mode",
                          event.target.value as "none" | "allowed_values" | "regex",
                          { shouldDirty: true, shouldValidate: true },
                        )
                      }
                      options={[
                        { value: "none", label: t("qualificationConfig.ruleNone") },
                        { value: "allowed_values", label: t("qualificationConfig.ruleAllowed") },
                        { value: "regex", label: t("qualificationConfig.ruleRegex") },
                      ]}
                    />
                    {parameterMode === "allowed_values" ? (
                      <Textarea
                        label={t("qualificationConfig.allowedValues")}
                        value={parameterAllowedValues.join("\n")}
                        onChange={(event) =>
                          setValue(
                            "parameterRestriction.enforcement.allowedValues",
                            event.target.value
                              .split(/\r?\n/)
                              .map((item) => item.trim())
                              .filter(Boolean),
                            { shouldDirty: true, shouldValidate: true },
                          )
                        }
                      />
                    ) : null}
                    {parameterMode === "regex" ? (
                      <Input
                        label={t("qualificationConfig.regex")}
                        placeholder={t("qualificationConfig.regexExample")}
                        {...register("parameterRestriction.enforcement.pattern")}
                      />
                    ) : null}
                  </div>
                ) : null}
                {!selected.locked ? (
                  <Switch
                    label={t("qualificationConfig.enableItem", {
                      kind: selected.core
                        ? t("qualificationConfig.core")
                        : t("qualificationConfig.supplemental"),
                    })}
                    checked={watch("active")}
                    onChange={(event) =>
                      setValue("active", event.target.checked, { shouldDirty: true })
                    }
                    helperText={t("qualificationConfig.keepHistory")}
                  />
                ) : null}
                <fieldset>
                  <legend className="text-sm font-bold">
                    {t("qualificationConfig.validityRule")}
                  </legend>
                  <div className="mt-2 grid gap-3 md:grid-cols-3">
                    {[
                      { value: "fixed_months", label: t("qualificationConfig.fixedMonths") },
                      { value: "manual_expiry", label: t("qualificationConfig.manualExpiry") },
                      { value: "non_expiring", label: t("qualificationConfig.nonExpiring") },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm"
                      >
                        <input
                          type="radio"
                          checked={validityKind === option.value}
                          onChange={() =>
                            setValue(
                              "validityRule",
                              option.value === "fixed_months"
                                ? { kind: "fixed_months", baseDateField: "issueDate", months: 12 }
                                : option.value === "manual_expiry"
                                  ? { kind: "manual_expiry" }
                                  : { kind: "non_expiring" },
                              { shouldDirty: true },
                            )
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {validityKind === "fixed_months" ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Select
                      label={t("qualificationConfig.baseDateField")}
                      required
                      value={
                        watch("validityRule.kind") === "fixed_months"
                          ? watch("validityRule.baseDateField")
                          : "issueDate"
                      }
                      options={[
                        { value: "issueDate", label: t("qualificationConfig.issueDate") },
                        { value: "trainingDate", label: t("qualificationConfig.trainingDate") },
                      ]}
                      onChange={(event) =>
                        setValue(
                          "validityRule",
                          {
                            kind: "fixed_months",
                            baseDateField: event.target.value as "issueDate" | "trainingDate",
                            months:
                              watch("validityRule.kind") === "fixed_months"
                                ? watch("validityRule.months")
                                : 12,
                          },
                          { shouldDirty: true },
                        )
                      }
                    />
                    <Input
                      label={t("qualificationConfig.validityMonths")}
                      type="number"
                      min={1}
                      max={120}
                      required
                      error={validityError?.months?.message ?? validityError?.message}
                      {...register("validityRule.months", { valueAsNumber: true })}
                    />
                  </div>
                ) : null}
                <div>
                  <h4 className="text-sm font-bold">{t("qualificationConfig.reminders")}</h4>
                  <div className="mt-2 grid gap-4 md:grid-cols-2">
                    <Input
                      label={t("qualificationConfig.firstReminder")}
                      type="number"
                      min={1}
                      max={365}
                      required
                      error={errors.reminders?.firstDays?.message}
                      {...register("reminders.firstDays", { valueAsNumber: true })}
                    />
                    <Input
                      label={t("qualificationConfig.secondReminder")}
                      type="number"
                      min={1}
                      max={365}
                      required
                      error={errors.reminders?.secondDays?.message}
                      {...register("reminders.secondDays", { valueAsNumber: true })}
                    />
                  </div>
                  {errors.reminders?.firstDays?.message ? null : errors.reminders?.message ? (
                    <p className="mt-1 text-xs text-danger">{errors.reminders.message}</p>
                  ) : null}
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {(
                      [
                        ["dueRecipients", t("qualificationConfig.dueRecipients")],
                        ["expiredRecipients", t("qualificationConfig.expiredRecipients")],
                      ] as const
                    ).map(([field, label]) => (
                      <fieldset key={field} className="rounded-lg border border-border p-3">
                        <legend className="px-1 text-xs font-semibold text-secondary">
                          {label}
                        </legend>
                        <div className="mt-2 grid gap-2">
                          {(
                            [
                              ["PERSON", t("qualificationConfig.person")],
                              ["ADMIN", t("qualificationConfig.admin")],
                              ["SUPER_ADMIN", t("qualificationConfig.superAdmin")],
                            ] as const
                          ).map(([value, text]) => (
                            <Checkbox
                              key={value}
                              label={text}
                              value={value}
                              {...register(`reminders.${field}`)}
                            />
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-muted">
                          {t("qualificationConfig.cancelRecipient")}
                        </p>
                      </fieldset>
                    ))}
                  </div>
                  {dueRecipients.length === 0 || expiredRecipients.length === 0 ? (
                    <Alert tone="warning" className="mt-3">
                      {t("qualificationConfig.noRecipient")}
                    </Alert>
                  ) : null}
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                  <Switch
                    label={t("qualificationConfig.ocrToggle")}
                    checked={ocrEnabled}
                    onChange={(event) =>
                      setValue("ocrChecks.enabled", event.target.checked, { shouldDirty: true })
                    }
                  />
                  <div className="mt-2 grid gap-1 md:grid-cols-2">
                    {[
                      ["credentialNumber", t("qualificationConfig.credentialNumber")],
                      ["holderMatch", t("qualificationConfig.holderMatch")],
                      ["expiryDate", t("qualificationConfig.expiryDate")],
                      ["issuingAuthoritySeal", t("qualificationConfig.issuingSeal")],
                    ].map(([field, label]) => (
                      <Checkbox
                        key={field}
                        label={label}
                        disabled={!ocrEnabled}
                        {...register(
                          `ocrChecks.${field as "credentialNumber" | "holderMatch" | "expiryDate" | "issuingAuthoritySeal"}`,
                        )}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs font-semibold text-brand">
                    {t("qualificationConfig.ocrDisclaimer")}
                  </p>
                </div>
              </fieldset>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!isDirty}
                  onClick={() => reset(configInput(selected, locale))}
                >
                  {t("qualificationConfig.discard")}
                </Button>
                <Button type="submit" disabled={!isDirty}>
                  <Save className="size-4" />
                  {t("qualificationConfig.saveImpact")}
                </Button>
              </div>
            </fieldset>
          </form>
        </Card>
      </div>
      <Dialog open={impactOpen} onOpenChange={setImpactOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">
            {t("qualificationConfig.impactTitle")}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-secondary">
            {t("qualificationConfig.impactDescription")}
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImpactOpen(false)}>
              {t("qualificationConfig.backCheck")}
            </Button>
            <Button loading={loading} onClick={() => void save()}>
              {t("qualificationConfig.confirmSave")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <CreateQualificationDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        name={newName}
        onNameChange={setNewName}
        kind={newKind}
        onKindChange={setNewKind}
        error={error}
        loading={loading}
        onCreate={() => void createQualification()}
      />
      <Dialog
        open={Boolean(pendingSelectedId)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingSelectedId(null);
            replaceSelectedUrl(selected.id);
          }
        }}
      >
        <DialogContent>
          <DialogTitle className="text-lg font-bold">
            {t("qualificationConfig.discardTitle")}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-secondary">
            {t("qualificationConfig.discardDescription")}
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPendingSelectedId(null);
                replaceSelectedUrl(selected.id);
              }}
            >
              {t("qualificationConfig.continueEdit")}
            </Button>
            <Button variant="danger" onClick={discardAndSelect}>
              {t("qualificationConfig.discardSwitch")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
