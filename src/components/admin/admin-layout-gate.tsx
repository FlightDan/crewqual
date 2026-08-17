"use client";

import { usePathname } from "next/navigation";
import { AdminWorkspaceShell } from "@/components/admin/admin-workspace-shell";
import { AdminStateProvider } from "@/services/admin-state-provider";
import { AdminSessionProvider } from "@/services/admin-session-provider";

export function AdminLayoutGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin/login") return children;
  return (
    <AdminSessionProvider>
      <AdminStateProvider>
        <AdminWorkspaceShell>{children}</AdminWorkspaceShell>
      </AdminStateProvider>
    </AdminSessionProvider>
  );
}
