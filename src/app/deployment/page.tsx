import Link from "next/link";
import { CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";

export const metadata = {
  title: "CrewQual 部署说明",
};

export default function DeploymentGuidePage() {
  return (
    <main className="min-h-dvh bg-surface px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-lg bg-brand text-white">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-lg font-bold text-primary">CrewQual</p>
            <p className="text-xs text-muted">部署与初始化说明</p>
          </div>
        </div>
        <h1 className="mt-8 text-3xl font-bold text-primary">部署完成后的检查清单</h1>
        <p className="mt-3 text-sm leading-6 text-secondary">
          初始化完成后，请继续验证对象存储、Worker、外部通知与异机备份，并安排首次恢复演练。
        </p>
        <Card className="mt-8 p-6">
          <ul className="space-y-4 text-sm text-secondary">
            {[
              "确认 /api/health 中 database、storage、queue 和 worker 状态",
              "使用超级管理员账号完成首次安全登录",
              "在系统设置中测试飞书、短信和备份目标",
              "在隔离环境完成数据库与图库恢复演练",
              "将 TOTP 恢复信息和备份密钥保存到组织密码管理器",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                {item}
              </li>
            ))}
          </ul>
        </Card>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/admin/login"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-blue-600"
          >
            前往管理员登录
          </Link>
          <a
            href="/api/health"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold text-primary hover:bg-slate-50"
          >
            查看系统健康状态
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </div>
      </div>
    </main>
  );
}
