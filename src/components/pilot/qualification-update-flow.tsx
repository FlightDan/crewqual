"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldHint, FieldLabel, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  AiNotice,
  AiReviewPanel,
  AssistStatusCard,
  CredentialUpload,
  DateCandidates,
  DateSourceLabel,
  ImageCropDialog,
  SubmitConfirmDialog,
  UpdateSteps,
} from "@/components/pilot/update-parts";
import {
  createQualificationUpdateSchema,
  isDraftSubmittable,
  sourceAfterDateChange,
  type QualificationFormValues,
} from "@/lib/pilot-validation";
import { useApplicationServices } from "@/services/application-services-provider";
import { qualificationDraftRepository } from "@/services/session-repository";
import { cn } from "@/lib/utils";
import { validateSourceImage } from "@/lib/image-processing";
import { calculateExpectedExpiry } from "@/lib/qualification-rules";
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";
import type {
  DateCandidate,
  DateFieldName,
  DocumentAssistState,
  PilotFlowScenario,
  Qualification,
  QualificationUpdateDraft,
} from "@/types/services";

const demoFields: QualificationFormValues = {
  credentialNumber: "MOCK-CQ-2026-01",
  issueDate: "2026-01-09",
  trainingDate: "",
  expiryDate: "2026-10-09",
  issuingAuthority: "示例民航资质签发机构",
  levelOrParameter: "合格（A级无限制）",
};

function initialScenarioState(
  scenario: PilotFlowScenario,
  t: (key: string, values?: Record<string, string | number>) => string,
): DocumentAssistState {
  const recognized = {
    kind: "recognized" as const,
    dates: { issueDate: "2026-01-09", expiryDate: "2026-10-09" },
    confidence: { issueDate: 0.98, expiryDate: 0.96 },
  };
  switch (scenario) {
    case "recognizing":
    case "confirm":
      return { kind: "recognizing" };
    case "ambiguous":
      return {
        kind: "ambiguous",
        field: "expiryDate",
        candidates: [
          {
            id: "c1",
            field: "expiryDate",
            value: "2026-10-09",
            confidence: 0.94,
            description: t("update.candidate.expiry"),
          },
          {
            id: "c2",
            field: "expiryDate",
            value: "2026-09-09",
            confidence: 0.82,
            description: t("update.candidate.issueSupplement"),
          },
          {
            id: "c3",
            field: "expiryDate",
            value: "2027-01-09",
            confidence: 0.78,
            description: t("update.candidate.renewal"),
          },
        ],
      };
    case "conflict":
      return {
        kind: "conflict",
        field: "expiryDate",
        manualValue: "2026-10-09",
        aiCandidate: {
          id: "conflict",
          field: "expiryDate",
          value: "2026-09-09",
          confidence: 0.92,
          description: t("update.candidate.aiExpiry"),
        },
      };
    case "mismatch":
      return {
        kind: "mismatch",
        message: t("update.mismatchMessage"),
        documentValue: "2026-09-09",
        formValue: "2026-10-09",
      };
    case "busy":
      return { kind: "busy", operation: "recognize", retryable: true };
    case "default":
      return { kind: "idle" };
    case "recognized":
    case "modified":
      return recognized;
  }
}

function isAssistPending(state: DocumentAssistState) {
  return ["recognizing", "reviewing", "ambiguous", "conflict"].includes(state.kind);
}

