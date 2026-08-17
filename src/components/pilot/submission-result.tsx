"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SubmissionProgressCard } from "@/components/pilot/submission-progress-card";
import { cn } from "@/lib/utils";
import { useApplicationServices } from "@/services/application-services-provider";

export function SubmissionResult({
  submissionId,
  portal = "pilot",
}: {
  submissionId: string;
  portal?: "pilot" | "member";
}) {
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const { submissions } = useApplicationServices();
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
        <p className="text-sm text-secondary">正在读取提交回执…</p>
      </main>
    );
  }
  if (!receipt) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col items-center justify-center bg-surface px-6 text-center">
        <h1 className="text-lg font-bold">未找到此提交回执</h1>
        <p className="mt-2 text-sm text-secondary">回执可能已过期，或当前会话无权访问。</p>
        <Link href={`${portalPath}/qualifications`} className={cn(buttonVariants(), "mt-6 w-full")}>
          返回我的资质
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
        <h1 className="mt-4 text-2xl font-bold text-primary">提交成功</h1>
        <p className="mt-1 text-sm text-secondary">{receipt.qualificationName}更新申请已提交</p>
      </div>
      <div className="my-auto py-10">
        <SubmissionProgressCard receipt={receipt} />
        <div className="mt-8 rounded-md bg-blue-50 p-3 text-xs leading-5 text-brand">
          您可以关闭页面，无需等待审核完成。系统将在后台处理，并在审核完成后通知您。
        </div>
      </div>
      <div className="space-y-3">
        <Link
          href={`${portalPath}/qualifications`}
          className={cn(buttonVariants({ size: "lg" }), "w-full")}
        >
          返回我的资质
        </Link>
        <Link
          href={`${portalPath}/identity`}
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full")}
        >
          关闭
        </Link>
      </div>
    </main>
  );
}
