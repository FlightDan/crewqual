import type {
  BackupSettingsSnapshot,
  BackupTargetSetting,
  BackupPlanSetting,
} from "@/types/admin-settings";

type Envelope<T> = { data?: T; error?: { message?: string } };
function csrf() {
  if (typeof document === "undefined") return "";
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("crewqual_admin_session_csrf="));
  return value ? decodeURIComponent(value.slice("crewqual_admin_session_csrf=".length)) : "";
}
async function request<T>(method: string, body?: unknown) {
  const response = await fetch("/api/admin/backups", {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(body ? { "x-csrf-token": csrf() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "备份请求失败");
  return payload.data;
}
export const backupSettingsService = {
  load: () => request<BackupSettingsSnapshot>("GET"),
  createTarget: (input: unknown) =>
    request<BackupTargetSetting>("POST", { action: "target.create", input }),
  createPlan: (input: unknown) =>
    request<BackupPlanSetting>("POST", { action: "plan.create", input }),
  runNow: (planId: string) =>
    request<{ id: string; status: string }>("POST", { action: "run.now", input: { planId } }),
  restore: (runId: string, confirmation: string) =>
    request<{ status: string }>("POST", { action: "restore", input: { runId, confirmation } }),
  testTarget: (targetId: string) =>
    request<{ ok: boolean; message: string }>("POST", {
      action: "target.test",
      input: { targetId },
    }),
};
