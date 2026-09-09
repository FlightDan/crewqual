import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecurityRiskSummary } from "@/types/admin-settings";
const mocks = vi.hoisted(() => ({
  trends: vi.fn(),
  detections: vi.fn(),
  summary: vi.fn(),
  canRead: true,
  sessionId: "session-a",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/settings",
}));
vi.mock("@/services/admin-settings-service", async (original) => ({
  ...(await original<typeof import("@/services/admin-settings-service")>()),
  adminSettingsService: {
    loadSecurityTrends: mocks.trends,
    loadSecurityDetections: mocks.detections,
    loadSecuritySummary: mocks.summary,
  },
}));
vi.mock("@/services/admin-session-provider", () => ({
  useAdminSession: () => ({
    status: "authenticated",
    hasPermission: () => mocks.canRead,
    session: { id: "same-admin", sessionId: mocks.sessionId, sessions: [] },
  }),
}));
import {
  SecurityRiskStatistics,
  securityTrendRows,
} from "@/components/admin/settings/security-settings-section";
import { AdminLoginSecuritySummary } from "@/components/admin/admin-workspace-shell";
import { I18nProvider } from "@/components/i18n-provider";

function summary(overrides: Partial<SecurityRiskSummary> = {}): SecurityRiskSummary {
  const counts = { batches: 0, requests: 0, sources: 0, sourceSegments: {} };
  return {
    ...counts,
    keyRotation: false,
    unknownSourceRequests: 0,
    categories: {
      PUBLIC_SCAN: counts,
      CREDENTIAL_STUFFING: counts,
      DISTRIBUTED_LOGIN_ATTEMPT: counts,
    },
    since: "2026-09-08T00:00:00Z",
    until: "2026-09-08T02:00:00Z",
    trend: [],
    trendBucketSeconds: 3600,
    complete: true,
    collectionHealthy: true,
    processedThrough: "2026-09-08T02:00:00Z",
    lastCollectedAt: "2026-09-08T02:00:00Z",
    lastAggregatedAt: "2026-09-08T02:00:00Z",
    droppedCount: 0,
    lastError: null,
    delayed: false,
    ...overrides,
  };
}

