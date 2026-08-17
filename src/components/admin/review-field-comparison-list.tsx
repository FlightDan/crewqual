import { Badge } from "@/components/ui/badge";
import type { QualificationReview, ReviewFieldComparison } from "@/types/services";

function sourceLabel(field: ReviewFieldComparison) {
  if (field.source === "ai") return "AI 识别";
  if (field.source === "manual_modified") return "AI 识别后被用户修改";
  if (field.source === "manual") return "手动";
  return "用户手动填写";
}

export function ReviewFieldComparisonList({ review }: { review: QualificationReview }) {
  return (
    <dl className="divide-y divide-border" data-testid="review-field-comparisons">
      {review.fieldComparisons.map((field) => (
        <div key={field.field} className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]">
          <dt className="text-xs font-medium text-muted">{field.label}</dt>
          <dd>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-primary">
                {field.correctedValue ?? field.submittedValue}
              </span>
              <Badge
                tone={
                  field.correctedValue
                    ? "purple"
                    : field.source === "ai"
                      ? "info"
                      : field.source === "manual_modified"
                        ? "warning"
                        : "neutral"
                }
                className="py-0.5 text-[10px]"
              >
                {field.correctedValue ? "已人工修正" : sourceLabel(field)}
              </Badge>
            </div>
            {field.correctedValue ? (
              <p className="mt-1 text-[11px] text-muted">原提交值：{field.submittedValue}</p>
            ) : null}
            {field.aiOriginalValue ? (
              <p className="mt-1 text-[11px] text-muted">
                AI 原始值：{field.aiOriginalValue}
                {field.confidence ? ` · 置信度 ${Math.round(field.confidence * 100)}%` : ""}
              </p>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
