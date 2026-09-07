import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clients: [] as Array<{ options: unknown; disconnect: ReturnType<typeof vi.fn> }>,
  config: {
    DATABASE_URL: "postgresql://crewqual:test@postgres/crewqual",
    NODE_ENV: "production",
    SERVICE_MODE: "remote",
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(public readonly options: unknown) {}
  },
}));

vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class {
    readonly $disconnect = vi.fn();

    constructor(public readonly options: unknown) {
      mocks.clients.push({ options, disconnect: this.$disconnect });
    }
  },
}));

vi.mock("@/server/config", () => ({
  getServerConfig: () => mocks.config,
}));

import { disconnectPrisma, getPrisma } from "@/server/prisma";

describe("Prisma process singleton", () => {
  beforeEach(async () => {
    await disconnectPrisma();
    mocks.clients.length = 0;
  });

  it("reuses one client and pool in production", async () => {
    const first = getPrisma();
    const second = getPrisma();

    expect(second).toBe(first);
    expect(mocks.clients).toHaveLength(1);

    await disconnectPrisma();
    expect(mocks.clients[0]!.disconnect).toHaveBeenCalledOnce();

    expect(getPrisma()).not.toBe(first);
    expect(mocks.clients).toHaveLength(2);
  });
});
