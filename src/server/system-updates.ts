import { createHmac, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import packageJson from "../../package.json";
import { ApiError } from "@/server/api";
import type {
  NetworkApplyInput,
  NetworkJobStatus,
  SystemUpdateSnapshot,
  UpdateJobStatus,
} from "@/types/system-updates";

type AgentResponse = {
  updaterVersion?: string;
  mode?: "managed" | "manual";
  currentVersion?: string;
  latestVersion?: string | null;
  releaseNotesUrl?: string | null;
  releasePublishedAt?: string | null;
  canInstall?: boolean;
  reason?: string | null;
  job?: UpdateJobStatus | null;
  networkJob?: NetworkJobStatus | null;
};

const DEFAULT_SOCKET = "/run/crewqual-updater/api.sock";

function socketPath() {
  return process.env.CREWQUAL_UPDATER_SOCKET || DEFAULT_SOCKET;
}

function currentVersion() {
  return process.env.CREWQUAL_VERSION || packageJson.version;
}

function signature(timestamp: string, nonce: string, body: string, secret: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
}

async function agentRequest<T>(path: string, method: "GET" | "POST", input?: unknown) {
  const secret = process.env.CREWQUAL_UPDATER_SHARED_SECRET;
  if (!secret) throw new ApiError("UPDATER_UNAVAILABLE", "宿主机更新器尚未配置", 503);
  try {
    await access(socketPath());
  } catch {
    throw new ApiError("UPDATER_UNAVAILABLE", "当前部署不支持网页一键更新", 503);
  }
  const body = input === undefined ? "" : JSON.stringify(input);
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  return await new Promise<T>((resolve, reject) => {
    const request = httpRequest(
      {
        socketPath: socketPath(),
        path,
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-crewqual-timestamp": timestamp,
          "x-crewqual-nonce": nonce,
          "x-crewqual-signature": signature(timestamp, nonce, body, secret),
        },
        timeout: 5_000,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (raw += chunk));
        response.on("end", () => {
          let parsed: { data?: T; error?: { message?: string } } = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            reject(new ApiError("UPDATER_PROTOCOL_ERROR", "更新器返回了无效响应", 502));
            return;
          }
          if ((response.statusCode ?? 500) >= 400 || !parsed.data) {
            reject(
              new ApiError(
                "UPDATER_REQUEST_FAILED",
                parsed.error?.message ?? "更新器请求失败",
                response.statusCode && response.statusCode >= 500 ? 503 : 422,
              ),
            );
            return;
          }
          resolve(parsed.data);
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("updater timeout")));
    request.on("error", (error) => reject(new ApiError("UPDATER_UNAVAILABLE", error.message, 503)));
    if (body) request.write(body);
    request.end();
  });
}

async function latestRelease() {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const response = await fetch(
      "https://api.github.com/repos/FlightDan/crewqual/releases/latest",
      {
        headers: { accept: "application/vnd.github+json", "user-agent": "crewqual-updater" },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
      prerelease?: boolean;
      draft?: boolean;
    };
    if (!payload.tag_name || payload.prerelease || payload.draft) return null;
    return {
      version: payload.tag_name,
      notesUrl: payload.html_url ?? null,
      publishedAt: payload.published_at ?? null,
    };
  } catch {
    return null;
  }
}

export async function getSystemUpdateSnapshot(refresh = false): Promise<SystemUpdateSnapshot> {
  const localVersion = currentVersion();
  try {
    const status = await agentRequest<AgentResponse>(
      refresh ? "/v1/check" : "/v1/status",
      refresh ? "POST" : "GET",
      refresh ? {} : undefined,
    );
    return {
      mode: status.mode ?? "managed",
      currentVersion: status.currentVersion ?? localVersion,
      latestVersion: status.latestVersion ?? null,
      releaseNotesUrl: status.releaseNotesUrl ?? null,
      releasePublishedAt: status.releasePublishedAt ?? null,
      releaseChannel: status.latestVersion ? "stable" : "unknown",
      canInstall: status.canInstall ?? false,
      reason: status.reason ?? null,
      updaterVersion: status.updaterVersion ?? null,
      agentAvailable: true,
      job: status.job ?? null,
    };
  } catch (error) {
    const release = await latestRelease();
    return {
      mode: "manual",
      currentVersion: localVersion,
      latestVersion: release?.version ?? null,
      releaseNotesUrl: release?.notesUrl ?? null,
      releasePublishedAt: release?.publishedAt ?? null,
      releaseChannel: release ? "stable" : "unknown",
      canInstall: false,
      reason:
        error instanceof ApiError && error.code === "UPDATER_UNAVAILABLE"
          ? "当前部署没有可用的宿主机更新器，请按照部署方式手动更新"
          : "暂时无法连接宿主机更新器",
      updaterVersion: null,
      agentAvailable: false,
      job: null,
    };
  }
}

export async function requestSystemUpdate(input: {
  version: string;
  actorId: string;
  actorName: string;
}) {
  return agentRequest<{ job: UpdateJobStatus }>("/v1/install", "POST", input);
}

export async function requestNetworkApply(input: NetworkApplyInput) {
  return agentRequest<{ networkJob: NetworkJobStatus }>("/v1/network/apply", "POST", input);
}
