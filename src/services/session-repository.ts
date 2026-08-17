import type {
  PilotProfile,
  QualificationUpdateDraft,
  SubmissionReceipt,
  UpgradePlanDraft,
} from "@/types/services";
import { mockStorageKey } from "@/services/temp-storage";

export interface SessionRepository<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  remove(key: string): void;
}

export function createSessionRepository<T>(namespace: string): SessionRepository<T> {
  const memory = new Map<string, T>();
  const storageKey = (key: string) => mockStorageKey(`${namespace}:${key}`);

  return {
    get(key) {
      if (typeof window === "undefined") return memory.get(key) ?? null;
      try {
        const value = window.sessionStorage.getItem(storageKey(key));
        return value ? (JSON.parse(value) as T) : null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set(key, value) {
      memory.set(key, value);
      if (typeof window === "undefined") return;
      try {
        window.sessionStorage.setItem(storageKey(key), JSON.stringify(value));
      } catch {
        // Private mode or quota failures fall back to the in-memory adapter.
      }
    },
    remove(key) {
      memory.delete(key);
      if (typeof window === "undefined") return;
      try {
        window.sessionStorage.removeItem(storageKey(key));
      } catch {
        // The in-memory value has already been removed.
      }
    },
  };
}

export const pilotProfileRepository = createSessionRepository<PilotProfile>("pilot-profile");
export const qualificationDraftRepository =
  createSessionRepository<QualificationUpdateDraft>("qualification-draft");
export const submissionReceiptRepository =
  createSessionRepository<SubmissionReceipt>("submission-receipt");
export const upgradePlanDraftRepository =
  createSessionRepository<UpgradePlanDraft>("upgrade-plan-draft");
