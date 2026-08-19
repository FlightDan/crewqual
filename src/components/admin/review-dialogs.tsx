"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DateField, Input, Textarea } from "@/components/ui/input";
import { returnReasonSchema } from "@/lib/admin-review-validation";
import {
  createQualificationUpdateSchema,
  type QualificationFormValues,
} from "@/lib/pilot-validation";
import { calculateExpectedExpiry } from "@/lib/qualification-rules";
import { useApplicationServices } from "@/services/application-services-provider";
import type { QualificationReview } from "@/types/services";
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";

export function CorrectionDialog({
  review,
  open,
  onOpenChange,
  onCompleted,
}: {
  review: QualificationReview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}) {
  const { reviews } = useApplicationServices();
  const { locale, t } = useI18n();
  const displayError = (message?: string) =>
    message && locale === "en-US" && /[一-龥]/.test(message) ? t("errors.validation") : message;
  const [serviceError, setServiceError] = React.useState("");
  const effectiveValues = React.useMemo(
    () => ({ ...review.submittedFields, ...review.corrections }),
    [review],
  );
  const validityRule = React.useMemo(
    () => review.validityRule ?? ({ kind: "manual_expiry" } as const),
    [review.validityRule],
  );
  const schema = React.useMemo(() => createQualificationUpdateSchema(validityRule), [validityRule]);
  const {
    register,
    reset,
    watch,
    setValue,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<QualificationFormValues>({
    resolver: zodResolver(schema),
    defaultValues: effectiveValues,
  });
  const issueDate = watch("issueDate");
  const trainingDate = watch("trainingDate");

  React.useEffect(() => {
    if (validityRule.kind === "non_expiring") {
      setValue("expiryDate", "", { shouldValidate: true });
      return;
    }
    if (validityRule.kind !== "fixed_months") return;
    const expected = calculateExpectedExpiry({ issueDate, trainingDate }, validityRule);
    if (expected) setValue("expiryDate", expected, { shouldValidate: true });
  }, [issueDate, setValue, trainingDate, validityRule]);

  React.useEffect(() => {
    if (open) {
      reset(effectiveValues);
      setServiceError("");
    }
  }, [effectiveValues, open, reset]);

  const submit = handleSubmit(async (values) => {
    setServiceError("");
    try {
      await reviews.correct(review.id, { ...values, expectedVersion: review.version });
      onOpenChange(false);
      onCompleted?.();
    } catch (error) {
      setServiceError(localizeError(error, t, "errors.remote"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle className="text-lg font-bold">{t("reviewDialog.correctTitle")}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-secondary">
          {t("reviewDialog.correctDescription")}
        </DialogDescription>
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          {serviceError ? <Alert tone="danger">{serviceError}</Alert> : null}
          <Input
            label={t("update.credentialNumber")}
            required
            error={displayError(errors.credentialNumber?.message)}
            {...register("credentialNumber")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              label={t("update.issueDate")}
              required
              error={displayError(errors.issueDate?.message)}
              {...register("issueDate")}
            />
            {validityRule.kind === "fixed_months" &&
            validityRule.baseDateField === "trainingDate" ? (
              <DateField
                label={t("update.trainingDate")}
                required
                error={displayError(errors.trainingDate?.message)}
                {...register("trainingDate")}
              />
            ) : null}
            {validityRule.kind !== "non_expiring" ? (
              <DateField
                label={t("update.expiryDate")}
                required
                readOnly={validityRule.kind === "fixed_months"}
                error={displayError(errors.expiryDate?.message)}
                {...register("expiryDate")}
              />
            ) : null}
          </div>
          <Input
            label={t("update.issuingAuthority")}
            required
            error={displayError(errors.issuingAuthority?.message)}
            {...register("issuingAuthority")}
          />
          <Input
            label={t("update.levelParameter")}
            required
            error={displayError(errors.levelOrParameter?.message)}
            {...register("levelOrParameter")}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t("reviewDialog.cancel")}
            </Button>
            <Button type="submit" disabled={!isDirty} loading={isSubmitting}>
              {t("reviewDialog.saveCorrection")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ApprovalDialog({
  review,
  open,
  onOpenChange,
  onCompleted,
}: {
  review: QualificationReview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}) {
  const { reviews } = useApplicationServices();
  const { t } = useI18n();
  const [confirmed, setConfirmed] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [serviceError, setServiceError] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setConfirmed(false);
      setNote("");
      setServiceError("");
    }
  }, [open]);

  const approve = async () => {
    if (!confirmed || loading) return;
    setLoading(true);
    setServiceError("");
    try {
      await reviews.approve(review.id, { confirmed, note, expectedVersion: review.version });
      onOpenChange(false);
      onCompleted?.();
    } catch (error) {
      setServiceError(localizeError(error, t, "errors.remote"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-bold">{t("reviewDialog.approveTitle")}</DialogTitle>
        <DialogDescription className="mt-1 text-sm leading-6 text-secondary">
          {t("reviewDialog.approveDescription")}
        </DialogDescription>
        <div className="mt-5 space-y-4">
          {serviceError ? <Alert tone="danger">{serviceError}</Alert> : null}
          <Checkbox
            label={t("reviewDialog.confirmed")}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <Textarea
            label={t("reviewDialog.note")}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t("reviewDialog.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!confirmed}
              loading={loading}
              onClick={() => void approve()}
            >
              {t("reviewDialog.confirmApprove")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnDialog({
  review,
  open,
  onOpenChange,
  onCompleted,
}: {
  review: QualificationReview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}) {
  const { reviews } = useApplicationServices();
  const { locale, t } = useI18n();
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setReason("");
      setError("");
    }
  }, [open]);

  const submit = async () => {
    const validation = returnReasonSchema.safeParse(reason);
    if (!validation.success) {
      const message = validation.error.issues[0]?.message ?? t("reviewDialog.returnReason");
      setError(locale === "en-US" && /[一-龥]/.test(message) ? t("errors.validation") : message);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await reviews.returnForChanges(review.id, {
        reason: validation.data,
        expectedVersion: review.version,
      });
      onOpenChange(false);
      onCompleted?.();
    } catch (serviceError) {
      setError(localizeError(serviceError, t, "errors.remote"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-bold">{t("reviewDialog.returnTitle")}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-secondary">
          {t("reviewDialog.returnDescription")}
        </DialogDescription>
        <div className="mt-5 space-y-4">
          <Textarea
            label={t("reviewDialog.returnReason")}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={error}
            placeholder={t("reviewDialog.returnPlaceholder")}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t("reviewDialog.cancel")}
            </Button>
            <Button type="button" variant="danger" loading={loading} onClick={() => void submit()}>
              {t("reviewDialog.confirmReturn")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
