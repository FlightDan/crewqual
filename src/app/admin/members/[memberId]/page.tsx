import type { Metadata } from "next";
import { MemberDetailView } from "@/components/admin/member-detail-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("成员详情", "Member details")} · CrewQual` };
}

export default async function AdminMemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  return <MemberDetailView memberId={memberId} />;
}
