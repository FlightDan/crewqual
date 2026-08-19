import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewListView } from "@/components/admin/review-list-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("待审核队列", "Pending reviews")} · CrewQual` };
}

export default function AdminReviewsPage() {
  return (
    <Suspense>
      <ReviewListView />
    </Suspense>
  );
}