describe("security risk interface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.stubEnv("NEXT_PUBLIC_SERVICE_MODE", "remote");
    mocks.canRead = true;
    mocks.trends.mockResolvedValue(summary());
    mocks.detections.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shows complete empty results with keyboard-accessible period selection and a data table", async () => {
    const user = userEvent.setup();
    render(<SecurityRiskStatistics />);
    expect(await screen.findByText("统计完整")).toBeVisible();
    expect(screen.getByText("此区间未检测到疑似扫描、撞库或分布式登录尝试。")).toBeVisible();
    await user.click(screen.getByText("趋势数据表"));
    expect(screen.getByRole("table")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("统计时间范围"), "7d");
    await waitFor(() => expect(mocks.trends).toHaveBeenLastCalledWith("7d"));
    expect(mocks.detections).toHaveBeenLastCalledWith("7d", 1);
  });

  it("does not imply zero attacks for collection gaps, overflow or key rotation", async () => {
    mocks.trends.mockResolvedValue(
      summary({
        complete: false,
        collectionHealthy: false,
        delayed: true,
        droppedCount: 7,
        sources: null,
        keyRotation: true,
        sourceSegments: { v1: 3, v2: 4 },
        unknownSourceRequests: 2,
      }),
    );
    render(<SecurityRiskStatistics />);
    expect(await screen.findByText("安全统计暂不完整")).toBeVisible();
    expect(screen.getByText(/容量保护已丢弃 7/)).toBeVisible();
    expect(screen.getByText(/来源不可判定：2/)).toBeVisible();
    expect(screen.getByText("版本 v1：3 个来源")).toBeVisible();
    expect(screen.getByText(/统计延迟/)).toBeVisible();
    expect(screen.queryByText(/此区间未检测到/)).not.toBeInTheDocument();
    expect(securityTrendRows(summary({ complete: false }))[0].requests).toBeNull();
  });

  it("ignores stale period responses and paginates without adding classification totals", async () => {
    const user = userEvent.setup();
    let resolveOld!: (value: SecurityRiskSummary) => void;
    mocks.trends.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    mocks.detections.mockImplementation(async (_range, page) => ({
      items: [],
      page,
      pageSize: 20,
      total: 21,
      totalPages: 2,
    }));
    render(<SecurityRiskStatistics />);
    await user.selectOptions(screen.getByLabelText("统计时间范围"), "30d");
    await screen.findByText("统计完整");
    await act(async () => resolveOld(summary({ complete: false, collectionHealthy: false })));
    expect(screen.queryByText("安全统计暂不完整")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(mocks.detections).toHaveBeenLastCalledWith("30d", 2));
    expect(await screen.findByText("第 2 页，共 2 页")).toBeVisible();
  });

  it("provides an English failure state and retries without showing empty success", async () => {
    mocks.trends.mockRejectedValueOnce(new Error("internal diagnostic must not be shown"));
    const user = userEvent.setup();
    render(
      <I18nProvider locale="en-US">
        <SecurityRiskStatistics />
      </I18nProvider>,
    );
    expect(
      await screen.findByText("Unable to load security statistics. Please retry."),
    ).toBeVisible();
    expect(screen.queryByText(/internal diagnostic/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh statistics" }));
    expect(await screen.findByText("Statistics complete")).toBeVisible();
  });

  it("does not request global statistics without audit.read", () => {
    mocks.canRead = false;
    render(<SecurityRiskStatistics />);
    expect(mocks.trends).not.toHaveBeenCalled();
    expect(mocks.detections).not.toHaveBeenCalled();
  });

  it("renders retained detection evidence, masked accounts and composite risk", async () => {
    mocks.detections.mockResolvedValue({
      items: [
        {
          id: "batch-one",
          category: "CREDENTIAL_STUFFING",
          ruleVersion: 1,
          windowStart: "2026-09-08T00:00:00Z",
          windowEnd: "2026-09-08T01:00:00Z",
          requestCount: 40,
          sourceCount: 2,
          accountCount: 3,
          pathCount: 1,
          truncatedByRetention: true,
          sample: {
            rules: ["future-rule"],
            maskedSources: ["192.0.2.0/24"],
            successfulLoginAfterAttack: true,
          },
          accounts: [{ label: "account-abc", masked: true, count: 20 }],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    render(<SecurityRiskStatistics />);
    expect(await screen.findByText("account-abc（20 次请求）")).toBeVisible();
    expect(screen.getByText(/脱敏标识/)).toBeVisible();
    expect(screen.getByText("来源样例：192.0.2.0/24")).toBeVisible();
    expect(screen.getByText("已按 30 天保留期截断")).toBeVisible();
    expect(screen.getByText("命中规则的来源随后成功登录；此组合仍为疑似风险。")).toBeVisible();
    expect(screen.queryByText("future-rule")).not.toBeInTheDocument();
  });

  it("deduplicates the toast on remount even when browser storage writes fail", async () => {
    mocks.sessionId = "toast-storage-blocked";
    mocks.summary.mockResolvedValue({ ...summary(), sessionId: mocks.sessionId });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const first = render(<AdminLoginSecuritySummary />);
    expect(await screen.findByText("本次登录安全摘要")).toBeVisible();
    first.unmount();
    mocks.summary.mockClear();
    render(<AdminLoginSecuritySummary />);
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(screen.queryByText("本次登录安全摘要")).not.toBeInTheDocument();
  });

  it("shows one toast per session even after remount, but allows a new login by the same admin", async () => {
    mocks.sessionId = "toast-session-one";
    mocks.summary.mockImplementation(async () => ({ ...summary(), sessionId: mocks.sessionId }));
    const first = render(
      <React.StrictMode>
        <AdminLoginSecuritySummary />
      </React.StrictMode>,
    );
    expect(await screen.findByText("本次登录安全摘要")).toBeVisible();
    expect(window.sessionStorage.getItem("crewqual:security-summary:toast-session-one")).toBe(
      "shown",
    );
    first.unmount();
    mocks.summary.mockClear();
    const second = render(<AdminLoginSecuritySummary />);
    expect(screen.queryByText("本次登录安全摘要")).not.toBeInTheDocument();
    expect(mocks.summary).not.toHaveBeenCalled();
    mocks.sessionId = "toast-session-two";
    second.rerender(<AdminLoginSecuritySummary />);
    expect(await screen.findByText("本次登录安全摘要")).toBeVisible();
    expect(mocks.summary).toHaveBeenCalledTimes(1);
  });

  it("shows an incomplete toast when the request fails, never a zero-risk conclusion", async () => {
    mocks.sessionId = "toast-session-failed";
    mocks.summary.mockRejectedValue(new Error("unavailable"));
    render(<AdminLoginSecuritySummary />);
    expect(
      await screen.findByText("安全统计暂不完整，当前不能判断是否存在疑似风险。"),
    ).toBeVisible();
    expect(screen.queryByText(/自上次登录以来未检测到/)).not.toBeInTheDocument();
  });
});
