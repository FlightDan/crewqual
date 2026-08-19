import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { getMockInstanceId } from "@/server/mock-runtime";
import { ApplicationServicesProvider } from "@/services/application-services-provider";
import { I18nProvider } from "@/components/i18n-provider";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "CrewQual UI",
  description: "CrewQual responsive UI foundation",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestCookies = await cookies();
  const requestHeaders = await headers();
  const locale = resolveLocale({
    cookieLocale: requestCookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: requestHeaders.get("accept-language"),
  });
  const mockAttributes = isRemoteServiceMode()
    ? {}
    : { "data-mock-instance-id": getMockInstanceId() };
  return (
    <html lang={locale} suppressHydrationWarning>
      <body {...mockAttributes}>
        <I18nProvider locale={locale}>
          <ApplicationServicesProvider>{children}</ApplicationServicesProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
