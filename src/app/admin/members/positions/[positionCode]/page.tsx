import type { Metadata } from "next";
import { MemberDirectoryView } from "@/components/admin/member-directory-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("职位成员列表", "Position members")} · CrewQual` };
}

export default async function AdminMembersPositionPage({
  params,
}: {
  params: Promise<{ positionCode: string }>;
}) {
  const { positionCode } = await params;
  return <MemberDirectoryView positionCode={positionCode.toUpperCase()} />;
}
