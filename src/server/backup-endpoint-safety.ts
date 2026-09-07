import type { ServerConfig } from "@/server/config";
import {
  assertSendEndpoint,
  checkExternalEndpoint,
  type ResolvedExternalEndpoint,
} from "@/server/external-endpoint-safety";

export type RemoteBackupTargetType = "SMB" | "FTP" | "WEBDAV" | "S3";

const DEFAULT_PORTS: Record<"SMB" | "FTP", string> = { SMB: "445", FTP: "21" };

function hostTargetUrl(type: "SMB" | "FTP", endpoint: string) {
  const value = endpoint.trim();
  if (!value || value.includes("://") || /[/?#@]/.test(value)) {
    throw new Error(`${type} 备份地址必须是主机名或 host:port`);
  }
  let parsed: URL;
  try {
    parsed = new URL(`https://${value}`);
  } catch {
    throw new Error(`${type} 备份地址无效`);
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/") {
    throw new Error(`${type} 备份地址无效`);
  }
  const hostname = parsed.hostname.includes(":")
    ? `[${parsed.hostname.replace(/^\[|\]$/g, "")}]`
    : parsed.hostname;
  return `https://${hostname}:${parsed.port || DEFAULT_PORTS[type]}`;
}

export function backupTargetPolicyUrl(type: RemoteBackupTargetType, endpoint: string) {
  if (type === "SMB" || type === "FTP") return hostTargetUrl(type, endpoint);
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(`${type} 备份地址无效`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${type} 备份地址必须使用 HTTP(S)`);
  }
  return parsed.toString();
}

function options(config: ServerConfig) {
  return {
    allowedHosts: config.OUTBOUND_ALLOWED_HOSTS,
    allowedCidrs: config.OUTBOUND_ALLOWED_CIDRS,
    // rclone performs its own connection after validation. Requiring an exact,
    // deployment-owned host prevents an application administrator from
    // supplying an attacker-controlled rebinding domain.
    requireHostAllowlist: true,
  } as const;
}

export function checkBackupEndpoint(
  type: RemoteBackupTargetType,
  endpoint: string,
  config: ServerConfig,
) {
  let policyUrl: string;
  try {
    policyUrl = backupTargetPolicyUrl(type, endpoint);
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "远程备份地址无效",
    };
  }
  return checkExternalEndpoint(policyUrl, config.NODE_ENV === "production", options(config));
}

export async function assertBackupEndpointResolved(
  type: RemoteBackupTargetType,
  endpoint: string,
  config: ServerConfig,
): Promise<ResolvedExternalEndpoint> {
  const policyUrl = backupTargetPolicyUrl(type, endpoint);
  return assertSendEndpoint(policyUrl, config.NODE_ENV === "production", options(config));
}
