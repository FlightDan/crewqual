import type { Metadata } from "next";
import { PilotDetailView } from "@/components/admin/pilot-detail-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("飞行员详情", "Pilot details")} · CrewQual` };
}

export default async function AdminPilotDetailPage({
  params,
}: {
  params: Promise<{ pilotId: string }>;
}) {
  const { pilotId } = await params;
  return <PilotDetailView pilotId={pilotId} />;
}
