import type { Metadata } from "next";
import { MemberHubView } from "@/components/admin/member-hub-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("成员管理", "Member management")} · CrewQual` };
}

export default function AdminMembersPage() {
  return <MemberHubView />;
}
