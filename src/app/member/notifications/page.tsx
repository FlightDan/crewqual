import type { Metadata } from "next";
import { PilotNotificationsView } from "@/components/pilot/pilot-notifications-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("成员通知", "Member notifications")} · CrewQual` };
}

export default function MemberNotificationsPage() {
  return <PilotNotificationsView portal="member" />;
}
