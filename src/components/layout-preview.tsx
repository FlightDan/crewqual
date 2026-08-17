"use client";

import * as React from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { PageContainer } from "@/components/layout/page-container";
import { PilotShell } from "@/components/layout/pilot-shell";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Divider } from "@/components/ui/misc";

export function LayoutPreview() {
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => {
    const update = () => setMobile(window.innerWidth < 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <AdminShell initialDrawerOpen={mobile}>
      <PageContainer data-testid="admin-preview-content" className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
              第一批验收
            </p>
            <h2 className="mt-1 text-xl font-bold">Admin 响应式框架</h2>
            <p className="mt-1 text-sm text-secondary">
              同一路由在 390px 与 1440px 切换导航形态，当前只展示布局占位和安全 Mock。
            </p>
          </div>
          <Badge tone="info">{mobile ? "mobile · &lt;768px" : "desktop · ≥1024px"}</Badge>
        </div>
        <AdminPreviewContent />
        <div className="rounded-lg border border-dashed border-border bg-card p-4">
          <p className="text-sm font-semibold">Admin 手机抽屉预览</p>
          <p className="mt-1 text-xs leading-5 text-secondary">
            点击左上角菜单可打开真实
            Drawer；菜单包含总览、日历、飞行员、资质管理、升级计划、待审核、通知记录、系统设置和退出登录。
          </p>
        </div>
        <div className="lg:hidden">
          <PilotPreviewContent />
        </div>
        <div className="hidden lg:block">
          <Card>
            <CardContent>
              <p className="text-sm font-semibold">Pilot 框架提示</p>
              <p className="mt-1 text-sm text-secondary">
                PilotShell 在大屏仍保持居中，正文宽度不超过 430px；移动端验收见下方内嵌预览。
              </p>
            </CardContent>
          </Card>
        </div>
        <div
          data-testid="last-preview-content"
          className="rounded-lg border border-border bg-card p-4"
        >
          <p className="text-sm font-semibold">固定导航安全区</p>
          <p className="mt-1 text-sm text-secondary">
            这段内容用于验证移动底部导航不会遮挡最后一项内容。PageContainer 已预留 safe-area
            与底部内距。
          </p>
          <Button className="mt-4" variant="secondary">
            最后一项示例操作
          </Button>
        </div>
      </PageContainer>
    </AdminShell>
  );
}

function AdminPreviewContent() {
  const stats = [
    ["已过期资质", "3", "danger", "需立即停飞处理"],
    ["7日内到期", "5", "warning", "亟需更新复训"],
    ["30日内到期", "14", "warning", "正常跟进计划"],
    ["待审核更新", "8", "info", "AI 辅助审核待人工"],
  ] as const;
  return (
    <div className="space-y-4">
      <section>
        <div className="mb-3">
          <h3 className="text-base font-semibold">待处理资质事项</h3>
          <p className="mt-1 text-xs text-muted">中队范围内需要紧急关注和审核的任务</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map(([label, value, tone, note]) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-secondary">{label}</p>
                <p
                  className={`mt-2 text-3xl font-bold ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-brand"}`}
                >
                  {value}
                  <span className="ml-2 text-xs font-normal text-muted">项</span>
                </p>
                <p className="mt-1 truncate text-[11px] text-muted">{note}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <h3 className="text-sm font-semibold">待审核资质更新申请 (8)</h3>
              <p className="mt-1 text-xs text-muted">展示列表框架，不含业务流程</p>
            </div>
            <StatusBadge status="info">Mock</StatusBadge>
          </CardHeader>
          <CardContent className="space-y-2">
            {["示例飞行员甲", "示例飞行员乙", "示例飞行员丙", "示例飞行员丁"].map((name, index) => (
              <div
                key={name}
                className="flex flex-wrap items-center gap-2 border-b border-border py-2 last:border-0"
              >
                <span className="w-28 text-sm font-medium">{name}</span>
                <span className="min-w-0 flex-1 text-xs text-secondary">机组年度复训合格证</span>
                <StatusBadge status={index === 1 ? "warning" : "success"}>
                  {index === 1 ? "有效期存疑" : "匹配通过"}
                </StatusBadge>
                <Button size="sm" variant="secondary">
                  快速核对
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <h3 className="text-sm font-semibold">临期与过期资质预警 (22)</h3>
              <p className="mt-1 text-xs text-muted">示例状态展示</p>
            </div>
            <Button variant="link" size="sm">
              查看全部 →
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              ["示例飞行员戊", "已过期 9天", "danger"],
              ["示例飞行员己", "剩 7天", "warning"],
              ["示例飞行员庚", "剩 22天", "warning"],
              ["示例飞行员辛", "剩 27天", "warning"],
            ].map(([name, status, tone]) => (
              <div
                key={name}
                className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="truncate text-xs text-secondary">民用航空人员体检合格证</p>
                </div>
                <StatusBadge status={tone as "danger" | "warning"}>{status}</StatusBadge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <div>
            <h3 className="text-sm font-semibold">本周计划内升级节点监督</h3>
            <p className="mt-1 text-xs text-muted">仅作为框架占位，业务在后续批次实现</p>
          </div>
          <StatusBadge status="neutral">Mock</StatusBadge>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {["示例副驾驶甲", "示例副驾驶乙", "示例机长甲"].map((name, index) => (
            <div key={name} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{name}</p>
                  <p className="mt-1 text-xs text-secondary">中队评估 / 模拟机检查</p>
                </div>
                <StatusBadge status={index === 0 ? "info" : index === 1 ? "warning" : "success"}>
                  {index === 0 ? "进行中" : index === 1 ? "待考核" : "已通过"}
                </StatusBadge>
              </div>
              <Divider className="my-3" />
              <p className="text-[11px] text-muted">计划时间：2026-08-18 至 2026-08-20</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PilotPreviewContent() {
  return (
    <PilotShell>
      <div className="space-y-5">
        <div>
          <h3 className="text-xl font-bold">我的资质</h3>
          <p className="mt-1 text-sm text-secondary">请及时跟进临期与已过期资质的更新复训</p>
        </div>
        <section>
          <h4 className="border-l-2 border-danger pl-2 text-sm font-semibold text-danger">
            需要紧急处理（已过期）
          </h4>
          <Card className="mt-3 border-danger/70">
            <CardContent>
              <div className="flex items-start justify-between gap-3">
                <h5 className="text-base font-bold">民用航空人员体检合格证</h5>
                <StatusBadge status="danger">已过期 68 天</StatusBadge>
              </div>
              <div className="mt-4 flex justify-between text-xs text-secondary">
                <span>
                  到期日期
                  <br />
                  <strong className="text-sm text-primary">2025-06-15</strong>
                </span>
                <span className="text-right">
                  剩余时间
                  <br />
                  <strong className="text-sm text-danger">已过期 68 天</strong>
                </span>
              </div>
              <Button variant="danger" className="mt-4 w-full">
                立即更新资质
              </Button>
            </CardContent>
          </Card>
        </section>
        <section>
          <h4 className="border-l-2 border-success pl-2 text-sm font-semibold text-success">
            正常运行中
          </h4>
          <div className="mt-3 space-y-3">
            {["汉语语言能力评估", "模拟机复训（每6个月）", "机组年度复训合格证"].map((item) => (
              <Card key={item}>
                <CardContent className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{item}</p>
                  <StatusBadge status="success">有效</StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        <Alert tone="info">PilotShell 在桌面保持最大 430px，移动端不产生横向滚动。</Alert>
      </div>
    </PilotShell>
  );
}
