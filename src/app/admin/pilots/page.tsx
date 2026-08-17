import type { Metadata } from "next";
import { Suspense } from "react";
import { PilotListView } from "@/components/admin/pilot-list-view";

export const metadata: Metadata = { title: "飞行员管理 · CrewQual" };

export default function AdminPilotsPage() {
  return (
    <Suspense>
      <PilotListView />
    </Suspense>
  );
}
