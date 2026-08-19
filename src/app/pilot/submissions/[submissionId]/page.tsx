import type { Metadata } from "next";
import { SubmissionResult } from "@/components/pilot/submission-result";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("提交结果", "Submission result")} · CrewQual` };
}

export default async function SubmissionResultPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  return <SubmissionResult submissionId={submissionId} />;
}
