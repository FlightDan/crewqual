import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QualificationUpdateFlow } from "@/components/pilot/qualification-update-flow";
import { pilotQualificationFixtures } from "@/mocks/fixtures";
import { mockDocumentIntelligenceService } from "@/services/mock-services";
import { deriveQualification } from "@/lib/qualification-date-status";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const qualification = deriveQualification(pilotQualificationFixtures[0]!, {
  now: () => new Date("2026-08-14T08:00:00Z"),
});
const credential = new File(["mock-image"], "credential.jpg", { type: "image/jpeg" });

describe("QualificationUpdateFlow", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders an empty initial form with AI and submit actions disabled", () => {
    render(<QualificationUpdateFlow qualification={qualification} />);
    expect(screen.getByLabelText("证件编号 *")).toHaveValue("");
    expect(screen.getByLabelText("签发日期 *")).toHaveAttribute("placeholder", "YYYY-MM-DD");
    expect(screen.getByLabelText("到期日期 *")).toHaveValue("");
    expect(screen.getByRole("button", { name: "开始AI审核" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "跳过AI审核" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提交更新" })).toBeDisabled();
  });

  it("enters recognizing after a valid image upload", async () => {
    render(<QualificationUpdateFlow qualification={qualification} scenario="recognizing" />);
    expect(await screen.findByText("正在识别凭证日期")).toBeVisible();
  });

  it("fills only blank dates and keeps a manual date", async () => {
    vi.spyOn(mockDocumentIntelligenceService, "recognizeDates").mockResolvedValue({
      data: {
        kind: "recognized",
        dates: { issueDate: "2026-01-09", expiryDate: "2026-10-09" },
        confidence: { issueDate: 0.98, expiryDate: 0.96 },
      },
      source: "mock",
    });
    const user = userEvent.setup();
    render(<QualificationUpdateFlow qualification={qualification} />);
    await user.type(screen.getByLabelText("签发日期 *"), "2026-02-01");
    await user.upload(screen.getByTestId("credential-file"), credential);
    await waitFor(() => expect(screen.getByLabelText("到期日期 *")).toHaveValue("2026-10-09"));
    expect(screen.getByLabelText("签发日期 *")).toHaveValue("2026-02-01");
    expect(screen.getByText(/默认保留手动日期 2026-02-01/)).toBeVisible();
  });

  it("shows manually modified source after changing an AI date", async () => {
    const user = userEvent.setup();
    render(<QualificationUpdateFlow qualification={qualification} scenario="recognized" />);
    const expiry = await screen.findByLabelText("到期日期 *");
    await user.clear(expiry);
    await user.type(expiry, "2026-10-10");
    expect(screen.getByText("已手动修改")).toBeVisible();
  });

  it("allows an ambiguous candidate to be selected", async () => {
    const user = userEvent.setup();
    render(<QualificationUpdateFlow qualification={qualification} scenario="ambiguous" />);
    await user.click(await screen.findByRole("button", { name: /2026-10-09/ }));
    expect(screen.getByLabelText("到期日期 *")).toHaveValue("2026-10-09");
    expect(screen.queryByText("暂不使用")).not.toBeInTheDocument();
  });

  it("can ignore ambiguous dates", async () => {
    const user = userEvent.setup();
    render(<QualificationUpdateFlow qualification={qualification} scenario="ambiguous" />);
    await user.click(await screen.findByRole("button", { name: "暂不使用" }));
    expect(screen.getByText("已跳过AI审核")).toBeVisible();
    expect(screen.getByLabelText("到期日期 *")).toHaveValue("");
  });

  it("keeps manual value by default in a conflict", async () => {
    const user = userEvent.setup();
    render(<QualificationUpdateFlow qualification={qualification} scenario="conflict" />);
    const expiry = await screen.findByLabelText("到期日期 *");
    expect(expiry).toHaveValue("2026-10-09");
    await user.click(screen.getByRole("button", { name: "保留手动填写" }));
    expect(expiry).toHaveValue("2026-10-09");
  });

  it("does not block a valid submission on mismatch", async () => {
    render(<QualificationUpdateFlow qualification={qualification} scenario="mismatch" />);
    expect(await screen.findByText("AI发现可能不一致")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "提交更新" })).toBeEnabled());
  });

  it("can skip a busy AI service and submit", async () => {
    const user = userEvent.setup();
    render(<QualificationUpdateFlow qualification={qualification} scenario="busy" />);
    const skip = await screen.findByRole("button", { name: "跳过并直接提交" });
    await waitFor(() => expect(skip).toBeEnabled());
    await user.click(skip);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/pilot\/submissions\/SUB-/)),
    );
  });

  it("explains when recognition is disabled and keeps the manual form available", async () => {
    render(<QualificationUpdateFlow qualification={qualification} scenario="disabled" />);

    expect(await screen.findByText("暂未启用证照识别")).toBeVisible();
    expect(
      screen.getByText("当前系统未启用自动识别，请根据证照内容手动填写并提交。"),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "跳过并直接提交" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始AI审核" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交更新" })).toBeEnabled();
  });

  it("shows a confirmation dialog when AI is unfinished", async () => {
    render(<QualificationUpdateFlow qualification={qualification} scenario="confirm" />);
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.getByText("AI辅助处理尚未完成")).toBeVisible();
    expect(screen.getByRole("button", { name: "继续等待" })).toBeVisible();
    expect(screen.getByRole("button", { name: "直接提交" })).toBeVisible();
  });

  it("submits a completed draft and navigates to the receipt", async () => {
    const user = userEvent.setup();
    render(<QualificationUpdateFlow qualification={qualification} scenario="recognized" />);
    const submit = await screen.findByRole("button", { name: "提交更新" });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/pilot\/submissions\/SUB-/)),
    );
  });
});
