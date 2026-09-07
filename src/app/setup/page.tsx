import { redirect } from "next/navigation";
import { SetupWizard } from "@/components/setup/setup-wizard";
import { getSetupOverview, isSetupRequired } from "@/server/setup";
import { isSetupAuthorized } from "@/server/setup-request";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/locale";
import type { SetupOverview } from "@/types/setup";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await isSetupRequired())) redirect("/admin/login");
  const requestCookies = await cookies();
  const requestHeaders = await headers();
  const locale = resolveLocale({
    cookieLocale: requestCookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: requestHeaders.get("accept-language"),
  });
  const overview: SetupOverview = (await isSetupAuthorized())
    ? await getSetupOverview()
    : {
        required: true,
        mode: "remote",
        environment: {
          database: "unknown",
          storage: "unknown",
          worker: "unknown",
          workerDetail: "",
          version: "",
        },
        templates: [],
        defaults: {
          locale,
          timezone: "Asia/Shanghai",
          organizationName: "",
          backupPath: "",
        },
      };
  if (!overview.required) redirect("/admin/login");
  return (
    <SetupWizard initialOverview={{ ...overview, defaults: { ...overview.defaults, locale } }} />
  );
}
