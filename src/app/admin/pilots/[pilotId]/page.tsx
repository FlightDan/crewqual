import type { Metadata } from "next";
import { PilotDetailView } from "@/components/admin/pilot-detail-view";

export const metadata: Metadata = { title: "飞行员详情 · CrewQual" };

export default async function AdminPilotDetailPage({
  params,
}: {
  params: Promise<{ pilotId: string }>;
}) {
  const { pilotId } = await params;
  return <PilotDetailView pilotId={pilotId} />;
}
