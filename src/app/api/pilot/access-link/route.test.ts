import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn().mockResolvedValue(true),
  findPilot: vi.fn(),
  findToken: vi.fn(),
  transaction: vi.fn(),
  enqueue: vi.fn().mockResolvedValue("job-1"),
  fakeOutbox: vi.fn(),
}));

vi.mock("@/server/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  requestAddress: () => "127.0.0.1",
}));
vi.mock("@/server/crypto", () => ({
  createOpaqueToken: () => "RAW-ONE-TIME-TOKEN",
  encryptSettingSecret: (value: string) => `ciphertext:${value.length}`,
  safeEqualHex: () => true,
  sha256: (value: string) => `hash:${value}`,
}));
vi.mock("@/server/runtime-settings", () => ({
  getRuntimeSecurityPolicy: vi.fn().mockResolvedValue({ pilotAccessLinkTtlMinutes: 15 }),
  getRuntimeIntegration: vi.fn().mockResolvedValue({ retryLimit: 3 }),
}));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ SMS_ADAPTER: "fake", APP_ORIGIN: "http://localhost:3000" }),
}));
vi.mock("@/server/sms-outbox", () => ({
  shouldSendPilotAccessSms: vi.fn().mockResolvedValue(false),
  enqueuePilotAccessSms: mocks.fakeOutbox,
}));
vi.mock("@/server/jobs", () => ({
  QUEUES: { notifications: "crewqual.notifications" },
  enqueueInTransaction: mocks.enqueue,
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    pilot: { findUnique: mocks.findPilot },
    pilotAccessToken: { findFirst: mocks.findToken },
    $transaction: mocks.transaction,
  }),
}));

import { POST } from "@/app/api/pilot/access-link/route";

function request() {
  return new NextRequest("http://localhost:3000/api/pilot/access-link", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ employeeNumber: "CQ-1", mobile: "13800138000" }),
  });
}

describe("pilot access link secure outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPilot.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      employeeNumber: "CQ-1",
      mobile: "13800138000",
      active: true,
      unit: { organization: { defaultLocale: "zh-CN" } },
    });
    mocks.findToken.mockResolvedValue(null);
  });

  it("stores only an encrypted token payload and queues no raw token", async () => {
    const deliveryCreate = vi.fn().mockResolvedValue({ id: "delivery-1" });
    const tx = {
      pilotAccessToken: {
        deleteMany: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "token-1" }),
      },
      auditEvent: { create: vi.fn() },
      notificationDelivery: { create: deliveryCreate },
    };
    mocks.transaction.mockImplementation((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );

    const response = await POST(request());

    expect(response.status).toBe(202);
    const deliveryInput = deliveryCreate.mock.calls[0]![0];
    expect(JSON.stringify(deliveryInput)).not.toContain("RAW-ONE-TIME-TOKEN");
    expect(deliveryInput.data.securePayloadCiphertext).toMatch(/^ciphertext:/);
    expect(JSON.stringify(mocks.enqueue.mock.calls)).not.toContain("RAW-ONE-TIME-TOKEN");
  });

  it("keeps an existing unexpired link valid on repeated requests", async () => {
    mocks.findToken.mockResolvedValue({ id: "existing-token" });
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
