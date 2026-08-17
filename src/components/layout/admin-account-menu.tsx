"use client";

import * as React from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { adminRoleLabels, useAdminSession } from "@/services/admin-session-provider";

function initials(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "管";
}

function remainingLabel(expiresAt?: string) {
  if (!expiresAt) return "会话时间未知";
  const remaining = Math.max(0, Date.parse(expiresAt) - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return remaining ? `会话剩余约 ${hours} 小时 ${minutes} 分钟` : "会话即将过期";
}

function SessionRemaining({ expiresAt }: { expiresAt?: string }) {
  const [label, setLabel] = React.useState("管理员会话绝对有效期 8 小时");
  React.useEffect(() => {
    const update = () => setLabel(remainingLabel(expiresAt));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return <>{label}</>;
}

export function AdminAccountMenu() {
  const { session, isSuperAdmin, logout } = useAdminSession();
  const role = session?.roles[0] ?? "SUPER_ADMIN";
  const displayName = session?.displayName ?? "系统管理员";
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
        <Avatar
          initials={initials(displayName)}
          className="size-8 bg-blue-50 text-brand"
          label={displayName}
        />
        <span className="hidden text-left xl:block">
          <span className="block max-w-40 truncate font-semibold text-primary">{displayName}</span>
          <span className="block text-[11px] text-muted">{adminRoleLabels[role] ?? role}</span>
        </span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-72 rounded-lg border border-border bg-card p-4 shadow-popover">
        <p className="font-semibold text-primary">{displayName}</p>
        <p className="mt-1 truncate text-xs text-secondary">{session?.email}</p>
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-secondary">
          <p className="flex items-center gap-2 font-semibold text-primary">
            <ShieldCheck aria-hidden="true" className="size-4 text-brand" />
            {adminRoleLabels[role] ?? role}
          </p>
          <p className="mt-1">
            {isSuperAdmin ? "数据范围：全局" : `所属单位：${session?.unit?.name ?? "未分配"}`}
          </p>
          <p className="mt-1">
            <SessionRemaining expiresAt={session?.expiresAt} />
          </p>
        </div>
        <button
          type="button"
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-red-50 text-sm font-semibold text-danger hover:bg-red-100"
          onClick={() => void logout()}
        >
          <LogOut aria-hidden="true" className="size-4" />
          退出登录
        </button>
      </div>
    </details>
  );
}
