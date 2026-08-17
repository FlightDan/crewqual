import type { Metadata } from "next";
import { AdminOperationsPreview } from "@/components/admin/admin-operations-preview";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminOperationsPage() {
  return <AdminOperationsPreview />;
}
