import type { Metadata } from "next";
import { MemberDirectoryView } from "@/components/admin/member-directory-view";

export const metadata: Metadata = { title: "职位成员列表 · CrewQual" };

export default async function AdminMembersPositionPage({
  params,
}: {
  params: Promise<{ positionCode: string }>;
}) {
  const { positionCode } = await params;
  return <MemberDirectoryView positionCode={positionCode.toUpperCase()} />;
}
