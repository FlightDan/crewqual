import type { Metadata } from "next";
import { Suspense } from "react";
import { PilotListView } from "@/components/admin/pilot-list-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("飞行员管理", "Pilot management")} · CrewQual` };
}

export default function AdminPilotsPage() {
  return (
    <Suspense>
      <PilotListView />
    </Suspense>
  );
}
