import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSetupOverview: vi.fn(),
  isSetupRequired: vi.fn(),
  isSetupAuthorized: vi.fn(),
  hasSettingsReadAccess: vi.fn(),
}));

vi.mock("@/server/setup", () => ({
  getSetupOverview: mocks.getSetupOverview,
  isSetupRequired: mocks.isSetupRequired,
}));
vi.mock("@/server/setup-request", () => ({ isSetupAuthorized: mocks.isSetupAuthorized }));
vi.mock("@/server/admin-guard", () => ({
  hasSettingsReadAccess: mocks.hasSettingsReadAccess,
}));

import { GET } from "@/app/api/setup/route";
import { resetServerConfigForTests } from "@/server/config";

const overview = {
  required: false,
  mode: "remote",
  environment: {
    database: "ok",
    storage: "ok",
    worker: "ok",
    workerDetail: "online",
    version: "1.0.1",
  },
  templates: [{ id: "secret-template" }],
  defaults: {
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    organizationName: "Private Org",
    backupPath: "/backups/crewqual",
  },
};

function request() {
  return new NextRequest("http://crewqual.test/api/setup", {
    headers: { "x-request-id": "setup-request" },
  });
}

describe("setup overview disclosure boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SERVICE_MODE", "remote");
    vi.stubEnv("SESSION_SECRET", "setup-route-test-session-secret-0123456789abcdef");
    resetServerConfigForTests();
    vi.clearAllMocks();
    mocks.isSetupAuthorized.mockResolvedValue(false);
    mocks.hasSettingsReadAccess.mockResolvedValue(false);
    mocks.getSetupOverview.mockResolvedValue(overview);
  });

  it("does not run the full dependency probe after setup for an anonymous caller", async () => {
    mocks.isSetupRequired.mockResolvedValue(false);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        required: false,
        environment: { database: "unknown", storage: "unknown", version: "" },
        templates: [],
        defaults: { organizationName: "", backupPath: "" },
      },
    });
    expect(mocks.getSetupOverview).not.toHaveBeenCalled();
  });

  it("returns the full overview to an authorized caller", async () => {
    mocks.isSetupRequired.mockResolvedValue(false);
    mocks.isSetupAuthorized.mockResolvedValue(true);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: overview });
    expect(mocks.getSetupOverview).toHaveBeenCalledOnce();
  });

  it("does not fan out to dependency probes while first-time setup is anonymously open", async () => {
    mocks.isSetupRequired.mockResolvedValue(true);
    mocks.getSetupOverview.mockResolvedValue({ ...overview, required: true });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        required: true,
        environment: { database: "unknown", storage: "unknown", version: "" },
        templates: [],
      },
    });
    expect(mocks.getSetupOverview).not.toHaveBeenCalled();
  });

  it("loads the full first-time overview only after setup authorization", async () => {
    mocks.isSetupRequired.mockResolvedValue(true);
    mocks.isSetupAuthorized.mockResolvedValue(true);
    mocks.getSetupOverview.mockResolvedValue({ ...overview, required: true });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { required: true } });
    expect(mocks.getSetupOverview).toHaveBeenCalledOnce();
  });
});
