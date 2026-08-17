import type { Metadata } from "next";
import { PilotNotificationsView } from "@/components/pilot/pilot-notifications-view";

export const metadata: Metadata = { title: "成员通知 · CrewQual" };

export default function MemberNotificationsPage() {
  return <PilotNotificationsView portal="member" />;
}
