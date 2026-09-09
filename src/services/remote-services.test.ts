import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  remoteDocumentIntelligenceService,
  remoteUpgradePlanService,
} from "@/services/remote-services";

function apiResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
  });
}

describe("remote service query and recognition contracts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("omits unset upgrade-plan filters instead of sending undefined", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(apiResponse({ items: [], total: 0, page: 1, pageSize: 6, totalPages: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await remoteUpgradePlanService.list({
      q: "",
      type: "all",
      status: "all",
      owner: undefined,
      positions: undefined,
      from: undefined,
      to: undefined,
      page: 1,
      pageSize: 6,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/upgrade-plans?type=all&status=all&page=1&pageSize=6",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock.mock.calls[0]![0]).not.toContain("undefined");
  });

  it("reports a disabled recognition service without polling or offering busy recovery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse({ status: "DISABLED" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(remoteDocumentIntelligenceService.recognizeDates("evidence-1")).resolves.toEqual({
      data: { kind: "disabled" },
      source: "remote",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a completed disabled worker result to the disabled state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse({ id: "task-1", status: "QUEUED" }))
      .mockResolvedValueOnce(
        apiResponse({
          id: "task-1",
          status: "COMPLETED",
          result: { available: false, provider: "disabled", summary: "VLM adapter disabled" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(remoteDocumentIntelligenceService.recognizeDates("evidence-1")).resolves.toEqual({
      data: { kind: "disabled" },
      source: "remote",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
