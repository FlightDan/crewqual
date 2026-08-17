import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";
import { AiResultBadge, ReviewStatusBadge } from "@/components/admin/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { QualificationReview } from "@/types/services";

export function ResponsiveReviewList({
  reviews,
  showQuickApprove = false,
  onQuickApprove,
}: {
  reviews: QualificationReview[];
  showQuickApprove?: boolean;
  onQuickApprove?: (review: QualificationReview) => void;
}) {
  if (reviews.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-secondary">
        当前筛选条件下暂无审核记录
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card lg:block">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-secondary">
            <tr>
              <th scope="col" className="px-4 py-3">
                飞行员
              </th>
              <th scope="col" className="px-4 py-3">
                资质名称
              </th>
              <th scope="col" className="px-4 py-3">
                提交时间
              </th>
              <th scope="col" className="px-4 py-3">
                AI 辅助结果
              </th>
              <th scope="col" className="px-4 py-3">
                人工状态
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((review) => (
              <tr key={review.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <p className="font-semibold text-primary">{review.pilotName}</p>
                  <p className="mt-0.5 text-xs text-muted">{review.employeeNumber}</p>
                </td>
                <td className="max-w-[240px] px-4 py-3 text-secondary">
                  {review.qualificationName}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                  {review.submittedAt}
                </td>
                <td className="px-4 py-3">
                  <AiResultBadge status={review.aiStatus} />
                </td>
                <td className="px-4 py-3">
                  <ReviewStatusBadge status={review.humanStatus} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Link
                      href={`/admin/reviews/${review.id}`}
                      className="inline-flex min-h-10 items-center justify-center rounded-md border border-border px-3 text-xs font-semibold text-primary hover:bg-slate-50"
                    >
                      {review.humanStatus === "pending" ? "快速核对" : "查看详情"}
                    </Link>
                    {showQuickApprove &&
                    review.humanStatus === "pending" &&
                    review.aiStatus === "matched" ? (
                      <Button size="sm" onClick={() => onQuickApprove?.(review)}>
                        <Zap aria-hidden="true" className="size-3.5" />
                        快速批准
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 lg:hidden">
        {reviews.map((review) => (
          <Card key={review.id} className="p-4 shadow-none">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-primary">{review.pilotName}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {review.role} · {review.employeeNumber}
                </p>
              </div>
              <ReviewStatusBadge status={review.humanStatus} />
            </div>
            <p className="mt-3 text-sm font-medium text-secondary">{review.qualificationName}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <AiResultBadge status={review.aiStatus} />
              <span className="text-[11px] text-muted">提交：{review.submittedAt}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link
                href={`/admin/reviews/${review.id}`}
                className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-border text-sm font-semibold text-primary"
              >
                {review.humanStatus === "pending" ? "审核" : "查看"}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              {showQuickApprove &&
              review.humanStatus === "pending" &&
              review.aiStatus === "matched" ? (
                <Button onClick={() => onQuickApprove?.(review)}>快速批准</Button>
              ) : (
                <Link
                  href={`/admin/pilots/${review.pilotId}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-slate-100 text-sm font-semibold text-secondary"
                >
                  飞行员档案
                </Link>
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
