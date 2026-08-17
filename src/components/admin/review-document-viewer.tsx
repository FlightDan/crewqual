"use client";

import * as React from "react";
import { Expand, FileBadge2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { QualificationReview } from "@/types/services";

function SanitizedCredential({
  review,
  large = false,
}: {
  review: QualificationReview;
  large?: boolean;
}) {
  return (
    <div
      className={`relative flex w-full flex-col overflow-hidden rounded-lg border border-blue-200 bg-[linear-gradient(135deg,#eff6ff_0%,#fff_48%,#f8fafc_100%)] p-5 text-primary ${large ? "min-h-[420px]" : "min-h-64"}`}
      aria-label="已脱敏的凭证预览"
    >
      <div className="absolute -right-10 -top-10 size-36 rounded-full border-[12px] border-blue-100/60" />
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-brand text-white">
          <FileBadge2 aria-hidden="true" className="size-5" />
        </div>
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-brand">CREWQUAL</p>
          <p className="text-sm font-bold">资质凭证预览</p>
        </div>
      </div>
      <div className="my-auto space-y-3 py-6 text-sm">
        <p className="text-base font-bold">{review.qualificationName}</p>
        <p>持有人：{review.pilotName}</p>
        <p>编号：{review.submittedFields.credentialNumber}</p>
        <p>
          有效期：{review.submittedFields.issueDate} — {review.submittedFields.expiryDate}
        </p>
      </div>
      <div className="rounded-md border-2 border-danger/60 bg-red-50/80 px-3 py-2 text-center text-sm font-black tracking-[0.22em] text-danger">
        示例 / 已脱敏 / 非真实证件
      </div>
    </div>
  );
}

export function ReviewDocumentViewer({ review }: { review: QualificationReview }) {
  const [open, setOpen] = React.useState(false);
  if (review.documentUrl) {
    return (
      <>
        <div className="space-y-3">
          <button type="button" className="block w-full" onClick={() => setOpen(true)}>
            {/* The URL is short-lived and comes from the authenticated server. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={review.documentUrl}
              alt={`${review.qualificationName}上传凭证`}
              className="max-h-96 w-full rounded-lg border border-border object-contain"
            />
          </button>
          <p className="text-center text-[11px] text-muted">证照 JPEG · 私有签名地址</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-4xl p-4 md:p-6">
            <DialogTitle className="pr-8 text-lg font-bold">凭证预览</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-secondary">
              图片通过短时签名地址读取，原始文件不会暴露为公开对象。
            </DialogDescription>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={review.documentUrl}
              alt={`${review.qualificationName}上传凭证大图`}
              className="mt-4 max-h-[75vh] w-full rounded-lg border border-border object-contain"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return (
    <>
      <div className="space-y-3">
        <SanitizedCredential review={review} />
        <Button type="button" variant="secondary" className="w-full" onClick={() => setOpen(true)}>
          <Expand aria-hidden="true" className="size-4" />
          查看凭证大图
        </Button>
        <p className="text-center text-[11px] text-muted">{review.documentName} · 脱敏凭证预览</p>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-4xl overflow-y-auto p-4 md:h-auto md:max-h-[90vh] md:p-6">
          <DialogTitle className="pr-8 text-lg font-bold">凭证预览（已脱敏）</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-secondary">
            此预览不包含任何真实个人、医疗或官方证件信息。
          </DialogDescription>
          <div className="mt-4">
            <SanitizedCredential review={review} large />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
