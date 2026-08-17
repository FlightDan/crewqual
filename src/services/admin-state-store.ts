import { createInitialAdminState, type AdminMockState } from "@/mocks/admin-fixtures";
import { mockStorageKey } from "@/services/temp-storage";

export const adminStorageKey = "admin-state";
export const legacyAdminStorageKey = "admin-state:v3";

type AdminStatePayload = { version: 5; data: AdminMockState };

function isAdminStateV4(value: unknown): value is AdminMockState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AdminMockState>;
  return (
    Array.isArray(candidate.pilots) &&
    candidate.pilots.every(
      (pilot) =>
        Boolean(pilot) &&
        typeof pilot.id === "string" &&
        Array.isArray(pilot.qualifications) &&
        pilot.qualifications.every(
          (qualification) =>
            Boolean(qualification) &&
            typeof qualification.id === "string" &&
            typeof qualification.expiresOn === "string",
        ),
    ) &&
    Array.isArray(candidate.reviews) &&
    candidate.reviews.every(
      (review) =>
        Boolean(review) &&
        typeof review.id === "string" &&
        Boolean(review.submittedFields) &&
        Array.isArray(review.fieldComparisons) &&
        Array.isArray(review.audit),
    ) &&
    Array.isArray(candidate.upgradePlans) &&
    candidate.upgradePlans.every(
      (plan) =>
        Boolean(plan) &&
        typeof plan.id === "string" &&
        typeof plan.lifecycleStatus === "string" &&
        Array.isArray(plan.stages),
    ) &&
    Array.isArray(candidate.qualificationConfigs) &&
    candidate.qualificationConfigs.every(
      (config) =>
        Boolean(config) &&
        typeof config.id === "string" &&
        typeof config.name === "string" &&
        Boolean(config.validityRule),
    ) &&
    Array.isArray(candidate.notificationLogs) &&
    candidate.notificationLogs.every(
      (log) => Boolean(log) && typeof log.id === "string" && Array.isArray(log.attempts),
    )
  );
}

function readPayload(raw: string | null): AdminMockState | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const payload = parsed as Partial<AdminStatePayload> & { version?: number };
  if (payload.version !== 5 || !isAdminStateV4(payload.data)) return null;
  return payload.data;
}

export interface AdminStateStore {
  getSnapshot(): AdminMockState;
  getServerSnapshot(): AdminMockState;
  update(updater: (state: AdminMockState) => AdminMockState): void;
  subscribe(listener: () => void): () => void;
  reset(): void;
}

export function createAdminStateStore(initialState = createInitialAdminState()): AdminStateStore {
  const serverSnapshot = structuredClone(initialState);
  let state = structuredClone(initialState);
  let hydrated = false;
  const listeners = new Set<() => void>();

  const hydrate = () => {
    if (hydrated || typeof window === "undefined") return;
    hydrated = true;
    try {
      const currentStorageKey = mockStorageKey(adminStorageKey);
      const currentLegacyStorageKey = mockStorageKey(legacyAdminStorageKey);
      const raw = window.sessionStorage.getItem(currentStorageKey);
      const restored = readPayload(raw);
      state = restored ? structuredClone(restored) : structuredClone(initialState);
      if (raw && !restored) window.sessionStorage.removeItem(currentStorageKey);
      if (window.sessionStorage.getItem(currentLegacyStorageKey))
        window.sessionStorage.removeItem(currentLegacyStorageKey);
    } catch {
      state = structuredClone(initialState);
      try {
        window.sessionStorage.removeItem(mockStorageKey(adminStorageKey));
        window.sessionStorage.removeItem(mockStorageKey(legacyAdminStorageKey));
      } catch {
        // The deterministic in-memory reset remains available.
      }
      // Damaged JSON or unavailable storage resets safely to deterministic fixtures.
    }
  };

  const persist = () => {
    if (typeof window === "undefined") return;
    try {
      const payload: AdminStatePayload = { version: 5, data: state };
      window.sessionStorage.setItem(mockStorageKey(adminStorageKey), JSON.stringify(payload));
    } catch {
      // Mutation still succeeds in memory when session storage is unavailable.
    }
  };

  return {
    getSnapshot() {
      hydrate();
      return state;
    },
    getServerSnapshot() {
      return serverSnapshot;
    },
    update(updater) {
      hydrate();
      state = updater(state);
      persist();
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      state = structuredClone(initialState);
      hydrated = true;
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.removeItem(mockStorageKey(adminStorageKey));
          window.sessionStorage.removeItem(mockStorageKey(legacyAdminStorageKey));
        } catch {
          // The in-memory reset is sufficient for the current session.
        }
      }
      listeners.forEach((listener) => listener());
    },
  };
}

export const adminStateStore = createAdminStateStore();
