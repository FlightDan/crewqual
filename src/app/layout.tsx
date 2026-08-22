import type { Metadata } from "next";
import "./globals.css";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { getMockInstanceId } from "@/server/mock-runtime";
import { ApplicationServicesProvider } from "@/services/application-services-provider";
import { I18nProvider } from "@/components/i18n-provider";
import { getRequestLocale } from "@/lib/server-locale";

export const metadata: Metadata = {
  title: "CrewQual UI",
  description: "CrewQual responsive UI foundation",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
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
