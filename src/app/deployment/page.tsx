import Link from "next/link";
import { CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getRequestLocale, localizedTitle } from "@/lib/server-locale";
import { translate } from "@/lib/messages";
import { LocaleSwitcher } from "@/components/i18n-provider";

export async function generateMetadata() {
  return { title: `CrewQual ${await localizedTitle("部署说明", "Deployment guide")}` };
}

export default async function DeploymentGuidePage() {
  const locale = await getRequestLocale();
  const t = (key: string) => translate(locale, key);
  const checks = [
    "deployment.check.health",
    "deployment.check.login",
    "deployment.check.integrations",
    "deployment.check.restore",
    "deployment.check.secrets",
  ];
  return (
    <main className="min-h-dvh bg-surface px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-lg bg-brand text-white">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="text-lg font-bold text-primary">CrewQual</p>
              <p className="text-xs text-muted">{t("deployment.subtitle")}</p>
            </div>
          </div>
          <LocaleSwitcher />
        </div>
        <h1 className="mt-8 text-3xl font-bold text-primary">{t("deployment.title")}</h1>
        <p className="mt-3 text-sm leading-6 text-secondary">{t("deployment.description")}</p>
        <Card className="mt-8 p-6">
          <ul className="space-y-4 text-sm text-secondary">
            {checks.map((key) => (
              <li key={key} className="flex items-start gap-3">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                {t(key)}
              </li>
            ))}
          </ul>
        </Card>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/admin/login"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-blue-600"
          >
            {t("deployment.login")}
          </Link>
          <a
            href="/api/health"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold text-primary hover:bg-slate-50"
          >
            {t("deployment.health")}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </div>
      </div>
    </main>
  );
}
