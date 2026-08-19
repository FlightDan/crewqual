import { redirect } from "next/navigation";
import { SetupWizard } from "@/components/setup/setup-wizard";
import { getSetupOverview } from "@/server/setup";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const overview = await getSetupOverview();
  if (!overview.required) redirect("/admin/login");
  const requestCookies = await cookies();
  const requestHeaders = await headers();
  const locale = resolveLocale({
    cookieLocale: requestCookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: requestHeaders.get("accept-language"),
  });
  return (
    <SetupWizard initialOverview={{ ...overview, defaults: { ...overview.defaults, locale } }} />
  );
}
