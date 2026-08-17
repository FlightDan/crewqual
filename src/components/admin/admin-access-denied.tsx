"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminSession } from "@/services/admin-session-provider";

export function AdminAccessDenied({ reason = "forbidden" }: { reason?: "forbidden" | "no-unit" }) {
  const { session } = useAdminSession();
  const noUnit = reason === "no-unit";
  return (
    <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center p-4 pb-24 lg:pb-4">
      <Card className="w-full max-w-xl">
        <CardContent className="flex flex-col items-center px-6 py-12 text-center">
          <span className="mb-5 inline-flex size-14 items-center justify-center rounded-full bg-red-50 text-danger">
            <ShieldAlert aria-hidden="true" className="size-7" />
          </span>
          <p className="text-sm font-semibold text-danger">{noUnit ? "账号配置不完整" : "403"}</p>
          <h1 className="mt-2 text-2xl font-bold text-primary">
            {noUnit ? "尚未分配所属单位" : "无权访问此页面"}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-secondary">
            {noUnit
              ? "普通管理员账号必须分配所属单位后才能读取业务数据。请联系超级管理员完成配置。"
              : "当前角色没有访问该功能的权限。系统不会披露其他单位的数据或资源是否存在。"}
          </p>
          {session ? (
            <p className="mt-4 text-xs text-muted">
              {session.displayName} · {session.roles.join(" / ")} ·{" "}
              {session.unit?.name ?? "未分配单位"}
            </p>
          ) : null}
          <Link href="/admin/dashboard" className={buttonVariants({ className: "mt-7" })}>
            返回工作台
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
