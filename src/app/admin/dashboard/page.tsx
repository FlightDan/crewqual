import type { Metadata } from "next";
import { AdminDashboardView } from "@/components/admin/admin-dashboard-view";

export const metadata: Metadata = { title: "管理员总览 · CrewQual" };

export default function AdminDashboardPage() {
  return <AdminDashboardView />;
}
