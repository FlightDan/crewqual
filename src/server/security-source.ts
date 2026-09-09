import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getServerConfig } from "@/server/config";

/** All inputs to this module are server-observed, never trusted client headers. */
export function normalizeSecurityAddress(value?: string | null): string | null {
  const input = value?.trim();
  if (!input || input.includes("%") || !isIP(input)) return null;
  if (isIP(input) === 4) return input;
  const normalized = new URL(`http://[${input}]/`).hostname.slice(1, -1);
  // IPv4-mapped IPv6 and IPv4 must identify the same source.
  const mapped = normalized.match(/^::ffff:([\da-f]+):([\da-f]+)$/i);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  }
  return normalized;
}

export function maskSecurityAddress(value: string | null): string {
  if (!value) return "来源不可判定";
  if (isIP(value) === 4) return `${value.split(".").slice(0, 3).join(".")}.*`;
  const [left, right = ""] = value.split("::");
  const prefix = left ? left.split(":") : [];
  const suffix = right ? right.split(":") : [];
  const groups = value.includes("::")
    ? [...prefix, ...Array(8 - prefix.length - suffix.length).fill("0"), ...suffix]
    : prefix;
  return `${groups
    .slice(0, 3)
    .map((part) => parseInt(part, 16).toString(16))
    .join(":")}:*`;
}

export function securityHasher(secret?: string) {
  const material =
    secret ??
    (() => {
      const config = getServerConfig();
      return config.SETTINGS_ENCRYPTION_KEY || config.SESSION_SECRET;
    })();
  if (!material) throw new Error("Security telemetry key is unavailable");
  const root = createHmac("sha256", material).update("crewqual/security-telemetry/v1").digest();
  // A stable, non-secret key identifier changes automatically on root-key rotation.
  const keyVersion = createHash("sha256").update(root).digest().readUInt32BE(0) & 0x7fffffff;
  return {
    keyVersion,
    hash(domain: "source" | "account" | "path" | "dimension" | "request", value: string) {
      const key = createHmac("sha256", root).update(domain).digest();
      return createHmac("sha256", key).update(value).digest("hex");
    },
  };
}

export function securityPathFingerprint(
  pathname: string | null | undefined,
  hash: ReturnType<typeof securityHasher>,
) {
  if (!pathname) return null;
  // Only a path is accepted; credentials in queries/fragments never enter fingerprints.
  const path = pathname.split(/[?#]/, 1)[0].slice(0, 2048);
  return hash.hash("path", path);
}

export function floorSecurityMinute(value: Date) {
  return new Date(Math.floor(value.getTime() / 60_000) * 60_000);
}
