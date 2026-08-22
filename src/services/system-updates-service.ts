import type { SystemUpdateSnapshot, UpdateJobStatus } from "@/types/system-updates";

type Envelope<T> = { data?: T; error?: { message?: string } };

function csrf() {
  if (typeof document === "undefined") return "";
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("crewqual_admin_session_csrf="));
  return value ? decodeURIComponent(value.slice("crewqual_admin_session_csrf=".length)) : "";
}

async function request<T>(method: "GET" | "POST", body?: unknown) {
  const response = await fetch("/api/admin/system-updates", {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "content-type": "application/json", "x-csrf-token": csrf() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "更新请求失败");
  return payload.data;
}

export const systemUpdatesService = {
  load: () => request<SystemUpdateSnapshot>("GET"),
  check: () => request<SystemUpdateSnapshot>("POST", { action: "check", input: {} }),
  install: (input: {
    version: string;
    confirmation: string;
    currentPassword?: string;
    currentTotpCode?: string;
  }) => request<{ job: UpdateJobStatus }>("POST", { action: "install", input }),
};
