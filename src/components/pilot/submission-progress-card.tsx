"use client";

import { BellRing, CheckCircle2, Server, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Divider } from "@/components/ui/misc";
import type { SubmissionReceipt } from "@/types/services";
import { useI18n } from "@/components/i18n-provider";

export function SubmissionProgressCard({ receipt }: { receipt: SubmissionReceipt }) {
  const { locale, t } = useI18n();
  const statusLabel = {
    received: t("submission.received"),
    processing: t("submission.processingStatus"),
    approved: t("submission.approvedStatus"),
    returned: t("submission.returnedStatus"),
  }[receipt.status];
  const rows = [
    {
      icon: Server,
      title: t("submission.serverReceived"),
      body: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(
        new Date(receipt.submittedAt),
      ),
      tone: "text-success",
    },
    {
      icon: ShieldCheck,
      title: t("submission.reviewing"),
      body:
        receipt.status === "returned"
          ? (receipt.returnReason ?? t("submission.returnReason"))
          : receipt.status === "approved"
            ? (receipt.decisionNote ?? t("submission.decisionNote"))
            : t("submission.backgroundProcessing"),
      tone: "text-brand",
    },
    {
      icon: BellRing,
      title: t("submission.notifyWhenDone"),
      body: t("submission.notifyDescription"),
      tone: "text-brand",
    },
  ];
  return (
    <Card className="rounded-xl p-5 shadow-none">
      {rows.map((row, index) => {
        const Icon = row.icon;
        return (
          <div key={row.title}>
            {index ? <Divider className="my-4" /> : null}
            <div className="flex gap-3">
              <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${row.tone}`} />
              <div>
                <h2 className="text-sm font-bold text-primary">{row.title}</h2>
                <p className="mt-1 text-xs leading-5 text-secondary">{row.body}</p>
              </div>
            </div>
          </div>
        );
      })}
      <p className="mt-4 text-xs text-secondary" role="status">
        {t("submission.currentStatus", { status: statusLabel })}
      </p>
      <div className="sr-only">
        <CheckCircle2 />
        {t("submission.receiptId", { id: receipt.id })}
      </div>
    </Card>
  );
}
