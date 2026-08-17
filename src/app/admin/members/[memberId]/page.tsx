import type { Metadata } from "next";
import { MemberDetailView } from "@/components/admin/member-detail-view";

export const metadata: Metadata = { title: "成员详情 · CrewQual" };

export default async function AdminMemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  return <MemberDetailView memberId={memberId} />;
}
