"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, LOCALE_COOKIE, localeLabel, type SupportedLocale } from "@/lib/locale";
import { translate } from "@/lib/messages";

type I18nContextValue = {
  locale: SupportedLocale;
  t: (key: string, values?: Record<string, string | number>) => string;
  setLocale: (locale: SupportedLocale) => void;
  localeLabel: (locale: SupportedLocale) => string;
};

const I18nContext = React.createContext<I18nContextValue | null>(null);
const fallbackI18nValue: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  t: (key, values) => translate(DEFAULT_LOCALE, key, values),
  setLocale: () => undefined,
  localeLabel,
};

export function I18nProvider({
  locale,
  children,
}: {
  locale: SupportedLocale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [currentLocale, setCurrentLocale] = React.useState(locale);
  React.useEffect(() => setCurrentLocale(locale), [locale]);
  const setLocale = React.useCallback(
    (nextLocale: SupportedLocale) => {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(nextLocale)}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
      document.documentElement.lang = nextLocale;
      setCurrentLocale(nextLocale);
      router.refresh();
    },
    [router],
  );
  const value = React.useMemo<I18nContextValue>(
    () => ({
      locale: currentLocale,
      t: (key, values) => translate(currentLocale, key, values),
      setLocale,
      localeLabel,
    }),
    [currentLocale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = React.useContext(I18nContext);
  if (value) return value;
  return fallbackI18nValue;
}
