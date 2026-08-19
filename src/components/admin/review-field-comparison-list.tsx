import { Badge } from "@/components/ui/badge";
import type { QualificationReview, ReviewFieldComparison } from "@/types/services";
import { useI18n } from "@/components/i18n-provider";

function sourceLabel(field: ReviewFieldComparison, t: (key: string) => string) {
  if (field.source === "ai") return t("reviewFields.ai");
  if (field.source === "manual_modified") return t("reviewFields.modified");
  if (field.source === "manual") return t("reviewFields.manual");
  return t("reviewFields.user");
}

export function ReviewFieldComparisonList({ review }: { review: QualificationReview }) {
  const { t } = useI18n();
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
                {field.correctedValue ? t("reviewFields.corrected") : sourceLabel(field, t)}
              </Badge>
            </div>
            {field.correctedValue ? (
              <p className="mt-1 text-[11px] text-muted">
                {t("reviewFields.submitted")}
                {field.submittedValue}
              </p>
            ) : null}
            {field.aiOriginalValue ? (
              <p className="mt-1 text-[11px] text-muted">
                {t("reviewFields.aiOriginal")}
                {field.aiOriginalValue}
                {field.confidence
                  ? ` · ${t("reviewFields.confidence")} ${Math.round(field.confidence * 100)}%`
                  : ""}
              </p>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
