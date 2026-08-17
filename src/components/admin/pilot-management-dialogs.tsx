"use client";

import * as React from "react";
import { Download, FileSpreadsheet, Upload, UserPlus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adminQualificationRecordCreateSchema } from "@/lib/admin-operations-validation";
import { pilotManagementInputSchema } from "@/lib/pilot-management-validation";
import { calculateExpectedExpiry } from "@/lib/qualification-rules";
import { useAdminSession } from "@/services/admin-session-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type {
  AdminPilotDetail,
  AdminQualificationRecordCreateInput,
  PilotImportPreview,
  PilotImportResult,
  PilotManagementInput,
  PilotManagementMeta,
} from "@/types/services";

const emptyInput: PilotManagementInput = {
  employeeNumber: "",
  displayName: "",
  mobile: "",
  aircraftType: "",
  role: "副驾驶",
  unitCode: "",
  rankCode: "",
};

export function PilotManagementActions({ onCompleted }: { onCompleted: () => void }) {
  const { hasPermission, isSuperAdmin } = useAdminSession();
  const { pilotDirectory } = useApplicationServices();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [exportUnitId, setExportUnitId] = React.useState("");
  const [exportUnits, setExportUnits] = React.useState<Array<{ label: string; value: string }>>([]);
  React.useEffect(() => {
    if (!isSuperAdmin) return;
    void pilotDirectory.getManagementMeta().then((response) => {
      setExportUnits(
        response.data.units.map((unit) => ({
          label: `${unit.name}（${unit.code}）`,
          value: unit.id,
        })),
      );
      setExportUnitId((current) => current || response.data.units[0]?.id || "");
    });
  }, [isSuperAdmin, pilotDirectory]);
  if (!hasPermission("pilots.read")) return null;
  const downloadExport = async () => {
    const response = await pilotDirectory.getCsvExport(isSuperAdmin ? exportUnitId : undefined);
    const url = URL.createObjectURL(
      new Blob([response.data.content], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = response.data.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {isSuperAdmin ? (
          <Select
            aria-label="导出中队"
            options={exportUnits}
            value={exportUnitId}
            onChange={(event) => setExportUnitId(event.target.value)}
          />
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => void downloadExport()}
          disabled={isSuperAdmin && !exportUnitId}
        >
          <Download aria-hidden="true" className="size-4" />
          下载中队数据
        </Button>
        {hasPermission("pilots.write") ? (
          <>
            <Button type="button" variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload aria-hidden="true" className="size-4" />
              批量导入
            </Button>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <UserPlus aria-hidden="true" className="size-4" />
              新增飞行员
            </Button>
          </>
        ) : null}
      </div>
      <PilotEditorDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCompleted={() => {
          onCompleted();
          setCreateOpen(false);
        }}
      />
      <PilotCsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onCompleted={onCompleted}
      />
    </>
  );
}

export function PilotEditAction({
  pilot,
  onCompleted,
}: {
  pilot: AdminPilotDetail;
  onCompleted: (pilot: AdminPilotDetail) => void;
}) {
  const { hasPermission } = useAdminSession();
  const [open, setOpen] = React.useState(false);
  if (!hasPermission("pilots.write")) return null;
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        编辑人员资料
      </Button>
      <PilotEditorDialog
        pilot={pilot}
        open={open}
        onOpenChange={setOpen}
        onCompleted={(updated) => {
          onCompleted(updated);
          setOpen(false);
        }}
      />
    </>
  );
}

export function PilotQualificationCreateAction({
  pilot,
  onCompleted,
}: {
  pilot: AdminPilotDetail;
  onCompleted: () => void;
}) {
  const { hasPermission } = useAdminSession();
  const [open, setOpen] = React.useState(false);
  if (!hasPermission("pilots.write")) return null;
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        新增资质
      </Button>
      <PilotQualificationCreateDialog
        pilot={pilot}
        open={open}
        onOpenChange={setOpen}
        onCompleted={() => {
          onCompleted();
          setOpen(false);
        }}
      />
    </>
  );
}

const emptyQualificationInput: AdminQualificationRecordCreateInput = {
  credentialNumber: "",
  issueDate: "",
  trainingDate: "",
  expiryDate: "",
  issuingAuthority: "",
  levelOrParameter: "",
};

function PilotQualificationCreateDialog({
  pilot,
  open,
  onOpenChange,
  onCompleted,
}: {
  pilot: AdminPilotDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const { pilotDirectory } = useApplicationServices();
  const [meta, setMeta] = React.useState<PilotManagementMeta | null>(null);
  const [qualificationId, setQualificationId] = React.useState("");
  const [values, setValues] =
    React.useState<AdminQualificationRecordCreateInput>(emptyQualificationInput);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const availableQualifications = (meta?.qualifications ?? []).filter(
    (item) => !pilot.qualificationRecords.some((record) => record.id === item.code),
  );
  const selectedQualification = meta?.qualifications.find((item) => item.code === qualificationId);

  React.useEffect(() => {
    const rule = selectedQualification?.validityRule;
    if (!rule) return;
    if (rule.kind === "non_expiring") {
      setValues((current) => (current.expiryDate ? { ...current, expiryDate: "" } : current));
      return;
    }
    if (rule.kind !== "fixed_months") return;
    const expected = calculateExpectedExpiry(
      {
        issueDate: values.issueDate,
        trainingDate: values.trainingDate,
      },
      rule,
    );
    if (expected && expected !== values.expiryDate) {
      setValues((current) => ({ ...current, expiryDate: expected }));
    }
  }, [
    selectedQualification?.validityRule,
    values.issueDate,
    values.trainingDate,
    values.expiryDate,
  ]);

  React.useEffect(() => {
    if (!open) return;
    setError("");
    setValues(emptyQualificationInput);
    setQualificationId("");
    void pilotDirectory
      .getManagementMeta()
      .then((result) => {
        setMeta(result.data);
        const existing = new Set(pilot.qualificationRecords.map((record) => record.id));
        setQualificationId(
          result.data.qualifications.find((item) => !existing.has(item.code))?.code ?? "",
        );
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法加载资质配置"));
  }, [open, pilot, pilotDirectory]);

  const update = (field: keyof AdminQualificationRecordCreateInput, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!qualificationId) {
      setError("请选择资质项目");
      return;
    }
    const validation = adminQualificationRecordCreateSchema.safeParse(values);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? "请检查资质信息");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await pilotDirectory.createQualificationRecord(pilot.id, qualificationId, validation.data);
      onCompleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资质保存失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="text-lg font-bold">新增人员资质</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-secondary">
          录入后立即成为生效记录，并写入管理员审计日志。后续更新需通过版本校验。
        </DialogDescription>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {!meta ? <p className="text-sm text-secondary">正在加载可用资质…</p> : null}
          {meta && !availableQualifications.length ? (
            <Alert tone="info">该人员已经拥有所有当前启用的资质项目。</Alert>
          ) : null}
          {meta && availableQualifications.length ? (
            <>
              <Select
                label="资质项目"
                required
                value={qualificationId}
                onChange={(event) => {
                  setQualificationId(event.target.value);
                  setValues(emptyQualificationInput);
                }}
                options={availableQualifications.map((item) => ({
                  label: item.name,
                  value: item.code,
                }))}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="证件编号"
                  required
                  value={values.credentialNumber}
                  onChange={(event) => update("credentialNumber", event.target.value)}
                />
                <Input
                  label="签发机构"
                  required
                  value={values.issuingAuthority}
                  onChange={(event) => update("issuingAuthority", event.target.value)}
                />
                <Input
                  label="取得日期"
                  required
                  type="date"
                  value={values.issueDate}
                  onChange={(event) => update("issueDate", event.target.value)}
                />
                {selectedQualification?.validityRule.kind === "fixed_months" &&
                selectedQualification.validityRule.baseDateField === "trainingDate" ? (
                  <Input
                    label="培训日期"
                    required
                    type="date"
                    value={values.trainingDate}
                    onChange={(event) => update("trainingDate", event.target.value)}
                  />
                ) : null}
                {selectedQualification?.validityRule.kind !== "non_expiring" ? (
                  <Input
                    label="到期日期"
                    required
                    type="date"
                    readOnly={selectedQualification?.validityRule.kind === "fixed_months"}
                    value={values.expiryDate}
                    onChange={(event) => update("expiryDate", event.target.value)}
                  />
                ) : null}
                <Input
                  label="等级/参数"
                  required
                  value={values.levelOrParameter}
                  onChange={(event) => update("levelOrParameter", event.target.value)}
                />
              </div>
            </>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type="submit"
              loading={loading}
              disabled={!meta || !availableQualifications.length}
            >
              保存资质
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PilotEditorDialog({
  pilot,
  open,
  onOpenChange,
  onCompleted,
}: {
  pilot?: AdminPilotDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: (pilot: AdminPilotDetail) => void;
}) {
  const { pilotDirectory } = useApplicationServices();
  const [meta, setMeta] = React.useState<PilotManagementMeta | null>(null);
  const [values, setValues] = React.useState<PilotManagementInput>(emptyInput);
  const [active, setActive] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setError("");
    setActive(pilot?.active ?? true);
    setValues(
      pilot
        ? {
            employeeNumber: pilot.employeeNumber,
            displayName: pilot.displayName,
            mobile: pilot.mobile,
            aircraftType: pilot.aircraftType,
            role: pilot.role.includes("机长") ? "机长" : "副驾驶",
            unitCode: pilot.unitCode,
            rankCode: pilot.rankCode,
          }
        : emptyInput,
    );
    void pilotDirectory
      .getManagementMeta()
      .then((result) => {
        setMeta(result.data);
        if (!pilot && result.data.units.length === 1) {
          setValues((current) => ({ ...current, unitCode: result.data.units[0]!.code }));
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法加载人员配置"));
  }, [open, pilot, pilotDirectory]);

  const update = (field: keyof PilotManagementInput, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validation = pilotManagementInputSchema.safeParse(values);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? "请检查人员信息");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = pilot
        ? await pilotDirectory.update(pilot.id, {
            ...validation.data,
            active,
            expectedVersion: pilot.version,
          })
        : await pilotDirectory.create(validation.data);
      onCompleted(result.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="text-lg font-bold">
          {pilot ? "编辑人员资料" : "新增飞行员"}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-secondary">
          新增人员默认处于启用状态；尚未录入资质时会显示“未建档”。
        </DialogDescription>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="员工号"
              required
              value={values.employeeNumber}
              onChange={(event) => update("employeeNumber", event.target.value)}
              placeholder="例如 CQ-1049"
            />
            <Input
              label="姓名"
              required
              value={values.displayName}
              onChange={(event) => update("displayName", event.target.value)}
            />
            <Input
              label="手机号"
              required
              inputMode="numeric"
              value={values.mobile}
              onChange={(event) => update("mobile", event.target.value)}
              placeholder="11 位手机号"
            />
            <Input
              label="机型"
              required
              value={values.aircraftType}
              onChange={(event) => update("aircraftType", event.target.value)}
              placeholder="例如 A320"
            />
            <Select
              label="职务"
              required
              value={values.role}
              onChange={(event) => update("role", event.target.value)}
              options={[
                { label: "机长", value: "机长" },
                { label: "副驾驶", value: "副驾驶" },
              ]}
            />
            <Input
              label="人员级别代码"
              required
              value={values.rankCode}
              onChange={(event) => update("rankCode", event.target.value)}
              placeholder="例如 CAPT-A / FO-2"
            />
            <Select
              label="所属单位"
              required
              value={values.unitCode}
              onChange={(event) => update("unitCode", event.target.value)}
              options={[
                { label: "请选择单位", value: "" },
                ...(meta?.units.map((unit) => ({
                  label: `${unit.name}（${unit.code}）`,
                  value: unit.code,
                })) ?? []),
              ]}
            />
            {pilot ? (
              <Select
                label="人员状态"
                value={active ? "active" : "inactive"}
                onChange={(event) => setActive(event.target.value === "active")}
                helperText={!active ? "停用后将注销该人员的访问令牌和登录会话" : undefined}
                options={[
                  { label: "启用", value: "active" },
                  { label: "停用", value: "inactive" },
                ]}
              />
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" loading={loading} disabled={!meta}>
              {pilot ? "保存修改" : "确认新增"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PilotCsvImportDialog({
  open,
  onOpenChange,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const { pilotDirectory } = useApplicationServices();
  const [meta, setMeta] = React.useState<PilotManagementMeta | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [csvText, setCsvText] = React.useState("");
  const [preview, setPreview] = React.useState<PilotImportPreview | null>(null);
  const [result, setResult] = React.useState<PilotImportResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [mode, setMode] = React.useState<"create_only" | "merge">("create_only");

  React.useEffect(() => {
    if (!open) return;
    setFileName("");
    setCsvText("");
    setPreview(null);
    setResult(null);
    setError("");
    void pilotDirectory
      .getManagementMeta()
      .then((response) => setMeta(response.data))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法加载导入配置"));
  }, [open, pilotDirectory]);

  const downloadTemplate = async () => {
    setError("");
    try {
      const response = await pilotDirectory.getCsvTemplate();
      const url = URL.createObjectURL(
        new Blob([response.data.content], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.data.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "模板下载失败");
    }
  };

  const selectFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setPreview(null);
    setResult(null);
    setError("");
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
      setError("请选择 .csv 文件");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("CSV 文件不能超过 2 MB");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsvText(text);
    setLoading(true);
    try {
      const response = await pilotDirectory.previewImport(text, mode);
      setPreview(response.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "CSV 校验失败");
    } finally {
      setLoading(false);
    }
  };

  const commitImport = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await pilotDirectory.importCsv(csvText, mode, mode === "merge");
      setResult(response.data);
      onCompleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入失败，请重新校验");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogTitle className="flex items-center gap-2 text-lg font-bold">
          <FileSpreadsheet aria-hidden="true" className="size-5 text-brand" />
          CSV 批量导入飞行员
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-secondary">
          先下载动态模板。模板会包含当前所有启用资质的开始日期、截止日期和级别列。
        </DialogDescription>

        <div className="mt-5 space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {result ? (
            <Alert tone="success" title="导入完成">
              新增 {result.createdCount} 人
              {result.updatedCount ? `、更新 ${result.updatedCount} 人` : ""}、写入{" "}
              {result.qualificationCount} 条资质
              {result.skippedCount ? `，跳过 ${result.skippedCount} 条错误记录` : ""}。
            </Alert>
          ) : null}
          <section className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">1. 下载并填写模板</h3>
                <p className="mt-1 text-xs text-muted">
                  基础列固定为员工号、姓名、手机号、机型、职务、单位代码、人员级别代码。
                </p>
              </div>
              <Button type="button" variant="secondary" onClick={downloadTemplate}>
                <Download aria-hidden="true" className="size-4" />
                下载 CSV 模板
              </Button>
            </div>
            {meta ? (
              <p className="mt-3 text-xs leading-5 text-secondary">
                当前模板包含 {meta.qualifications.length} 项资质，共 {meta.csvHeaders.length} 列。
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-bold">2. 上传并校验</h3>
            <Select
              className="mt-3"
              label="导入方式"
              options={[
                { label: "仅新增员工（重复员工号跳过）", value: "create_only" },
                { label: "合并并更新（需二次确认）", value: "merge" },
              ]}
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as "create_only" | "merge");
                setPreview(null);
              }}
            />
            <Input
              className="mt-3 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1 file:text-brand"
              type="file"
              accept=".csv,text/csv"
              aria-label="选择飞行员 CSV 文件"
              onChange={selectFile}
              disabled={loading}
            />
            <p className="mt-2 text-xs text-muted">
              UTF-8/UTF-8 BOM，最大 2 MB、1000 人。合并模式下空白资质列保持原值。
            </p>
            {fileName ? <p className="mt-2 text-xs font-semibold">已选择：{fileName}</p> : null}
          </section>

          {loading && !preview ? (
            <p role="status" className="text-sm text-secondary">
              正在校验 CSV…
            </p>
          ) : null}

          {preview ? (
            <section className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold">3. 校验预览</h3>
                <p className="text-xs text-secondary">
                  共 {preview.total} 行 · 可导入 {preview.validCount} 行 · 错误 {preview.errorCount}{" "}
                  行
                  {mode === "merge"
                    ? ` · 新增 ${preview.createCount} · 更新 ${preview.updateCount}`
                    : ""}
                </p>
              </div>
              {preview.fileErrors.map((message) => (
                <Alert key={message} tone="danger">
                  {message}
                </Alert>
              ))}
              <div className="max-h-72 overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-secondary">
                    <tr>
                      <th className="px-3 py-2">行号</th>
                      <th className="px-3 py-2">员工号</th>
                      <th className="px-3 py-2">姓名</th>
                      <th className="px-3 py-2">资质数</th>
                      <th className="px-3 py-2">校验结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 100).map((row) => (
                      <tr key={row.rowNumber} className="border-t border-border">
                        <td className="px-3 py-2">{row.rowNumber}</td>
                        <td className="px-3 py-2 font-medium">{row.employeeNumber || "—"}</td>
                        <td className="px-3 py-2">{row.displayName || "—"}</td>
                        <td className="px-3 py-2">{row.qualificationCount}</td>
                        <td
                          className={
                            row.errors.length ? "px-3 py-2 text-danger" : "px-3 py-2 text-success"
                          }
                        >
                          {row.errors.length ? row.errors.join("；") : "可导入"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > 100 ? (
                <p className="text-xs text-muted">页面仅展示前 100 行，导入仍会处理全部记录。</p>
              ) : null}
            </section>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {result ? "完成" : "取消"}
            </Button>
            {!result ? (
              <Button
                type="button"
                loading={loading}
                disabled={!preview?.validCount || Boolean(preview.fileErrors.length)}
                onClick={commitImport}
              >
                <Upload aria-hidden="true" className="size-4" />
                导入 {preview?.validCount ?? 0} 条有效记录
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
