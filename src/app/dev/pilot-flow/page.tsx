import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Pilot Flow 开发验收",
  robots: { index: false, follow: false },
};

const primaryRoutes = [
  ["身份验证", "/pilot/identity"],
  ["我的资质", "/pilot/qualifications"],
  ["更新资质（初始空表单）", "/pilot/qualifications/medical-certificate/update"],
] as const;

const scenarios = [
  ["recognizing", "正在识别日期"],
  ["recognized", "日期识别完成"],
  ["ambiguous", "多个日期候选"],
  ["conflict", "AI 与手动日期冲突"],
  ["mismatch", "AI 审核不一致"],
  ["disabled", "自动识别未启用"],
  ["busy", "AI 服务繁忙"],
  ["modified", "AI 日期已手动修改"],
  ["confirm", "AI 未完成提交确认"],
] as const;

export default function PilotFlowDevPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold">飞行员端闭环开发验收</h1>
      <p className="mt-2 text-sm text-secondary">场景由 URL 参数驱动，生产页面不显示切换器。</p>
      <section className="mt-8">
        <h2 className="text-base font-bold">主流程</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {primaryRoutes.map(([title, href]) => (
            <FlowLink key={href} title={title} href={href} />
          ))}
        </div>
      </section>
      <section className="mt-8">
        <h2 className="text-base font-bold">AI 与提交状态</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {scenarios.map(([scenario, title]) => (
            <FlowLink
              key={scenario}
              title={title}
              href={`/pilot/qualifications/medical-certificate/update?scenario=${scenario}`}
              detail={scenario}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

function FlowLink({ title, href, detail }: { title: string; href: string; detail?: string }) {
  return (
    <Link href={href}>
      <Card className="flex min-h-20 items-center justify-between p-4 transition hover:border-brand">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {detail ? <p className="mt-1 text-xs text-muted">?scenario={detail}</p> : null}
        </div>
        <ArrowRight aria-hidden="true" className="size-4 text-brand" />
      </Card>
    </Link>
  );
}
