import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewListView } from "@/components/admin/review-list-view";

export const metadata: Metadata = { title: "待审核队列 · CrewQual" };

export default function AdminReviewsPage() {
  return (
    <Suspense>
      <ReviewListView />
    </Suspense>
  );
}
