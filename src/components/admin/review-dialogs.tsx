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
      setServiceError(error instanceof Error ? error.message : "保存失败，请稍后重试");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle className="text-lg font-bold">手动纠正信息</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-secondary">
          原提交值会保留在审核记录中；保存后字段标记为“已人工修正”。
        </DialogDescription>
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          {serviceError ? <Alert tone="danger">{serviceError}</Alert> : null}
          <Input
            label="证件编号"
            required
            error={errors.credentialNumber?.message}
            {...register("credentialNumber")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              label="签发日期"
              required
              error={errors.issueDate?.message}
              {...register("issueDate")}
            />
            {validityRule.kind === "fixed_months" &&
            validityRule.baseDateField === "trainingDate" ? (
              <DateField
                label="培训日期"
                required
                error={errors.trainingDate?.message}
                {...register("trainingDate")}
              />
            ) : null}
            {validityRule.kind !== "non_expiring" ? (
              <DateField
                label="到期日期"
                required
                readOnly={validityRule.kind === "fixed_months"}
                error={errors.expiryDate?.message}
                {...register("expiryDate")}
              />
            ) : null}
          </div>
          <Input
            label="签发机构"
            required
            error={errors.issuingAuthority?.message}
            {...register("issuingAuthority")}
          />
          <Input
            label="等级/参数"
            required
            error={errors.levelOrParameter?.message}
            {...register("levelOrParameter")}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!isDirty} loading={isSubmitting}>
              保存人工纠正
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
      setServiceError(error instanceof Error ? error.message : "审批失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-bold">确认审核通过</DialogTitle>
        <DialogDescription className="mt-1 text-sm leading-6 text-secondary">
          通过后将以用户最终提交值与人工纠正值生成新的生效记录。AI 结果仅供参考。
        </DialogDescription>
        <div className="mt-5 space-y-4">
          {serviceError ? <Alert tone="danger">{serviceError}</Alert> : null}
          <Checkbox
            label="已核对凭证与提交信息"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <Textarea
            label="审核备注（选填）"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!confirmed}
              loading={loading}
              onClick={() => void approve()}
            >
              确认通过
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
      setError(validation.error.issues[0]?.message ?? "请输入退回原因");
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
      setError(serviceError instanceof Error ? serviceError.message : "退回失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-bold">退回修改</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-secondary">
          请输入清晰、可执行的退回原因，系统将按配置发送通知。
        </DialogDescription>
        <div className="mt-5 space-y-4">
          <Textarea
            label="退回原因"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={error}
            placeholder="至少 5 个字符"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="button" variant="danger" loading={loading} onClick={() => void submit()}>
              确认退回
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
