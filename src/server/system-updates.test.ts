import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getSystemUpdateSnapshot,
  requestNetworkApply,
  requestSystemUpdate,
} from "@/server/system-updates";

const originalEnv = { ...process.env };

describe("manual system update mode", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      CREWQUAL_VERSION: "v1.2.3",
      CREWQUAL_UPDATER_MODE: "manual",
      CREWQUAL_UPDATER_SHARED_SECRET: "",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a manual snapshot without requiring a host socket", async () => {
    await expect(getSystemUpdateSnapshot()).resolves.toMatchObject({
      mode: "manual",
      currentVersion: "v1.2.3",
      canInstall: false,
      agentAvailable: false,
      updaterVersion: null,
      reason: "当前部署使用手动升级模式，请在宿主机重新运行安装命令",
    });
  });

  it("rejects managed update and network operations", async () => {
    await expect(
      requestSystemUpdate({ version: "v1.2.4", actorId: "admin-1", actorName: "Admin" }),
    ).rejects.toMatchObject({ code: "UPDATER_UNAVAILABLE", status: 503 });

    await expect(
      requestNetworkApply({
        mode: "lan",
        origin: "http://localhost:8080",
        domain: "lan.local",
        tlsEmail: "crewqual-local@lan.invalid",
        port: 8080,
        siteAddress: "http://:8080",
        appBind: "127.0.0.1",
        acmeBind: "127.0.0.1",
        acmePort: 18080,
        actor: "Admin",
      }),
    ).rejects.toMatchObject({ code: "UPDATER_UNAVAILABLE", status: 503 });
  });
});
