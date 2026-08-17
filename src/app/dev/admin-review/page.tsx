import type { Metadata } from "next";
import Link from "next/link";
import { AdminWorkspaceShell } from "@/components/admin/admin-workspace-shell";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { AdminStateProvider } from "@/services/admin-state-provider";

export const metadata: Metadata = {
  title: "管理员审核闭环验收 · CrewQual",
  robots: { index: false, follow: false },
};

const entries = [
  ["管理员总览", "/admin/dashboard", "统计、预警、待审核与快速批准人工确认"],
  ["飞行员列表", "/admin/pilots", "URL 搜索、健康度/升级状态筛选与分页"],
  ["飞行员详情", "/admin/pilots/pilot-demo-01", "六项资质、六个升级节点与审核记录"],
  ["待审核队列", "/admin/reviews", "人工状态、AI 结果筛选及历史记录"],
  ["匹配通过", "/admin/reviews/REV-1001", "快速批准仍需人工勾选确认"],
  ["存在疑问", "/admin/reviews/REV-1002", "人工纠正后审核通过"],
  ["信息不一致", "/admin/reviews/REV-1003", "退回原因校验与会话持久化"],
  ["AI 不可用", "/admin/reviews/REV-1004", "不依赖 AI 的人工审核路径"],
] as const;

export default function AdminReviewDevPage() {
  return (
    <AdminStateProvider>
      <AdminWorkspaceShell>
        <PageContainer className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
              第三批开发验收
            </p>
            <h1 className="mt-1 text-xl font-bold">管理员核心审核闭环</h1>
            <p className="mt-1 text-sm text-secondary">
              所有身份、凭证与服务均为虚构/脱敏 Mock；AI 不会自动审批。
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {entries.map(([title, href, description]) => (
              <Link key={href} href={href}>
                <Card className="h-full p-4 shadow-none transition hover:border-brand">
                  <h2 className="text-sm font-bold">{title}</h2>
                  <p className="mt-2 text-xs leading-5 text-secondary">{description}</p>
                </Card>
              </Link>
            ))}
          </div>
        </PageContainer>
      </AdminWorkspaceShell>
    </AdminStateProvider>
  );
}
