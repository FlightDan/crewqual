import type { Metadata } from "next";
import { AdminDashboardView } from "@/components/admin/admin-dashboard-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("管理员总览", "Administrator dashboard")} · CrewQual` };
}

export default function AdminDashboardPage() {
  return <AdminDashboardView />;
}
