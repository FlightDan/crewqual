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
import { useApplicationServices } from "@/services/application-services-provider";
import type { QualificationConfig, QualificationConfigInput, ValidityRule } from "@/types/services";
import { useAdminSession } from "@/services/admin-session-provider";

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
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
      <div>
        <p className="text-xs font-medium text-muted">成员管理 / {positionName} / 资质管理</p>
        <div className="mt-2 flex items-center gap-3">
          <h2 className="text-xl font-bold text-primary">{positionName}资质管理</h2>
          <Badge tone="info">{positionName}</Badge>
        </div>
        <p className="mt-1 text-sm text-secondary">
          配置{positionName}所需资质、有效期规则、提醒策略和审核要求
        </p>
      </div>
      {canWrite ? (
        <Button onClick={onCreate}>
          <Plus className="size-4" />
          新增资质项目
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-bold">新增资质项目</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          项目只属于当前职位；核心资质计入合规与升级硬约束，补充资质不计入核心完成率。
        </DialogDescription>
        <div className="mt-4 space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Input
            label="资质项目名称"
            required
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <Select
            label="资质类型"
            value={kind}
            onChange={(event) => onKindChange(event.target.value as QualificationKind)}
            options={[
              { value: "supplemental", label: "补充资质" },
              { value: "core", label: "核心资质" },
            ]}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button loading={loading} onClick={onCreate}>
              创建资质项目
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function configInput(config: QualificationConfig): QualificationConfigInput {
  return {
    name: config.name,
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
    PILOT: "飞行员",
    CABIN_CREW: "乘务员",
    MAINTENANCE: "机务人员",
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
      reset(configInput(config));
      setSelectedId(config.id);
      setError("");
      setSuccess("");
      setReady(true);
      replaceSelectedUrl(config.id);
    },
    [replaceSelectedUrl, reset],
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
        created.data.core ? "已新增当前职位的核心资质项目。" : "已新增当前职位的补充资质项目。",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "新增失败");
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
        <Alert tone="danger" title="资质配置加载失败">
          <div className="space-y-3">
            <p>{configsQuery.error instanceof Error ? configsQuery.error.message : "请稍后重试"}</p>
            <Button variant="secondary" onClick={() => void configsQuery.refetch()}>
              重新加载
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
            title="当前职位还没有资质项目"
            description="从新增资质项目开始，为此职位建立完全独立的核心或补充资质要求。"
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
      const saved = await qualificationConfigs.save(positionCode, selected.id, {
        ...getValues(),
        expectedVersion: selected.version,
      });
      queryClient.setQueryData<QualificationConfig[]>(
        [...qualificationConfigsQueryKey, positionCode],
        (current) => current?.map((item) => (item.id === saved.data.id ? saved.data : item)),
      );
      reset(configInput(saved.data));
      setImpactOpen(false);
      setSuccess("配置已保存，仅影响后续申请、合规与提醒计算。现有生效记录未被回写。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
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
            ["all", `全部资质 ${configs.length}`],
            ["core", `核心资质 ${configs.filter((item) => item.core).length}`],
            [
              "supplemental",
              `补充资质 ${configs.filter((item) => !item.core && item.active).length}`,
            ],
            ["inactive", `已停用 ${configs.filter((item) => !item.active).length}`],
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
      {!canWrite ? (
        <Alert tone="info">当前角色可以查看资质配置，但不能修改或新增项目。</Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="p-3 shadow-none">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold">资质项目（{configs.length}）</h3>
            <Badge tone="info">核心 {configs.filter((item) => item.core).length} 项</Badge>
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
                    <p className="text-sm font-bold">{config.name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      <span>{config.code}</span>
                      <Badge tone="info">{positionName}</Badge>
                      <Badge tone={config.core ? "danger" : "info"}>
                        {config.core ? "核心资质" : "补充资质"}
                      </Badge>
                      <Badge tone={config.active ? "success" : "neutral"}>
                        {config.active ? "启用" : "停用"}
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
              <h3 className="text-base font-bold">{selected.name} - 资质项目配置</h3>
              <p className="mt-1 text-xs text-muted">稳定编码：{selected.code}</p>
            </div>
            <Badge tone={selected.core ? "danger" : "info"}>
              {selected.core ? "核心硬约束" : "补充项目"}
            </Badge>
          </div>
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
                  label="资质项目名称"
                  required
                  disabled={selected.locked}
                  helperText={selected.locked ? "模板核心资质不可改名" : "同一职位内名称不得重复"}
                  error={errors.name?.message}
                  {...register("name")}
                />
                <Input label="资质唯一识别码" disabled value={selected.code} readOnly />
              </div>
              <section
                className="space-y-3 rounded-lg border border-border p-4"
                aria-label="自定义填报条目"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold">自定义填报条目</h4>
                    <p className="mt-1 text-xs text-muted">
                      为此资质增加需要填写的信息，并限制数字、英文或位数。
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
                    添加条目
                  </Button>
                </div>
                {!customFieldRows.length ? (
                  <p className="rounded-md bg-surface px-3 py-4 text-center text-xs text-muted">
                    暂无自定义条目；点击“添加条目”开始配置。
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
                            <p className="text-xs font-bold text-secondary">条目 {index + 1}</p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`删除条目 ${index + 1}`}
                              className="text-danger"
                              onClick={() => removeCustomField(index)}
                            >
                              <Trash2 aria-hidden="true" className="size-4" />
                              删除
                            </Button>
                          </div>
                          <input type="hidden" {...register(`customFields.${index}.id`)} />
                          <div className="grid gap-3 md:grid-cols-2">
                            <Input
                              label="条目名称"
                              required
                              placeholder="例如：执照编号"
                              error={fieldErrors?.label?.message}
                              {...register(`customFields.${index}.label`)}
                            />
                            <Select
                              label="可填写内容"
                              required
                              options={Object.entries(qualificationFieldValueTypeLabels).map(
                                ([value, label]) => ({ value, label }),
                              )}
                              error={fieldErrors?.valueType?.message}
                              {...register(`customFields.${index}.valueType`)}
                            />
                            <Input
                              label="最少位数"
                              type="number"
                              min={0}
                              max={256}
                              helperText="0 表示不限制"
                              error={fieldErrors?.minLength?.message}
                              {...register(`customFields.${index}.minLength`, {
                                valueAsNumber: true,
                              })}
                            />
                            <Input
                              label="最多位数"
                              type="number"
                              min={0}
                              max={256}
                              helperText="与最少位数相同即为固定长度"
                              error={fieldErrors?.maxLength?.message}
                              {...register(`customFields.${index}.maxLength`, {
                                valueAsNumber: true,
                              })}
                            />
                          </div>
                          <Input
                            label="填写提示"
                            placeholder="例如：请输入 8 位英文和数字"
                            error={fieldErrors?.placeholder?.message}
                            {...register(`customFields.${index}.placeholder`)}
                          />
                          <Switch
                            label="必填条目"
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
                label="显示等级/参数帮助说明"
                checked={parameterEnabled}
                onChange={(event) =>
                  setValue("parameterRestriction.enabled", event.target.checked, {
                    shouldDirty: true,
                  })
                }
              />
              <Textarea
                label="等级/参数帮助说明"
                disabled={!parameterEnabled}
                error={errors.parameterRestriction?.description?.message}
                {...register("parameterRestriction.description")}
              />
              {parameterEnabled ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Select
                    label="服务端强制规则"
                    value={parameterMode}
                    onChange={(event) =>
                      setValue(
                        "parameterRestriction.enforcement.mode",
                        event.target.value as "none" | "allowed_values" | "regex",
                        { shouldDirty: true, shouldValidate: true },
                      )
                    }
                    options={[
                      { value: "none", label: "不强制（仅显示说明）" },
                      { value: "allowed_values", label: "只允许指定值" },
                      { value: "regex", label: "正则格式校验" },
                    ]}
                  />
                  {parameterMode === "allowed_values" ? (
                    <Textarea
                      label="允许值（每行一个）"
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
                      label="正则表达式"
                      placeholder="例如 ^A320-(I|II)$"
                      {...register("parameterRestriction.enforcement.pattern")}
                    />
                  ) : null}
                </div>
              ) : null}
              {!selected.locked ? (
                <Switch
                  label={`启用此${selected.core ? "核心" : "补充"}资质项目`}
                  checked={watch("active")}
                  onChange={(event) =>
                    setValue("active", event.target.checked, { shouldDirty: true })
                  }
                  helperText="停用后保留历史记录，但不再计入当前职位要求。"
                />
              ) : null}
              <fieldset>
                <legend className="text-sm font-bold">有效期测算规则</legend>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  {[
                    { value: "fixed_months", label: "按基础日期自动计算" },
                    { value: "manual_expiry", label: "人工指定到期日" },
                    { value: "non_expiring", label: "长期有效" },
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
                    label="基础日期字段"
                    required
                    value={
                      watch("validityRule.kind") === "fixed_months"
                        ? watch("validityRule.baseDateField")
                        : "issueDate"
                    }
                    options={[
                      { value: "issueDate", label: "发证日期" },
                      { value: "trainingDate", label: "训练完成日期" },
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
                    label="有效期（月）"
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
                <h4 className="text-sm font-bold">两级临期提醒</h4>
                <div className="mt-2 grid gap-4 md:grid-cols-2">
                  <Input
                    label="首次提醒（到期前天数）"
                    type="number"
                    min={1}
                    max={365}
                    required
                    error={errors.reminders?.firstDays?.message}
                    {...register("reminders.firstDays", { valueAsNumber: true })}
                  />
                  <Input
                    label="再次提醒（到期前天数）"
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
                      ["dueRecipients", "临期提醒发送给"],
                      ["expiredRecipients", "过期提醒发送给"],
                    ] as const
                  ).map(([field, label]) => (
                    <fieldset key={field} className="rounded-lg border border-border p-3">
                      <legend className="px-1 text-xs font-semibold text-secondary">{label}</legend>
                      <div className="mt-2 grid gap-2">
                        {(
                          [
                            ["PERSON", "本人"],
                            ["ADMIN", "本单位 ADMIN"],
                            ["SUPER_ADMIN", "组织 SUPER_ADMIN"],
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
                        可取消本人；全部取消表示关闭此类提醒。
                      </p>
                    </fieldset>
                  ))}
                </div>
                {dueRecipients.length === 0 || expiredRecipients.length === 0 ? (
                  <Alert tone="warning" className="mt-3">
                    当前有一类提醒未配置接收人，该类提醒将被关闭。
                  </Alert>
                ) : null}
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                <Switch
                  label="启用 AI/OCR 辅助核验配置"
                  checked={ocrEnabled}
                  onChange={(event) =>
                    setValue("ocrChecks.enabled", event.target.checked, { shouldDirty: true })
                  }
                />
                <div className="mt-2 grid gap-1 md:grid-cols-2">
                  {[
                    ["credentialNumber", "证件号/序列号"],
                    ["holderMatch", "持有人姓名匹配"],
                    ["expiryDate", "截止日期核对"],
                    ["issuingAuthoritySeal", "签发机构/印章"],
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
                  仅供辅助，不产生自动审批、自动退回或终审决定。
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!isDirty}
                  onClick={() => reset(configInput(selected))}
                >
                  放弃修改
                </Button>
                <Button type="submit" disabled={!isDirty}>
                  <Save className="size-4" />
                  保存并查看影响摘要
                </Button>
              </div>
            </fieldset>
          </form>
        </Card>
      </div>
      <Dialog open={impactOpen} onOpenChange={setImpactOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">配置影响摘要</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-secondary">
            保存后，新规则只用于未来申请校验与提醒队列计算。不会追溯修改任何成员当前生效记录，也不会触发
            AI 自动审批决定。
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImpactOpen(false)}>
              返回检查
            </Button>
            <Button loading={loading} onClick={() => void save()}>
              确认保存
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
          <DialogTitle className="text-lg font-bold">放弃未保存的配置修改？</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-secondary">
            当前项目仍有未保存内容。切换后这些本地表单修改将被放弃，不会写入其他资质项目。
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPendingSelectedId(null);
                replaceSelectedUrl(selected.id);
              }}
            >
              继续编辑
            </Button>
            <Button variant="danger" onClick={discardAndSelect}>
              放弃并切换
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
