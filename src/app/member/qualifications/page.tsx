import type { Metadata } from "next";
import { PilotQualificationsView } from "@/components/pilot/pilot-qualifications-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("我的资质", "My qualifications")} · CrewQual` };
}

export default function MemberQualificationsPage() {
  return <PilotQualificationsView portal="member" />;
}
