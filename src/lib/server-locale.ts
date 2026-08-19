import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, type SupportedLocale } from "@/lib/locale";

export async function getRequestLocale(): Promise<SupportedLocale> {
  const requestCookies = await cookies();
  const requestHeaders = await headers();
  return resolveLocale({
    cookieLocale: requestCookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: requestHeaders.get("accept-language"),
  });
}

export async function localizedTitle(zh: string, en: string): Promise<string> {
  return (await getRequestLocale()) === "en-US" ? en : zh;
}
