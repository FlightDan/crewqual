"use client";

import * as React from "react";
import { CheckCircle2, Edit3, Undo2 } from "lucide-react";
import { ApprovalDialog, CorrectionDialog, ReturnDialog } from "@/components/admin/review-dialogs";
import { ReviewStatusBadge } from "@/components/admin/status-badges";
import { Button } from "@/components/ui/button";
import type { QualificationReview } from "@/types/services";
import { useI18n } from "@/components/i18n-provider";

export function ReviewDecisionBar({ review }: { review: QualificationReview }) {
  const [correctionOpen, setCorrectionOpen] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);
  const [approvalOpen, setApprovalOpen] = React.useState(false);
  const { t } = useI18n();

  if (review.humanStatus !== "pending") {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold">{t("review.processed")}</p>
            <p className="mt-1 text-xs text-secondary">{t("review.locked")}</p>
          </div>
          <ReviewStatusBadge status={review.humanStatus} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        data-testid="review-decision-bar"
        className="fixed inset-x-0 bottom-[68px] z-[var(--z-header)] grid grid-cols-3 gap-2 border-t border-border bg-card p-3 shadow-[0_-6px_18px_rgb(15_23_42/0.08)] lg:static lg:rounded-lg lg:border lg:shadow-none"
      >
        <Button type="button" variant="secondary" onClick={() => setCorrectionOpen(true)}>
          <Edit3 aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">{t("review.correct")}</span>
          <span className="sm:hidden">{t("review.correctShort")}</span>
        </Button>
        <Button type="button" variant="danger" onClick={() => setReturnOpen(true)}>
          <Undo2 aria-hidden="true" className="size-4" />
          {t("review.return")}
        </Button>
        <Button type="button" onClick={() => setApprovalOpen(true)}>
          <CheckCircle2 aria-hidden="true" className="size-4" />
          {t("review.approve")}
        </Button>
      </div>
      <CorrectionDialog
        review={review}
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        onCompleted={() => window.location.reload()}
      />
      <ReturnDialog
        review={review}
        open={returnOpen}
        onOpenChange={setReturnOpen}
        onCompleted={() => window.location.reload()}
      />
      <ApprovalDialog
        review={review}
        open={approvalOpen}
        onOpenChange={setApprovalOpen}
        onCompleted={() => window.location.reload()}
      />
    </>
  );
}
