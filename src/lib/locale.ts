export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";
export const LOCALE_COOKIE = "crewqual_locale";

export function normalizeLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "en" || normalized.startsWith("en-")) return "en-US";
  return null;
}

export function localeFromAcceptLanguage(value: string | null | undefined): SupportedLocale {
  if (!value) return DEFAULT_LOCALE;
  const candidates = value
    .split(",")
    .map((part, index) => {
      const [rawLocale, ...parameters] = part.split(";");
      const quality = Number(
        parameters
          .find((parameter) => parameter.trim().startsWith("q="))
          ?.trim()
          .slice(2) ?? "1",
      );
      return {
        index,
        locale: normalizeLocale(rawLocale?.trim()),
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((candidate) => candidate.locale && candidate.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);
  for (const candidate of candidates) {
    if (candidate.locale) return candidate.locale;
  }
  return DEFAULT_LOCALE;
}

export function resolveLocale(input: {
  cookieLocale?: unknown;
  acceptLanguage?: string | null;
}): SupportedLocale {
  return normalizeLocale(input.cookieLocale) ?? localeFromAcceptLanguage(input.acceptLanguage);
}

export function localeLabel(locale: SupportedLocale): string {
  return locale === "en-US" ? "English" : "简体中文";
}

export function localeIntl(locale: SupportedLocale): string {
  return locale;
}
