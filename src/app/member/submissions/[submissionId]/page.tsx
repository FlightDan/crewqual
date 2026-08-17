import type { Metadata } from "next";
import { SubmissionResult } from "@/components/pilot/submission-result";

export const metadata: Metadata = { title: "提交结果 · CrewQual" };

export default async function MemberSubmissionResultPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  return <SubmissionResult submissionId={submissionId} portal="member" />;
}
