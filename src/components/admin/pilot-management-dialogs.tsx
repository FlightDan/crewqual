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
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";
import { localizedQualificationName } from "@/lib/i18n";

const emptyInput: PilotManagementInput = {
  employeeNumber: "",
  displayName: "",
  mobile: "",
  aircraftType: "",
  roleCode: "FIRST_OFFICER",
  unitCode: "",
  rankCode: "",
};

export function PilotManagementActions({ onCompleted }: { onCompleted: () => void }) {
  const { hasPermission, isSuperAdmin } = useAdminSession();
  const { pilotDirectory } = useApplicationServices();
  const { t } = useI18n();
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
            aria-label={t("pilotManagement.exportUnit")}
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
          {t("pilotManagement.downloadUnit")}
        </Button>
        {hasPermission("pilots.write") ? (
          <>
            <Button type="button" variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload aria-hidden="true" className="size-4" />
              {t("pilotManagement.importBatch")}
            </Button>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <UserPlus aria-hidden="true" className="size-4" />
              {t("pilotManagement.addPilot")}
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
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  if (!hasPermission("pilots.write")) return null;
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("pilotManagement.editProfile")}
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
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  if (!hasPermission("pilots.write")) return null;
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t("pilotManagement.addQualification")}
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
  const { locale, t } = useI18n();
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
      .catch((reason) =>
        setError(localizeError(reason, t, "pilotManagement.loadQualificationError")),
      );
  }, [open, pilot, pilotDirectory, t]);

  const update = (field: keyof AdminQualificationRecordCreateInput, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!qualificationId) {
      setError(t("pilotManagement.chooseQualification"));
      return;
    }
    const validation = adminQualificationRecordCreateSchema.safeParse(values);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("pilotManagement.checkQualification"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      await pilotDirectory.createQualificationRecord(pilot.id, qualificationId, validation.data);
      onCompleted();
    } catch (reason) {
      setError(localizeError(reason, t, "pilotManagement.qualificationSaveError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="text-lg font-bold">
          {t("pilotManagement.addQualificationTitle")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-secondary">
          {t("pilotManagement.addQualificationDescription")}
        </DialogDescription>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {!meta ? (
            <p className="text-sm text-secondary">{t("pilotManagement.loadingQualifications")}</p>
          ) : null}
          {meta && !availableQualifications.length ? (
            <Alert tone="info">{t("pilotManagement.allQualifications")}</Alert>
          ) : null}
          {meta && availableQualifications.length ? (
            <>
              <Select
                label={t("pilotManagement.qualification")}
                required
                value={qualificationId}
                onChange={(event) => {
                  setQualificationId(event.target.value);
                  setValues(emptyQualificationInput);
                }}
                options={availableQualifications.map((item) => ({
                  label: localizedQualificationName(item.name, item.translations, locale),
                  value: item.code,
                }))}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={t("pilotManagement.credential")}
                  required
                  value={values.credentialNumber}
                  onChange={(event) => update("credentialNumber", event.target.value)}
                />
                <Input
                  label={t("pilotManagement.issuingAuthority")}
                  required
                  value={values.issuingAuthority}
                  onChange={(event) => update("issuingAuthority", event.target.value)}
                />
                <Input
                  label={t("pilotManagement.issueDate")}
                  required
                  type="date"
                  value={values.issueDate}
                  onChange={(event) => update("issueDate", event.target.value)}
                />
                {selectedQualification?.validityRule.kind === "fixed_months" &&
                selectedQualification.validityRule.baseDateField === "trainingDate" ? (
                  <Input
                    label={t("pilotManagement.trainingDate")}
                    required
                    type="date"
                    value={values.trainingDate}
                    onChange={(event) => update("trainingDate", event.target.value)}
                  />
                ) : null}
                {selectedQualification?.validityRule.kind !== "non_expiring" ? (
                  <Input
                    label={t("pilotManagement.expiryDate")}
                    required
                    type="date"
                    readOnly={selectedQualification?.validityRule.kind === "fixed_months"}
                    value={values.expiryDate}
                    onChange={(event) => update("expiryDate", event.target.value)}
                  />
                ) : null}
                <Input
                  label={t("pilotManagement.level")}
                  required
                  value={values.levelOrParameter}
                  onChange={(event) => update("levelOrParameter", event.target.value)}
                />
              </div>
            </>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("pilotManagement.cancel")}
            </Button>
            <Button
              type="submit"
              loading={loading}
              disabled={!meta || !availableQualifications.length}
            >
              {t("pilotManagement.saveQualification")}
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
  const { t } = useI18n();
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
            roleCode: pilot.roleCode,
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
      .catch((reason) => setError(localizeError(reason, t, "pilotManagement.loadPilotError")));
  }, [open, pilot, pilotDirectory, t]);

  const update = (field: keyof PilotManagementInput, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validation = pilotManagementInputSchema.safeParse(values);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("pilotManagement.checkPilot"));
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
      setError(localizeError(reason, t, "pilotManagement.saveError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="text-lg font-bold">
          {pilot ? t("pilotManagement.editTitle") : t("pilotManagement.newTitle")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-secondary">
          {t("pilotManagement.editDescription")}
        </DialogDescription>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t("pilotManagement.employeeNumber")}
              required
              value={values.employeeNumber}
              onChange={(event) => update("employeeNumber", event.target.value)}
              placeholder={t("pilotManagement.employeeExample")}
            />
            <Input
              label={t("pilotManagement.name")}
              required
              value={values.displayName}
              onChange={(event) => update("displayName", event.target.value)}
            />
            <Input
              label={t("pilotManagement.mobile")}
              required
              inputMode="numeric"
              value={values.mobile}
              onChange={(event) => update("mobile", event.target.value)}
              placeholder={t("pilotManagement.mobileExample")}
            />
            <Input
              label={t("pilotManagement.aircraft")}
              required
              value={values.aircraftType}
              onChange={(event) => update("aircraftType", event.target.value)}
              placeholder={t("pilotManagement.aircraftExample")}
            />
            <Select
              label={t("pilotManagement.role")}
              required
              value={values.roleCode}
              onChange={(event) => update("roleCode", event.target.value)}
              options={[
                { label: t("pilotManagement.captain"), value: "CAPTAIN" },
                { label: t("pilotManagement.firstOfficer"), value: "FIRST_OFFICER" },
              ]}
            />
            <Input
              label={t("pilotManagement.rank")}
              required
              value={values.rankCode}
              onChange={(event) => update("rankCode", event.target.value)}
              placeholder={t("pilotManagement.rankExample")}
            />
            <Select
              label={t("pilotManagement.unit")}
              required
              value={values.unitCode}
              onChange={(event) => update("unitCode", event.target.value)}
              options={[
                { label: t("pilotManagement.chooseUnit"), value: "" },
                ...(meta?.units.map((unit) => ({
                  label: `${unit.name}（${unit.code}）`,
                  value: unit.code,
                })) ?? []),
              ]}
            />
            {pilot ? (
              <Select
                label={t("pilotManagement.status")}
                value={active ? "active" : "inactive"}
                onChange={(event) => setActive(event.target.value === "active")}
                helperText={!active ? t("pilotManagement.disableHelp") : undefined}
                options={[
                  { label: t("pilotManagement.enabled"), value: "active" },
                  { label: t("pilotManagement.disabled"), value: "inactive" },
                ]}
              />
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("pilotManagement.cancel")}
            </Button>
            <Button type="submit" loading={loading} disabled={!meta}>
              {pilot ? t("pilotManagement.saveEdit") : t("pilotManagement.confirmAdd")}
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
  const { t } = useI18n();
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
      .catch((reason) => setError(localizeError(reason, t, "pilotManagement.loadImportError")));
  }, [open, pilotDirectory, t]);

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
      setError(localizeError(reason, t, "pilotManagement.templateError"));
    }
  };

  const selectFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setPreview(null);
    setResult(null);
    setError("");
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
      setError(t("pilotManagement.chooseCsv"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(t("pilotManagement.csvSize"));
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
      setError(localizeError(reason, t, "pilotManagement.csvValidation"));
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
      setError(localizeError(reason, t, "pilotManagement.importError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogTitle className="flex items-center gap-2 text-lg font-bold">
          <FileSpreadsheet aria-hidden="true" className="size-5 text-brand" />
          {t("pilotManagement.importTitle")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-secondary">
          {t("pilotManagement.importDescription")}
        </DialogDescription>

        <div className="mt-5 space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {result ? (
            <Alert tone="success" title={t("pilotManagement.importDone")}>
              {t("pilotManagement.created", { count: result.createdCount })}
              {result.updatedCount
                ? t("pilotManagement.updated", { count: result.updatedCount })
                : ""}
              {t("pilotManagement.qualificationRows", { count: result.qualificationCount })}
              {result.skippedCount
                ? t("pilotManagement.skipped", { count: result.skippedCount })
                : ""}
            </Alert>
          ) : null}
          <section className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">{t("pilotManagement.step1")}</h3>
                <p className="mt-1 text-xs text-muted">{t("pilotManagement.fixedColumns")}</p>
              </div>
              <Button type="button" variant="secondary" onClick={downloadTemplate}>
                <Download aria-hidden="true" className="size-4" />
                {t("pilotManagement.downloadTemplate")}
              </Button>
            </div>
            {meta ? (
              <p className="mt-3 text-xs leading-5 text-secondary">
                {t("pilotManagement.templateSummary", {
                  qualifications: meta.qualifications.length,
                  columns: meta.csvHeaders.length,
                })}
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-bold">{t("pilotManagement.step2")}</h3>
            <Select
              className="mt-3"
              label={t("pilotManagement.importMode")}
              options={[
                { label: t("pilotManagement.createOnly"), value: "create_only" },
                { label: t("pilotManagement.merge"), value: "merge" },
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
              aria-label={t("pilotManagement.csvAria")}
              onChange={selectFile}
              disabled={loading}
            />
            <p className="mt-2 text-xs text-muted">{t("pilotManagement.csvHelp")}</p>
            {fileName ? (
              <p className="mt-2 text-xs font-semibold">
                {t("pilotManagement.selected", { name: fileName })}
              </p>
            ) : null}
          </section>

          {loading && !preview ? (
            <p role="status" className="text-sm text-secondary">
              {t("pilotManagement.validating")}
            </p>
          ) : null}

          {preview ? (
            <section className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold">{t("pilotManagement.step3")}</h3>
                <p className="text-xs text-secondary">
                  {t("pilotManagement.previewSummary", {
                    total: preview.total,
                    valid: preview.validCount,
                    errors: preview.errorCount,
                  })}
                  {mode === "merge"
                    ? t("pilotManagement.previewMerge", {
                        create: preview.createCount,
                        update: preview.updateCount,
                      })
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
                      <th className="px-3 py-2">{t("pilotManagement.row")}</th>
                      <th className="px-3 py-2">{t("pilotManagement.employee")}</th>
                      <th className="px-3 py-2">{t("pilotManagement.name")}</th>
                      <th className="px-3 py-2">{t("pilotManagement.qualificationCount")}</th>
                      <th className="px-3 py-2">{t("pilotManagement.validation")}</th>
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
                          {row.errors.length
                            ? row.errors.join("; ")
                            : t("pilotManagement.importable")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > 100 ? (
                <p className="text-xs text-muted">{t("pilotManagement.previewLimit")}</p>
              ) : null}
            </section>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {result ? t("pilotManagement.done") : t("pilotManagement.cancel")}
            </Button>
            {!result ? (
              <Button
                type="button"
                loading={loading}
                disabled={!preview?.validCount || Boolean(preview.fileErrors.length)}
                onClick={commitImport}
              >
                <Upload aria-hidden="true" className="size-4" />
                {t("pilotManagement.import", { count: preview?.validCount ?? 0 })}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
