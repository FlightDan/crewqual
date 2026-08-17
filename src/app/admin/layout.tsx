import { AdminLayoutGate } from "@/components/admin/admin-layout-gate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutGate>{children}</AdminLayoutGate>;
}
