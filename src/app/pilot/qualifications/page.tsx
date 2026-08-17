import type { Metadata } from "next";
import { PilotQualificationsView } from "@/components/pilot/pilot-qualifications-view";

export const metadata: Metadata = { title: "我的资质 · CrewQual" };

export default function PilotQualificationsPage() {
  return <PilotQualificationsView />;
}
