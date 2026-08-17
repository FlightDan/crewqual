import { beforeEach, describe, expect, it } from "vitest";
import { createInitialAdminState } from "@/mocks/admin-fixtures";
import {
  adminStorageKey,
  createAdminStateStore,
  legacyAdminStorageKey,
} from "@/services/admin-state-store";
import { mockStorageKey } from "@/services/temp-storage";

describe("AdminStateStore v5 persistence", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("persists and restores an explicitly versioned v5 payload", () => {
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
      version: 5,
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
        version: 5,
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
});
