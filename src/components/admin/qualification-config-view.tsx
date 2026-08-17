"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Switch } from "@/components/ui/choice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/misc";
import { qualificationConfigInputSchema } from "@/lib/admin-operations-validation";
import { useApplicationServices } from "@/services/application-services-provider";
import type { QualificationConfig, QualificationConfigInput, ValidityRule } from "@/types/services";
import { useAdminSession } from "@/services/admin-session-provider";

const qualificationConfigsQueryKey = ["admin", "qualification-configs"] as const;

function configInput(config: QualificationConfig): QualificationConfigInput {
  return {
    name: config.name,
    active: config.active,
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
    reminders: { ...config.reminders },
    ocrChecks: { ...config.ocrChecks },
  };
}

export function QualificationConfigView() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { qualificationConfigs } = useApplicationServices();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission("operations.write");
  const queryClient = useQueryClient();
  const configsQuery = useQuery({
    queryKey: qualificationConfigsQueryKey,
    queryFn: async () => (await qualificationConfigs.list()).data,
  });
  const configs = React.useMemo(() => configsQuery.data ?? [], [configsQuery.data]);
  const [selectedId, setSelectedId] = React.useState("");
  const selected = configs.find((item) => item.id === selectedId);
  const [pendingSelectedId, setPendingSelectedId] = React.useState<string | null>(null);
  const [impactOpen, setImpactOpen] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const {
    register,
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
  const initializedRef = React.useRef(false);
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
      <PageContainer>
        <Alert tone="danger">没有可用的资质配置。</Alert>
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
      const saved = await qualificationConfigs.save(selected.id, {
        ...getValues(),
        expectedVersion: selected.version,
      });
      queryClient.setQueryData<QualificationConfig[]>(qualificationConfigsQueryKey, (current) =>
        current?.map((item) => (item.id === saved.data.id ? saved.data : item)),
      );
      reset(configInput(saved.data));
      setImpactOpen(false);
      setSuccess("配置已保存，仅影响后续申请与提醒计算。现有飞行员生效记录未被回写。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
      setImpactOpen(false);
    } finally {
      setLoading(false);
    }
  };
  const createSupplemental = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const created = await qualificationConfigs.createSupplemental({
        name: newName,
        active: true,
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
      queryClient.setQueryData<QualificationConfig[]>(qualificationConfigsQueryKey, (current) => [
        ...(current ?? []),
        created.data,
      ]);
      applySelection(created.data);
      setNewName("");
      setNewOpen(false);
      setSuccess("已新增非核心补充资质项目，不计入六项核心资质完成率。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "新增失败");
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title="核心及补充资质配置"
        description="六项核心名称与 ID 固定；保存只影响未来业务规则"
        action={
          canWrite ? (
            <Button
              onClick={() => {
                setError("");
                setNewOpen(true);
              }}
            >
              <Plus className="size-4" />
              新增资质项目
            </Button>
          ) : undefined
        }
      />
      {!canWrite ? (
        <Alert tone="info">当前角色可以查看资质配置，但不能修改或新增项目。</Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="p-3 shadow-none">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold">资质项目（{configs.length}）</h3>
            <Badge tone="info">核心 6 项</Badge>
          </div>
          <div className="space-y-2">
            {configs.map((config, index) => (
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
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                      <span>{config.code}</span>
                      <span>
                        {config.core ? "核心·启用" : config.active ? "补充·启用" : "补充·停用"}
                      </span>
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
                  disabled={selected.core}
                  helperText={selected.core ? "六项核心资质不可改名" : "补充项目名称不得重复"}
                  error={errors.name?.message}
                  {...register("name")}
                />
                <Input label="资质唯一识别码" disabled value={selected.code} readOnly />
              </div>
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
              {!selected.core ? (
                <Switch
                  label="启用此补充资质项目"
                  checked={watch("active")}
                  onChange={(event) =>
                    setValue("active", event.target.checked, { shouldDirty: true })
                  }
                  helperText="本批只允许停用，不提供物理删除。"
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
            保存后，新规则只用于未来申请校验与提醒队列计算。不会追溯修改任何飞行员当前生效记录，也不会触发
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
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">新增补充资质项目</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            自动生成稳定 custom ID/编码；补充项目不计入六项核心完成率，后续只可停用不可删除。
          </DialogDescription>
          <div className="mt-4 space-y-4">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Input
              label="补充资质名称"
              required
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setNewOpen(false)}>
                取消
              </Button>
              <Button loading={loading} onClick={() => void createSupplemental()}>
                创建补充项目
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
