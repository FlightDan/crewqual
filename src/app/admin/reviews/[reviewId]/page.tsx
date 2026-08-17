import type { Metadata } from "next";
import { ReviewDetailView } from "@/components/admin/review-detail-view";

export const metadata: Metadata = { title: "审核工作台 · CrewQual" };

export default async function AdminReviewDetailPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  return <ReviewDetailView reviewId={reviewId} />;
}
