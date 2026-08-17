export type SupportedLocale = "zh-CN" | (string & {});

export type MessageTranslations = Record<string, string>;

/**
 * Small typed seam for new domain messages. Existing screens keep their
 * current Chinese copy; new template/member DTOs can use stable message keys
 * without introducing a translation framework in this migration.
 */
export function createMessageHelper(
  translations: MessageTranslations,
  locale: SupportedLocale = "zh-CN",
) {
  return (key: string, fallback: string) =>
    translations[`${locale}.${key}`] ?? translations[key] ?? fallback;
}

export function translatedValue(translations: unknown, locale: SupportedLocale, fallback: string) {
  if (!translations || typeof translations !== "object") return fallback;
  const values = translations as Record<string, unknown>;
  const localized = values[locale] ?? values["zh-CN"];
  return typeof localized === "string" && localized.trim() ? localized : fallback;
}
