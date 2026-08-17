"use client";

import { AdminAccessDenied } from "@/components/admin/admin-access-denied";
import { useAdminSession } from "@/services/admin-session-provider";

export function AdminPermissionGate({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { hasPermission } = useAdminSession();
  return hasPermission(permission) ? children : <AdminAccessDenied />;
}
