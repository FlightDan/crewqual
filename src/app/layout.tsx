import type { Metadata } from "next";
import "./globals.css";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { getMockInstanceId } from "@/server/mock-runtime";
import { ApplicationServicesProvider } from "@/services/application-services-provider";

export const metadata: Metadata = {
  title: "CrewQual UI",
  description: "CrewQual responsive UI foundation",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const mockAttributes = isRemoteServiceMode()
    ? {}
    : { "data-mock-instance-id": getMockInstanceId() };
  return (
    <html lang="zh-CN">
      <body {...mockAttributes}>
        <ApplicationServicesProvider>{children}</ApplicationServicesProvider>
      </body>
    </html>
  );
}
