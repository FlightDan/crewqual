import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage, normalizeLocale, resolveLocale } from "@/lib/locale";

describe("locale resolution", () => {
  it("normalizes Chinese and English regional tags", () => {
    expect(normalizeLocale("zh-TW")).toBe("zh-CN");
    expect(normalizeLocale("en-GB")).toBe("en-US");
    expect(normalizeLocale("fr-FR")).toBeNull();
  });

  it("uses the first supported browser language", () => {
    expect(localeFromAcceptLanguage("fr-FR, en-GB;q=0.8")).toBe("en-US");
    expect(localeFromAcceptLanguage("en-US;q=0.8, zh-CN;q=0.9")).toBe("zh-CN");
    expect(localeFromAcceptLanguage("en-US;q=0, zh-CN;q=0.9")).toBe("zh-CN");
    expect(localeFromAcceptLanguage("zh-CN, en;q=0.7")).toBe("zh-CN");
    expect(localeFromAcceptLanguage("fr-FR")).toBe("zh-CN");
  });

  it("gives a valid cookie precedence over the browser", () => {
    expect(resolveLocale({ cookieLocale: "en-US", acceptLanguage: "zh-CN" })).toBe("en-US");
    expect(resolveLocale({ cookieLocale: "invalid", acceptLanguage: "en-US" })).toBe("en-US");
  });
});
