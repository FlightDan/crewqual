"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SubmissionProgressCard } from "@/components/pilot/submission-progress-card";
import { cn } from "@/lib/utils";
import { useApplicationServices } from "@/services/application-services-provider";
import { useI18n } from "@/components/i18n-provider";
import { localizedQualificationName } from "@/lib/i18n";

export function SubmissionResult({
  submissionId,
  portal = "pilot",
}: {
  submissionId: string;
  portal?: "pilot" | "member";
}) {
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const { submissions } = useApplicationServices();
  const { locale, t } = useI18n();
  const [receipt, setReceipt] = React.useState(() => submissions.getReceipt(submissionId));
  const [loading, setLoading] = React.useState(Boolean(submissions.getReceiptAsync));
  React.useEffect(() => {
    let active = true;
    if (!submissions.getReceiptAsync) {
      setReceipt(submissions.getReceipt(submissionId));
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    void submissions
      .getReceiptAsync(submissionId)
      .then((result) => {
        if (!active) return;
        setReceipt(result.data);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setReceipt(null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [submissionId, submissions]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[430px] items-center justify-center bg-surface px-6 text-center">
        <div className="flex flex-col items-center gap-5">
          <p className="text-sm text-secondary">{t("submission.loading")}</p>
        </div>
      </main>
    );
  }
  if (!receipt) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col items-center justify-center bg-surface px-6 text-center">
        <h1 className="mt-6 text-lg font-bold">{t("submission.notFound")}</h1>
        <p className="mt-2 text-sm text-secondary">{t("submission.notFoundDescription")}</p>
        <Link href={`${portalPath}/qualifications`} className={cn(buttonVariants(), "mt-6 w-full")}>
          {t("submission.backToQualifications")}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-surface px-6 pb-safe-bottom pt-16 shadow-sm">
      <div className="text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-50 text-success">
          <Check aria-hidden="true" className="size-8" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-primary">{t("submission.success")}</h1>
        <p className="mt-1 text-sm text-secondary">
          {t("submission.submitted", {
            name: localizedQualificationName(
              receipt.qualificationName,
              receipt.qualificationTranslations,
              locale,
            ),
          })}
        </p>
      </div>
      <div className="my-auto py-10">
        <SubmissionProgressCard receipt={receipt} />
        <div className="mt-8 rounded-md bg-blue-50 p-3 text-xs leading-5 text-brand">
          {t("submission.processing")}
        </div>
      </div>
      <div className="space-y-3">
        <Link
          href={`${portalPath}/qualifications`}
          className={cn(buttonVariants({ size: "lg" }), "w-full")}
        >
          {t("submission.backToQualifications")}
        </Link>
        <Link
          href={`${portalPath}/identity`}
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full")}
        >
          {t("submission.close")}
        </Link>
      </div>
    </main>
  );
}
