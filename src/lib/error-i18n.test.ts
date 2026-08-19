import { describe, expect, it, vi } from "vitest";
import { localizeError } from "@/lib/error-i18n";

describe("localizeError", () => {
  it("maps stable service codes and preserves safe English messages", () => {
    const t = (key: string) =>
      ({
        "errors.notFound": "Not found",
        "errors.remote": "Service unavailable",
      })[key] ?? key;
    expect(localizeError(Object.assign(new Error("missing"), { code: "NOT_FOUND" }), t)).toBe(
      "Not found",
    );
    expect(localizeError(new Error("A safe message"), t)).toBe("A safe message");
  });

  it("falls back instead of exposing Chinese service text in English UI", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = (key: string) => (key === "errors.remote" ? "Service unavailable" : key);
    expect(localizeError(new Error("请求失败"), t)).toBe("Service unavailable");
    warn.mockRestore();
  });
});
