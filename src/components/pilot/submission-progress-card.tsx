import { BellRing, CheckCircle2, Server, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Divider } from "@/components/ui/misc";
import type { SubmissionReceipt } from "@/types/services";

export function SubmissionProgressCard({ receipt }: { receipt: SubmissionReceipt }) {
  const statusLabel = {
    received: "已接收",
    processing: "审核处理中",
    approved: "审核通过",
    returned: "需要补充材料",
  }[receipt.status];
  const rows = [
    {
      icon: Server,
      title: "已提交至服务器",
      body: new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(
        new Date(receipt.submittedAt),
      ),
      tone: "text-success",
    },
    {
      icon: ShieldCheck,
      title: "后台审核处理中",
      body:
        receipt.status === "returned"
          ? (receipt.returnReason ?? "请根据审核意见补充材料后重新提交")
          : receipt.status === "approved"
            ? (receipt.decisionNote ?? "本次资质更新已通过人工审核")
            : "系统正在后台处理本次资质更新",
      tone: "text-brand",
    },
    {
      icon: BellRing,
      title: "审核完成后通知",
      body: "审核完成后将通过系统消息及已配置的通知渠道发送结果",
      tone: "text-brand",
    },
  ];
  return (
    <Card className="rounded-xl p-5 shadow-none">
      {rows.map((row, index) => {
        const Icon = row.icon;
        return (
          <div key={row.title}>
            {index ? <Divider className="my-4" /> : null}
            <div className="flex gap-3">
              <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${row.tone}`} />
              <div>
                <h2 className="text-sm font-bold text-primary">{row.title}</h2>
                <p className="mt-1 text-xs leading-5 text-secondary">{row.body}</p>
              </div>
            </div>
          </div>
        );
      })}
      <p className="mt-4 text-xs text-secondary" role="status">
        当前状态：{statusLabel}
      </p>
      <div className="sr-only">
        <CheckCircle2 />
        回执编号 {receipt.id}
      </div>
    </Card>
  );
}
