import type { Metadata } from "next";
import { PilotNotificationsView } from "@/components/pilot/pilot-notifications-view";

export const metadata: Metadata = { title: "消息通知 · CrewQual" };

export default function PilotNotificationsPage() {
  return <PilotNotificationsView />;
}
