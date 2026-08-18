import { beforeEach, describe, expect, it } from "vitest";
import { createInitialAdminState } from "@/mocks/admin-fixtures";
import {
  adminStorageKey,
  createAdminStateStore,
  legacyAdminStorageKey,
} from "@/services/admin-state-store";
import { mockStorageKey } from "@/services/temp-storage";

describe("AdminStateStore v6 persistence", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("persists and restores an explicitly versioned v6 payload", () => {
    const first = createAdminStateStore(createInitialAdminState());
    first.update((state) => ({
      ...state,
      notificationLogs: state.notificationLogs.map((item) =>
        item.id === "NOT-1003" ? { ...item, status: "queued" } : item,
      ),
    }));
    expect(
      JSON.parse(window.sessionStorage.getItem(mockStorageKey(adminStorageKey))!),
    ).toMatchObject({
      version: 6,
      data: { upgradePlans: expect.any(Array), qualificationConfigs: expect.any(Array) },
    });
    const restored = createAdminStateStore(createInitialAdminState());
    expect(
      restored.getSnapshot().notificationLogs.find((item) => item.id === "NOT-1003")?.status,
    ).toBe("queued");
  });

  it("safely resets damaged JSON and legacy v3 state", () => {
    window.sessionStorage.setItem(mockStorageKey(adminStorageKey), "{bad-json");
    const damaged = createAdminStateStore(createInitialAdminState());
    expect(() => damaged.getSnapshot()).not.toThrow();
    expect(damaged.getSnapshot().upgradePlans).toHaveLength(6);
    expect(window.sessionStorage.getItem(mockStorageKey(adminStorageKey))).toBeNull();

    window.sessionStorage.setItem(
      mockStorageKey(adminStorageKey),
      JSON.stringify({
        version: 6,
        data: {
          pilots: [null],
          reviews: [],
          upgradePlans: [],
          qualificationConfigs: [],
          notificationLogs: [],
        },
      }),
    );
    const malformed = createAdminStateStore(createInitialAdminState());
    expect(malformed.getSnapshot().pilots).toHaveLength(5);
    expect(window.sessionStorage.getItem(mockStorageKey(adminStorageKey))).toBeNull();

    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      mockStorageKey(legacyAdminStorageKey),
      JSON.stringify({ pilots: [], reviews: [] }),
    );
    const migrated = createAdminStateStore(createInitialAdminState());
    expect(migrated.getSnapshot().pilots).toHaveLength(5);
    expect(window.sessionStorage.getItem(mockStorageKey(legacyAdminStorageKey))).toBeNull();
  });

  it("migrates v5 qualification configs into the pilot position", () => {
    const legacy = createInitialAdminState();
    const legacyConfigs = legacy.qualificationConfigs.map((config) => {
      const legacyConfig: Partial<typeof config> = { ...config };
      delete legacyConfig.positionCode;
      delete legacyConfig.locked;
      return legacyConfig;
    });
    window.sessionStorage.setItem(
      mockStorageKey(adminStorageKey),
      JSON.stringify({
        version: 5,
        data: { ...legacy, qualificationConfigs: legacyConfigs },
      }),
    );

    const restored = createAdminStateStore(createInitialAdminState()).getSnapshot();
    expect(restored.qualificationConfigs).toHaveLength(6);
    expect(restored.qualificationConfigs.every((item) => item.positionCode === "PILOT")).toBe(true);
    expect(restored.qualificationConfigs.every((item) => item.locked)).toBe(true);
  });
});
