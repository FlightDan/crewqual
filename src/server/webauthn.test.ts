import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const credentialFindFirst = vi.fn();
  const challengeFindFirst = vi.fn();
  const challengeUpdateMany = vi.fn();
  const credentialUpdate = vi.fn();
  const tx = {
    webAuthnChallenge: { updateMany: challengeUpdateMany },
    fidoCredential: { update: credentialUpdate },
  };
  return {
    credentialFindFirst,
    challengeFindFirst,
    challengeUpdateMany,
    credentialUpdate,
    db: {
      fidoCredential: { findFirst: credentialFindFirst },
      webAuthnChallenge: { findFirst: challengeFindFirst },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    },
    verifyAuthenticationResponse: vi.fn(),
  };
});

vi.mock("@/server/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ APP_ORIGIN: "https://crewqual.test" }),
}));
vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}));

import { verifyAuthentication } from "@/server/webauthn";

describe("WebAuthn authentication challenge binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.credentialFindFirst.mockResolvedValue({
      id: "credential-row",
      credentialId: "credential-id",
      publicKey: Buffer.from("public-key"),
      counter: 0,
      transports: ["usb"],
    });
    mocks.challengeFindFirst.mockResolvedValue({
      id: "challenge-id",
      challenge: "challenge-value",
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1, userVerified: true },
    });
    mocks.challengeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.credentialUpdate.mockResolvedValue({});
  });

  it("binds a step-up challenge to its session without querying a credential by session", async () => {
    await verifyAuthentication({
      kind: "ADMIN_AUTHENTICATION",
      ownerId: "admin-id",
      challengeId: "challenge-id",
      sessionId: "session-id",
      response: { id: "credential-id" } as never,
    });

    expect(mocks.credentialFindFirst).toHaveBeenCalledWith({
      where: { credentialId: "credential-id", adminUserId: "admin-id" },
    });
    expect(mocks.challengeFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "challenge-id",
        adminUserId: "admin-id",
        sessionId: "session-id",
        consumedAt: null,
      }),
      orderBy: { createdAt: "desc" },
    });
  });
});