export function QualificationUpdateFlow({
  qualification,
  scenario = "default",
  portal = "pilot",
}: {
  qualification: Qualification;
  scenario?: PilotFlowScenario;
  portal?: "pilot" | "member";
}) {
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const router = useRouter();
  const { locale, t } = useI18n();
  const { documentIntelligence, evidenceImages, submissions } = useApplicationServices();
  const draftKey = qualification.id;
  const [document, setDocument] = React.useState(() => ({
    evidenceId: "",
    name: "",
    type: "",
    size: 0,
    previewUrl: "",
  }));
  const [assist, setAssist] = React.useState<DocumentAssistState>({ kind: "idle" });
  const [dateSources, setDateSources] = React.useState<QualificationUpdateDraft["dateSources"]>({});
  const [fileError, setFileError] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [cropFile, setCropFile] = React.useState<File | null>(null);
  const [cropOpen, setCropOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const initialized = React.useRef(false);
  const validityRule = React.useMemo(
    () => qualification.validityRule ?? ({ kind: "manual_expiry" } as const),
    [qualification.validityRule],
  );
  const formSchema = React.useMemo(
    () => createQualificationUpdateSchema(validityRule, qualification.parameterRestriction),
    [qualification.parameterRestriction, validityRule],
  );

  React.useEffect(() => {
    return () => {
      if (document.previewUrl && typeof URL.revokeObjectURL === "function")
        URL.revokeObjectURL(document.previewUrl);
    };
  }, [document.previewUrl]);

  const {
    register,
    reset,
    setValue,
    getValues,
    watch,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<QualificationFormValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: {
      credentialNumber: "",
      issueDate: "",
      trainingDate: "",
      expiryDate: "",
      issuingAuthority: "",
      levelOrParameter: "",
    },
  });

  const values = watch();
  const buildDraft = React.useCallback(
    (formValues = getValues()): QualificationUpdateDraft => ({
      qualificationId: qualification.id,
      evidenceId: document.evidenceId,
      documentName: document.name,
      documentType: document.type,
      documentSize: document.size,
      documentPreviewUrl: "",
      ...formValues,
      dateSources,
    }),
    [dateSources, document, getValues, qualification.id],
  );

  React.useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (scenario !== "default") {
      const nextValues = { ...demoFields };
      if (scenario === "ambiguous") nextValues.expiryDate = "";
      reset(nextValues);
      setDocument({
        evidenceId: "",
        name: "示例凭证.jpg",
        type: "image/jpeg",
        size: 1_400_000,
        previewUrl: "",
      });
      setAssist(initialScenarioState(scenario, t));
      setDateSources(
        scenario === "modified"
          ? { issueDate: "ai", expiryDate: "manual_modified" }
          : scenario === "recognized" || scenario === "mismatch" || scenario === "ambiguous"
            ? {
                issueDate: "ai",
                ...(scenario === "ambiguous" ? {} : { expiryDate: "ai" as const }),
              }
            : { issueDate: "manual", expiryDate: "manual" },
      );
      if (scenario === "confirm") setConfirmOpen(true);
      return;
    }
    const saved = qualificationDraftRepository.get(draftKey);
    if (!saved) return;
    reset({
      credentialNumber: saved.credentialNumber,
      issueDate: saved.issueDate,
      trainingDate: saved.trainingDate ?? "",
      expiryDate: saved.expiryDate,
      issuingAuthority: saved.issuingAuthority,
      levelOrParameter: saved.levelOrParameter,
    });
    setDocument({
      evidenceId: saved.evidenceId ?? "",
      name: saved.evidenceId ? "已上传凭证.jpg" : saved.documentName,
      type: saved.evidenceId ? "image/jpeg" : saved.documentType,
      size: saved.evidenceId ? 0 : saved.documentSize,
      previewUrl: "",
    });
    if (saved.evidenceId)
      void evidenceImages
        .getSignedUrl(saved.evidenceId)
        .then((result) => setDocument((current) => ({ ...current, previewUrl: result.data.url })))
        .catch(() => undefined);
    setDateSources(saved.dateSources);
  }, [draftKey, evidenceImages, reset, scenario, t]);

  React.useEffect(() => {
    if (validityRule.kind === "non_expiring") {
      if (getValues("expiryDate")) {
        setValue("expiryDate", "", { shouldValidate: true, shouldDirty: true });
      }
      return;
    }
    if (validityRule.kind !== "fixed_months") return;
    const expected = calculateExpectedExpiry(
      { issueDate: values.issueDate, trainingDate: values.trainingDate || null },
      validityRule,
    );
    if (expected && getValues("expiryDate") !== expected) {
      setValue("expiryDate", expected, { shouldValidate: true, shouldDirty: true });
    }
  }, [getValues, setValue, validityRule, values.issueDate, values.trainingDate]);

  React.useEffect(() => {
    if (!initialized.current || scenario !== "default") return;
    const draft = buildDraft(values);
    if (draft.documentName || Object.values(values).some(Boolean)) {
      qualificationDraftRepository.set(draftKey, {
        ...draft,
        documentName: "",
        documentType: "",
        documentSize: 0,
        documentPreviewUrl: "",
      });
    }
  }, [buildDraft, draftKey, scenario, values]);

  const consumeRecognition = React.useCallback(
    (state: DocumentAssistState) => {
      if (state.kind === "recognized") {
        const current = getValues();
        const nextSources = { ...dateSources };
        let conflict: DocumentAssistState | null = null;
        for (const field of ["issueDate", "expiryDate"] as const) {
          if (!state.dates[field]) continue;
          if (!current[field]) {
            setValue(field, state.dates[field]!, { shouldValidate: true, shouldDirty: true });
            nextSources[field] = "ai";
          } else if (current[field] !== state.dates[field] && !conflict) {
            conflict = {
              kind: "conflict",
              field,
              manualValue: current[field],
              aiCandidate: {
                id: `recognized-${field}`,
                field,
                value: state.dates[field]!,
                confidence: state.confidence[field] ?? 0,
                description:
                  field === "issueDate" ? t("update.issueDate") : t("update.candidate.aiExpiry"),
              },
            };
          }
        }
        setDateSources(nextSources);
        setAssist(conflict ?? state);
        return;
      }
      setAssist(state);
    },
    [dateSources, getValues, setValue, t],
  );

  const runRecognition = React.useCallback(
    async (
      file: string | Pick<File, "name" | "type" | "size">,
      nextScenario: PilotFlowScenario,
    ) => {
      setAssist({ kind: "recognizing" });
      try {
        const result = await documentIntelligence.recognizeDates(file, nextScenario);
        consumeRecognition(result.data);
      } catch {
        setAssist({ kind: "busy", operation: "recognize", retryable: true });
      }
    },
    [consumeRecognition, documentIntelligence],
  );

  const handleFile = async (file: File) => {
    const sourceError = validateSourceImage(file);
    if (sourceError) {
      setFileError(sourceError);
      return;
    }
    setFileError("");
    setCropFile(file);
    const mockMode =
      process.env.NEXT_PUBLIC_SERVICE_MODE !== "remote" && process.env.NODE_ENV !== "production";
    if (mockMode || process.env.NODE_ENV === "test") {
      await completeProcessedImage(file, file.name);
    } else {
      setCropOpen(true);
    }
  };

  const completeProcessedImage = async (processed: Blob, name: string) => {
    setUploading(true);
    try {
      const previewUrl =
        typeof URL.createObjectURL === "function" ? URL.createObjectURL(processed) : "";
      const upload = await evidenceImages.uploadProcessedJpeg(processed);
      setDocument({
        evidenceId: upload.data.id,
        name: name.replace(/\.[^.]+$/, ".jpg"),
        type: "image/jpeg",
        size: processed.size,
        previewUrl,
      });
      await runRecognition(
        process.env.NODE_ENV === "test"
          ? { name: "evidence.jpg", type: "image/jpeg", size: processed.size }
          : upload.data.id,
        scenario,
      );
    } catch {
      setFileError(t("update.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const changeDate = (field: DateFieldName, nextValue: string) => {
    const previousValue = getValues(field);
    const nextSource = sourceAfterDateChange(previousValue, nextValue, dateSources[field]);
    setDateSources((current) => ({ ...current, [field]: nextSource }));
    setValue(field, nextValue, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
  };

  const selectCandidate = (candidate: DateCandidate) => {
    setValue(candidate.field, candidate.value, { shouldValidate: true, shouldDirty: true });
    setDateSources((current) => ({ ...current, [candidate.field]: "ai" }));
    setAssist({
      kind: "recognized",
      dates: { issueDate: getValues("issueDate"), expiryDate: candidate.value },
      confidence: { issueDate: 0.98, expiryDate: candidate.confidence },
    });
  };

  const runReview = async (nextScenario: PilotFlowScenario = scenario) => {
    setAssist({ kind: "reviewing" });
    const result = await documentIntelligence.reviewDocument(buildDraft(), nextScenario);
    setAssist(result.data);
  };

  const performSubmit = async (formValues = getValues()) => {
    setSubmitting(true);
    try {
      const result = await submissions.submitQualificationUpdate(buildDraft(formValues));
      qualificationDraftRepository.remove(draftKey);
      const destination = `${portalPath}/submissions/${result.data.id}`;
      router.push(destination);
      if (result.source === "remote" && typeof window !== "undefined") {
        window.setTimeout(() => {
          if (window.location.pathname !== destination) window.location.replace(destination);
        }, 500);
      }
    } catch (reason) {
      setFileError(localizeError(reason, t, "update.submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  const submit = handleSubmit(async (formValues) => {
    if (!document.name) {
      setFileError(t("update.uploadFirst"));
      return;
    }
    if (isAssistPending(assist)) {
      setConfirmOpen(true);
      return;
    }
    await performSubmit(formValues);
  });

  const useAiConflictDate = () => {
    if (assist.kind !== "conflict") return;
    const candidate = assist.aiCandidate;
    setValue(candidate.field, candidate.value, { shouldValidate: true, shouldDirty: true });
    setDateSources((current) => ({ ...current, [candidate.field]: "ai" }));
    setAssist({
      kind: "recognized",
      dates: { issueDate: getValues("issueDate"), expiryDate: candidate.value },
      confidence: { issueDate: 0.98, expiryDate: candidate.confidence },
    });
  };

  const canSubmit =
    Boolean(document.name) &&
    !uploading &&
    isValid &&
    isDraftSubmittable(buildDraft(values), validityRule, qualification.parameterRestriction);
  const activeStep: 1 | 2 | 3 = !document.name ? 1 : canSubmit ? 3 : 2;
  const confidence = assist.kind === "recognized" ? assist.confidence : undefined;
  const displayedDateFields: DateFieldName[] = [
    "issueDate",
    ...(validityRule.kind === "fixed_months" && validityRule.baseDateField === "trainingDate"
      ? (["trainingDate"] as const)
      : []),
    ...(validityRule.kind === "non_expiring" ? [] : (["expiryDate"] as const)),
  ];
  const dateLabels: Record<DateFieldName, string> = {
    issueDate: t("update.issueDate"),
    trainingDate: t("update.trainingDate"),
    expiryDate: t("update.expiryDate"),
  };
  const displayError = (message?: string) =>
    message && locale === "en-US" && /[一-龥]/.test(message) ? t("update.formInvalid") : message;

  return (
    <form onSubmit={submit} className="space-y-5 pb-24" noValidate>
      <UpdateSteps active={activeStep} />
      <CredentialUpload
        documentName={document.name}
        documentSize={document.size}
        previewUrl={document.previewUrl}
        error={fileError}
        onFile={handleFile}
      />
      <ImageCropDialog
        file={cropFile}
        open={cropOpen}
        onOpenChange={setCropOpen}
        onConfirm={(blob) => void completeProcessedImage(blob, cropFile?.name ?? "evidence.jpg")}
      />

      <AssistStatusCard
        state={assist}
        onRetry={() => {
          if (assist.kind === "busy" && assist.operation === "review") void runReview("default");
          else if (document.name)
            void runRecognition(
              document.evidenceId || {
                name: document.name,
                type: document.type,
                size: document.size,
              },
              "default",
            );
        }}
        onSkip={() => {
          if (assist.kind === "busy" && canSubmit) void performSubmit();
          else setAssist({ kind: "skipped" });
        }}
        onKeepManual={() => setAssist({ kind: "skipped" })}
        onUseAi={useAiConflictDate}
      />

      <section className="space-y-4" aria-labelledby="manual-fields-title">
        <h2 id="manual-fields-title" className="text-[13px] font-bold text-secondary">
          {t("update.manualTitle")}
        </h2>
        <Input
          label={t("update.credentialNumber")}
          required
          placeholder={t("update.credentialPlaceholder")}
          error={displayError(errors.credentialNumber?.message)}
          {...register("credentialNumber")}
        />
        {displayedDateFields.map((field) => (
          <FormField key={field}>
            <FieldLabel htmlFor={field} required>
              {dateLabels[field]}
            </FieldLabel>
            <div className="relative">
              <input
                id={field}
                aria-invalid={Boolean(errors[field]) || undefined}
                aria-describedby={errors[field] ? `${field}-error` : undefined}
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={values[field]}
                onChange={(event) => changeDate(field, event.target.value)}
                readOnly={field === "expiryDate" && validityRule.kind === "fixed_months"}
                className={cn(
                  "min-h-11 w-full rounded-md border border-border bg-card px-3 pr-28 text-sm text-primary placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
                  field === "expiryDate" &&
                    validityRule.kind === "fixed_months" &&
                    "cursor-not-allowed bg-surface",
                  errors[field] && "border-danger focus:border-danger",
                )}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                <DateSourceLabel source={dateSources[field]} confidence={confidence?.[field]} />
              </span>
            </div>
            {errors[field] ? (
              <FieldHint id={`${field}-error`} error>
                {displayError(errors[field]?.message)}
              </FieldHint>
            ) : null}
            {assist.kind === "ambiguous" && assist.field === field ? (
              <DateCandidates
                field={field}
                candidates={assist.candidates}
                onSelect={selectCandidate}
                onIgnore={() => setAssist({ kind: "skipped" })}
              />
            ) : null}
          </FormField>
        ))}
        <Input
          label={t("update.issuingAuthority")}
          required
          placeholder={t("update.issuingPlaceholder")}
          error={displayError(errors.issuingAuthority?.message)}
          {...register("issuingAuthority")}
        />
        <Input
          label={t("update.levelParameter")}
          required
          placeholder={t("update.levelPlaceholder")}
          error={displayError(errors.levelOrParameter?.message)}
          {...register("levelOrParameter")}
        />
      </section>

      <AiReviewPanel
        disabled={!canSubmit}
        state={assist}
        onReview={() => void runReview()}
        onSkip={() => setAssist({ kind: "skipped" })}
      />
      <AiNotice />

      <div className="fixed inset-x-0 bottom-0 z-[var(--z-header)] mx-auto w-full max-w-[430px] border-t border-border bg-card px-4 pb-safe-bottom pt-3">
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={!canSubmit}
          loading={submitting}
        >
          {t("update.submitUpdate")}
        </Button>
      </div>

      <SubmitConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onSubmit={() => void performSubmit()}
        submitting={submitting}
      />
    </form>
  );
}
