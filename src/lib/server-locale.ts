import { cookies, headers } from "next/headers";
import { COOKIE_NAMES } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { sha256 } from "@/server/crypto";
import { LOCALE_COOKIE, normalizeLocale, resolveLocale, type SupportedLocale } from "@/lib/locale";

async function organizationLocaleFromSession(
  requestCookies: Awaited<ReturnType<typeof cookies>>,
): Promise<SupportedLocale | null> {
  const adminToken = requestCookies.get(COOKIE_NAMES.admin)?.value;
  const pilotToken =
    requestCookies.get(COOKIE_NAMES.member)?.value ?? requestCookies.get(COOKIE_NAMES.pilot)?.value;
  if (!adminToken && !pilotToken) return null;

  try {
    const db = getPrisma();
    if (adminToken) {
      const session = await db.adminSession.findFirst({
        where: {
          tokenHash: sha256(adminToken),
          expiresAt: { gt: new Date() },
          user: { active: true },
        },
        select: {
          user: {
            select: {
              organization: { select: { defaultLocale: true } },
              unit: { select: { organization: { select: { defaultLocale: true } } } },
            },
          },
        },
      });
      const locale =
        session?.user.organization?.defaultLocale ??
        session?.user.unit?.organization?.defaultLocale;
      return normalizeLocale(locale);
    }
    const session = await db.pilotSession.findFirst({
      where: {
        tokenHash: sha256(pilotToken!),
        expiresAt: { gt: new Date() },
        pilot: { active: true },
      },
      select: {
        pilot: {
          select: { unit: { select: { organization: { select: { defaultLocale: true } } } } },
        },
      },
    });
    return normalizeLocale(session?.pilot.unit.organization?.defaultLocale);
  } catch {
    // Locale resolution must not make public/setup pages unavailable when the
    // database is not ready yet.
    return null;
  }
}

export async function getRequestLocale(): Promise<SupportedLocale> {
  const requestCookies = await cookies();
  const requestHeaders = await headers();
  const organizationLocale = await organizationLocaleFromSession(requestCookies);
  if (organizationLocale) return organizationLocale;
  return resolveLocale({
    cookieLocale: requestCookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: requestHeaders.get("accept-language"),
  });
}

export async function localizedTitle(zh: string, en: string): Promise<string> {
  return (await getRequestLocale()) === "en-US" ? en : zh;
}
