import type { Metadata } from "next";
import { PilotNotificationsView } from "@/components/pilot/pilot-notifications-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("消息通知", "Notifications")} · CrewQual` };
}

export default function PilotNotificationsPage() {
  return <PilotNotificationsView />;
}
