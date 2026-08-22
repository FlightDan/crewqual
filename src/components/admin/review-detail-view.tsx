"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Bot, History, Info } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ReviewDecisionBar } from "@/components/admin/review-decision-bar";
import { ReviewDocumentViewer } from "@/components/admin/review-document-viewer";
import { ReviewFieldComparisonList } from "@/components/admin/review-field-comparison-list";
import { AiResultBadge, ReviewStatusBadge } from "@/components/admin/status-badges";
import { PageContainer } from "@/components/layout/page-container";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type { QualificationReview } from "@/types/services";
import { useAdminSession } from "@/services/admin-session-provider";
import { useI18n } from "@/components/i18n-provider";
import { localizedQualificationName } from "@/lib/i18n";

export function ReviewDetailView({ reviewId }: { reviewId: string }) {
  const { locale, t } = useI18n();
  const state = useAdminState();
  const { reviews } = useApplicationServices();
  const { hasPermission } = useAdminSession();
  const canDecide = hasPermission("reviews.decide");
  const [review, setReview] = React.useState<QualificationReview | null | undefined>(undefined);

  React.useEffect(() => {
    let active = true;
    void reviews.getById(reviewId).then((result) => {
      if (active) setReview(result.data);
    });
    return () => {
      active = false;
    };
  }, [reviewId, reviews, state]);

  if (review === undefined)
    return (
      <PageContainer>
        <Skeleton className="h-64" />
      </PageContainer>
    );
  if (review === null) {
    return (
      <PageContainer>
        <EmptyState
          title={t("reviewDetail.notFound")}
          description={t("reviewDetail.notFoundDescription")}
          action={
            <Link href="/admin/reviews" className="font-semibold text-brand">
              {t("reviewDetail.backQueue")}
            </Link>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-5 pb-44 lg:pb-6">
      <AdminPageHeader
        title={t("reviewDetail.title")}
        description={t("reviewDetail.description")}
        action={
          <Link
            href="/admin/reviews"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"
          >
            <ArrowLeft className="size-4" />
            {t("reviewDetail.back")}
          </Link>
        }
      />

      <Alert tone="info">{t("reviewDetail.aiNotice")}</Alert>

      <Card className="p-4 shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              {t("reviewDetail.reviewing", { id: review.id })}
            </p>
            <h3 className="mt-2 text-base font-bold">
              {review.pilotName}（{review.role} · {review.employeeNumber}）
            </h3>
            <p className="mt-1 text-sm text-secondary">
              {localizedQualificationName(
                review.qualificationName,
                review.qualificationTranslations,
                locale,
              )}
            </p>
            <p className="mt-1 text-xs text-muted">
              {t("reviewDetail.submitted", { date: review.submittedAt })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ReviewStatusBadge status={review.humanStatus} />
            <AiResultBadge status={review.aiStatus} />
          </div>
        </div>
      </Card>

      <div
        data-testid="review-detail-grid"
        className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]"
      >
        <div className="space-y-5">
          <div className="grid items-start gap-5 md:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
            <Card className="shadow-none">
              <CardHeader>
                <h3 className="text-sm font-bold">{t("reviewDetail.uploaded")}</h3>
              </CardHeader>
              <CardContent>
                <ReviewDocumentViewer review={review} />
              </CardContent>
            </Card>
            <Card className="shadow-none">
              <CardHeader>
                <div>
                  <h3 className="text-sm font-bold">{t("reviewDetail.userFields")}</h3>
                  <p className="mt-1 text-xs text-muted">{t("reviewDetail.fieldsDescription")}</p>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <ReviewFieldComparisonList review={review} />
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-none">
            <CardHeader>
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <Bot className="size-4 text-brand" />
                  {t("reviewDetail.aiTitle")}
                </h3>
                <p className="mt-1 text-xs text-muted">
                  {t("reviewDetail.reference", {
                    date: review.aiReviewedAt ?? t("reviewDetail.unavailable"),
                  })}
                </p>
              </div>
              <AiResultBadge status={review.aiStatus} />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md bg-slate-50 p-3">
                <p className="text-sm font-semibold">{review.aiConclusion}</p>
                <p className="mt-1 text-xs text-secondary">
                  {t("reviewDetail.confidence")}
                  {review.aiConfidence
                    ? `${Math.round(review.aiConfidence * 100)}%`
                    : t("reviewDetail.unavailableShort")}
                </p>
              </div>
              {review.aiComparisons.map((comparison) => (
                <div
                  key={comparison.label}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{comparison.label}</p>
                    <p className="mt-1 text-xs text-secondary">
                      {comparison.result}
                      {comparison.confidence
                        ? ` · ${Math.round(comparison.confidence * 100)}%`
                        : ""}
                    </p>
                  </div>
                  <AiResultBadge status={comparison.status} />
                </div>
              ))}
              <p className="flex gap-2 rounded-md bg-blue-50 p-3 text-xs leading-5 text-brand">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {t("reviewDetail.aiInfo")}
              </p>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="shadow-none">
            <CardHeader>
              <h3 className="text-sm font-bold">{t("reviewDetail.currentRecord")}</h3>
            </CardHeader>
            <CardContent>
              {review.currentRecord ? (
                <dl className="divide-y divide-border text-sm">
                  {[
                    [t("reviewDetail.credential"), review.currentRecord.credentialNumber],
                    [t("reviewDetail.issueDate"), review.currentRecord.issueDate],
                    [t("reviewDetail.expiryDate"), review.currentRecord.expiryDate],
                    [t("reviewDetail.issuingAuthority"), review.currentRecord.issuingAuthority],
                    [t("reviewDetail.level"), review.currentRecord.levelOrParameter],
                  ].map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[88px_1fr] gap-3 py-3">
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="break-words font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted">{t("reviewDetail.noRecord")}</p>
              )}
            </CardContent>
          </Card>

          <section aria-labelledby="review-decision-title">
            <h3 id="review-decision-title" className="sr-only">
              {t("reviewDetail.decision")}
            </h3>
            {canDecide ? (
              <ReviewDecisionBar review={review} />
            ) : (
              <Alert tone="info">{t("reviewDetail.readonly")}</Alert>
            )}
          </section>

          <Card className="shadow-none">
            <CardHeader>
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <History className="size-4" />
                {t("reviewDetail.audit")}
              </h3>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                {review.audit
                  .slice()
                  .reverse()
                  .map((event) => (
                    <li key={event.id} className="border-l-2 border-blue-100 pl-3">
                      <p className="text-sm font-semibold">{event.detail}</p>
                      <p className="mt-1 text-[11px] text-muted">
                        {event.actor} · {event.occurredAt}
                      </p>
                    </li>
                  ))}
              </ol>
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageContainer>
  );
}
