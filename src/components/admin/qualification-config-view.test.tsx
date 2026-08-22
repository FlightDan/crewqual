import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QualificationConfigView } from "@/components/admin/qualification-config-view";
import { applicationServices } from "@/services/application-services";
import { adminStateStore } from "@/services/admin-state-store";
import type { QualificationConfigInput } from "@/types/services";

const routerReplace = vi.fn();
const params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/qualification-config",
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => params,
}));

function renderView(positionCode = "PILOT") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QualificationConfigView positionCode={positionCode} />
    </QueryClientProvider>,
  );
}

describe("QualificationConfigView selection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    routerReplace.mockReset();
    for (const key of [...params.keys()]) params.delete(key);
    window.history.replaceState(null, "", "/admin/qualification-config");
    window.sessionStorage.clear();
    adminStateStore.reset();
  });

  it("keeps selection in the URL and never carries dirty values into another config", async () => {
    const user = userEvent.setup();
    const historyReplace = vi.spyOn(window.history, "replaceState");
    vi.spyOn(applicationServices.qualificationConfigs, "list").mockResolvedValue({
      data: adminStateStore
        .getSnapshot()
        .qualificationConfigs.map((config) =>
          config.id === "config-medical-certificate" ? { ...config, locked: false } : config,
        ),
      source: "mock",
    });
    renderView();

    const description = await screen.findByLabelText("等级/参数帮助说明");
    await waitFor(() =>
      expect(historyReplace).toHaveBeenCalledWith(
        window.history.state,
        "",
        "/admin/qualification-config?config=config-medical-certificate",
      ),
    );
    await user.clear(description);
    await user.type(description, "尚未保存的体检限制说明");
    await user.click(screen.getByRole("button", { name: /2 机组年度复训合格证/ }));
    expect(screen.getByRole("dialog", { name: "放弃未保存的配置修改？" })).toBeVisible();
    expect(screen.getByLabelText("等级/参数帮助说明")).toHaveValue("尚未保存的体检限制说明");

    await user.click(screen.getByRole("button", { name: "放弃并切换" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /机组年度复训合格证 - 资质项目配置/ }),
      ).toBeVisible(),
    );
    expect(screen.getByLabelText("等级/参数帮助说明")).not.toHaveValue("尚未保存的体检限制说明");
    expect(historyReplace).toHaveBeenLastCalledWith(
      window.history.state,
      "",
      "/admin/qualification-config?config=config-annual-recurrent-training",
    );
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("honors a deep link and switches configs without router or service navigation", async () => {
    params.set("config", "config-icao-english-endorsement");
    window.history.replaceState(
      null,
      "",
      "/admin/qualification-config?config=config-icao-english-endorsement",
    );
    const list = vi.spyOn(applicationServices.qualificationConfigs, "list");
    const getById = vi.spyOn(applicationServices.qualificationConfigs, "getById");
    const historyReplace = vi.spyOn(window.history, "replaceState");
    const user = userEvent.setup();
    renderView();

    expect(
      await screen.findByRole("heading", { name: /ICAO英语语言能力等级签注 - 资质项目配置/ }),
    ).toBeVisible();
    expect(historyReplace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /6 模拟机复训/ }));

    expect(
      screen.getByRole("heading", { name: /模拟机复训（每6个月） - 资质项目配置/ }),
    ).toBeVisible();
    expect(screen.getByLabelText("等级/参数帮助说明")).toHaveValue("记录训练机型");
    expect(window.location.search).toBe("?config=config-simulator-recurrent-training");
    expect(list).toHaveBeenCalledTimes(1);
    expect(getById).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("normalizes an invalid deep link without a route navigation", async () => {
    params.set("config", "does-not-exist");
    window.history.replaceState(null, "", "/admin/qualification-config?config=does-not-exist");
    const historyReplace = vi.spyOn(window.history, "replaceState");
    renderView();

    expect(
      await screen.findByRole("heading", { name: /民用航空人员体检合格证 - 资质项目配置/ }),
    ).toBeVisible();
    expect(window.location.search).toBe("?config=config-medical-certificate");
    expect(historyReplace).toHaveBeenCalledTimes(1);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("updates the cached version so consecutive saves use the latest version", async () => {
    params.set("config", "config-medical-certificate");
    window.history.replaceState(
      null,
      "",
      "/admin/qualification-config?config=config-medical-certificate",
    );
    const configs = adminStateStore.getSnapshot().qualificationConfigs.map((config) => ({
      ...config,
      locked: config.id === "config-medical-certificate" ? false : config.locked,
      version: config.id === "config-medical-certificate" ? 1 : undefined,
    }));
    vi.spyOn(applicationServices.qualificationConfigs, "list").mockResolvedValue({
      data: configs,
      source: "mock",
    });
    const save = vi
      .spyOn(applicationServices.qualificationConfigs, "save")
      .mockImplementation(async (_positionCode, id, input) => {
        const current = configs.find((config) => config.id === id)!;
        const { expectedVersion, ...values } = input as QualificationConfigInput & {
          expectedVersion?: number;
        };
        return {
          data: {
            ...current,
            ...values,
            version: (expectedVersion ?? 0) + 1,
            updatedAt: `save-${(expectedVersion ?? 0) + 1}`,
          },
          source: "mock",
        };
      });
    const user = userEvent.setup();
    renderView();

    const firstDays = await screen.findByLabelText("首次提醒（到期前天数） *");
    await user.clear(firstDays);
    await user.type(firstDays, "90");
    await user.click(screen.getByRole("button", { name: "保存并查看影响摘要" }));
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    await screen.findByText(/现有生效记录未被回写/);

    await user.clear(firstDays);
    await user.type(firstDays, "100");
    await user.click(screen.getByRole("button", { name: "保存并查看影响摘要" }));
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    expect(save.mock.calls[0]?.[2]).toMatchObject({ expectedVersion: 1 });
    expect(save.mock.calls[1]?.[2]).toMatchObject({ expectedVersion: 2 });
  });

  it("adds a position-scoped supplemental config to the cache and selects it", async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByTestId("qualification-config-editor");

    await user.click(screen.getByRole("button", { name: "新增资质项目" }));
    const dialog = screen.getByRole("dialog", { name: "新增资质项目" });
    await user.type(within(dialog).getByLabelText("资质项目名称 *"), "CRM专项训练");
    await user.click(within(dialog).getByRole("button", { name: "创建资质项目" }));

    expect(
      await screen.findByRole("heading", { name: /CRM专项训练 - 资质项目配置/ }),
    ).toBeVisible();
    expect(screen.getByText("资质项目（7）")).toBeVisible();
    expect(window.location.search).toMatch(/^\?config=custom-/);
  });

  it("starts non-pilot positions empty and creates an independent core config", async () => {
    const user = userEvent.setup();
    renderView("CABIN_CREW");

    expect(await screen.findByText("当前职位还没有资质项目")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "新增资质项目" }));
    const dialog = screen.getByRole("dialog", { name: "新增资质项目" });
    await user.type(within(dialog).getByLabelText("资质项目名称 *"), "客舱应急训练");
    await user.selectOptions(within(dialog).getByLabelText("资质类型"), "core");
    await user.click(within(dialog).getByRole("button", { name: "创建资质项目" }));

    expect(
      await screen.findByRole("heading", { name: /客舱应急训练 - 资质项目配置/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "核心资质 1" })).toBeVisible();
    expect((await applicationServices.qualificationConfigs.list("PILOT")).data).toHaveLength(6);
    expect((await applicationServices.qualificationConfigs.list("CABIN_CREW")).data).toHaveLength(
      1,
    );
  });

  it("protects structured rules on locked core qualifications", async () => {
    renderView();
    await screen.findByTestId("qualification-config-editor");

    expect(screen.getByText(/模板核心资质的结构化规则由模板锁定/)).toBeVisible();
    expect(screen.getByRole("button", { name: "添加条目" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "显示等级/参数帮助说明" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "人工指定到期日" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "首次提醒（到期前天数）" })).toBeDisabled();
    const recipientCheckboxes = screen.getAllByRole("checkbox", { name: "本人" });
    expect(recipientCheckboxes).toHaveLength(2);
    recipientCheckboxes.forEach((input) => expect(input).toBeDisabled());
    expect(screen.getByRole("switch", { name: "启用 AI/OCR 辅助核验配置" })).toBeDisabled();
    const saved = (await applicationServices.qualificationConfigs.list("PILOT")).data.find(
      (item) => item.id === "config-medical-certificate",
    );
    expect(saved?.customFields).toEqual([]);
  });
});
