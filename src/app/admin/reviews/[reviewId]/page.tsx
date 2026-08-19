import type { Metadata } from "next";
import { ReviewDetailView } from "@/components/admin/review-detail-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("审核工作台", "Review workspace")} · CrewQual` };
}

export default async function AdminReviewDetailPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  return <ReviewDetailView reviewId={reviewId} />;
}
