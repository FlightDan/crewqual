import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, LocaleSwitcher, useI18n } from "@/components/i18n-provider";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function Probe() {
  const { locale, t } = useI18n();
  return <p>{`${locale}:${t("navigation.overview")}`}</p>;
}

describe("i18n provider", () => {
  beforeEach(() => {
    refresh.mockReset();
    document.cookie = "crewqual_locale=; Max-Age=0; Path=/";
  });

  it("switches language, persists a cookie and refreshes the current route", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider locale="zh-CN">
        <Probe />
        <LocaleSwitcher />
      </I18nProvider>,
    );
    expect(screen.getByText("zh-CN:总览")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切换语言" }));
    expect(screen.getByText("en-US:Overview")).toBeInTheDocument();
    expect(document.cookie).toContain("crewqual_locale=en-US");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
