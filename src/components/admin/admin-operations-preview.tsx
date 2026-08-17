"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { adminStateStore } from "@/services/admin-state-store";
import { mockStorageKey } from "@/services/temp-storage";

const groups = [
  {
    title: "统一日历视图",
    links: [
      ["月历 + 升级节点", "/admin/calendar?view=month&date=2026-08-14&type=upgrade_stage"],
      ["90 天列表", "/admin/calendar?view=agenda&date=2026-08-14"],
      ["周历", "/admin/calendar?view=week&date=2026-08-14"],
      ["人员时间线", "/admin/calendar?view=timeline&date=2026-08-14"],
      [
        "资质只读事件",
        "/admin/calendar?date=2026-08-05&event=qualification%3Apilot-demo-02%3Amedical-certificate",
      ],
      [
        "升级事件详情",
        "/admin/calendar?date=2026-08-14&event=upgrade%3Aupgrade-01%3Aupgrade-01-stage-5",
      ],
    ],
  },
  {
    title: "升级计划状态",
    links: [
      ["计划列表", "/admin/upgrade-plans"],
      ["进行中/延期", "/admin/upgrade-plans/upgrade-01"],
      ["未开始", "/admin/upgrade-plans/upgrade-02"],
      ["已完成（只读）", "/admin/upgrade-plans/upgrade-03"],
      ["已暂停", "/admin/upgrade-plans/upgrade-04"],
      ["草稿 / 资质阻断", "/admin/upgrade-plans/upgrade-05"],
      ["已取消（只读）", "/admin/upgrade-plans/upgrade-06"],
      ["新建·基本信息", "/admin/upgrade-plans/new?step=basic"],
      ["新建·配置节点", "/admin/upgrade-plans/new?step=stages"],
      ["新建·确认创建", "/admin/upgrade-plans/new?step=confirm"],
    ],
  },
  {
    title: "配置与通知异常",
    links: [
      ["配置·固定月数", "/admin/qualification-config?config=config-annual-recurrent-training"],
      ["配置·手动到期", "/admin/qualification-config?config=config-medical-certificate"],
      ["配置·长期有效", "/admin/qualification-config?config=config-chinese-language-assessment"],
      ["通知全部状态", "/admin/notifications"],
      ["已发送（演示）", "/admin/notifications?status=sent&notification=NOT-1001"],
      ["失败通知", "/admin/notifications?status=failed&notification=NOT-1003"],
      ["待发送队列", "/admin/notifications?status=queued"],
      ["审核退回联动", "/admin/reviews/REV-1003"],
      ["无效日历 URL 回退", "/admin/calendar?view=broken&date=not-a-date&type=broken"],
    ],
  },
];

export function AdminOperationsPreview() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">第四批确定性验收入口</h1>
          <p className="mt-1 text-sm text-secondary">固定时钟 2026-08-14 · 全部数据为虚构 Mock</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            adminStateStore.reset();
            window.sessionStorage.removeItem(mockStorageKey("upgrade-plan-draft:new"));
            window.location.reload();
          }}
        >
          <RotateCcw className="size-4" />
          重置第四批状态
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {groups.map((group) => (
          <Card key={group.title} className="p-4 shadow-none">
            <h2 className="font-bold">{group.title}</h2>
            <div className="mt-3 space-y-2">
              {group.links.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="block rounded-md border border-border px-3 py-2 text-sm font-semibold text-brand hover:bg-blue-50"
                >
                  {label}
                </Link>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Card className="p-4 text-sm leading-6 shadow-none">
        <b>安全边界：</b>通知“发送”均为浏览器内确定性状态转换；AI/OCR
        只描述辅助核验项目，不执行自动审批、自动退回或终审。
      </Card>
    </main>
  );
}
