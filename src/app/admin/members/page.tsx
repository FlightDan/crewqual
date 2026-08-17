import type { Metadata } from "next";
import { MemberHubView } from "@/components/admin/member-hub-view";

export const metadata: Metadata = { title: "成员管理 · CrewQual" };

export default function AdminMembersPage() {
  return <MemberHubView />;
}
