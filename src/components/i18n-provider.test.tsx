import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/components/i18n-provider";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function Probe() {
  const { locale, t, setLocale } = useI18n();
  return (
    <>
      <p>{`${locale}:${t("navigation.overview")}`}</p>
      <button type="button" onClick={() => setLocale("en-US")}>
        set
      </button>
    </>
  );
}

describe("i18n provider", () => {
  beforeEach(() => {
    refresh.mockReset();
    document.cookie = "crewqual_locale=; Max-Age=0; Path=/";
  });

  it("persists an explicitly selected system language and refreshes the current route", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider locale="zh-CN">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText("zh-CN:总览")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "set" }));
    expect(screen.getByText("en-US:Overview")).toBeInTheDocument();
    expect(document.cookie).toContain("crewqual_locale=en-US");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
