"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { isRemoteServiceMode } from "@/lib/service-mode";

export type AdminSession = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  unit: { id: string; name: string } | null;
  expiresAt: string;
  sessions: Array<{
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }>;
};

type AdminSessionContextValue = {
  session: AdminSession | null;
  status: "loading" | "authenticated" | "unauthenticated" | "error";
  error: string | null;
  hasPermission(permission: string): boolean;
  isSuperAdmin: boolean;
  logout(): Promise<void>;
  refresh(): Promise<void>;
};

const mockSession: AdminSession = {
  id: "admin-preview",
  email: "admin@crewqual.local",
  displayName: "CrewQual 管理员",
  roles: ["SUPER_ADMIN"],
  permissions: ["*"],
  unit: null,
  expiresAt: "2099-01-01T00:00:00.000Z",
  sessions: [],
};

const defaultValue: AdminSessionContextValue = {
  session: mockSession,
  status: "authenticated",
  error: null,
  hasPermission: () => true,
  isSuperAdmin: true,
  logout: async () => undefined,
  refresh: async () => undefined,
};

const AdminSessionContext = React.createContext<AdminSessionContextValue>(defaultValue);

function readCookie(name: string) {
  if (typeof document === "undefined") return "";
  return (
    document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}

function safeNextPath(pathname: string) {
  return pathname.startsWith("/admin/") && pathname !== "/admin/login"
    ? pathname
    : "/admin/dashboard";
}

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const remoteMode = isRemoteServiceMode();
  return remoteMode ? (
    <RemoteAdminSessionProvider>{children}</RemoteAdminSessionProvider>
  ) : (
    <AdminSessionContext.Provider value={defaultValue}>{children}</AdminSessionContext.Provider>
  );
}

function RemoteAdminSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = React.useState<AdminSession | null>(null);
  const [status, setStatus] = React.useState<AdminSessionContextValue["status"]>("loading");
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/admin/session", {
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: AdminSession;
        error?: { message?: string };
      };
      if (response.status === 401) {
        setSession(null);
        setStatus("unauthenticated");
        const next = encodeURIComponent(safeNextPath(pathname));
        router.replace(`/admin/login?reason=session-expired&next=${next}`);
        return;
      }
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "无法验证管理员会话");
      setSession(body.data);
      setStatus("authenticated");
    } catch (cause) {
      setSession(null);
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "无法验证管理员会话");
    }
  }, [pathname, router]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!session?.expiresAt) return;
    const delay = Math.max(0, Date.parse(session.expiresAt) - Date.now());
    const timer = window.setTimeout(
      () => {
        setSession(null);
        setStatus("unauthenticated");
        const next = encodeURIComponent(safeNextPath(pathname));
        router.replace(`/admin/login?reason=session-expired&next=${next}`);
      },
      Math.min(delay, 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [pathname, router, session?.expiresAt]);

  const logout = React.useCallback(async () => {
    const csrf = decodeURIComponent(readCookie("crewqual_admin_session_csrf"));
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": csrf },
      });
    } finally {
      setSession(null);
      setStatus("unauthenticated");
      router.replace("/admin/login?reason=logged-out");
      router.refresh();
    }
  }, [router]);

  const isSuperAdmin = Boolean(session?.roles.includes("SUPER_ADMIN"));
  const value = React.useMemo<AdminSessionContextValue>(
    () => ({
      session,
      status,
      error,
      isSuperAdmin,
      hasPermission: (permission) =>
        isSuperAdmin || Boolean(session?.permissions.includes(permission)),
      logout,
      refresh,
    }),
    [error, isSuperAdmin, logout, refresh, session, status],
  );
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession() {
  return React.useContext(AdminSessionContext);
}

export const adminRoleLabels: Record<string, string> = {
  SUPER_ADMIN: "超级管理员",
  ADMIN: "管理员",
  REVIEWER: "审核员",
  VIEWER: "只读查看员",
};
