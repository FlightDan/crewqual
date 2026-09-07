import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

const LOCAL_TEST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const FORBIDDEN_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog"]);
const MAX_EXTERNAL_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_RESOLVE_TIMEOUT_MS = 5_000;

type HostClassification = "loopback" | "private" | "forbidden" | "public";
type ResolvedAddress = { address: string; family: 4 | 6 };

export type ExternalEndpointOptions = {
  allowedHosts?: string;
  allowedCidrs?: string;
  /** Require an exact deployment-owned host entry even for a public address. */
  requireHostAllowlist?: boolean;
  resolver?: (hostname: string) => Promise<ResolvedAddress[]>;
  signal?: AbortSignal;
  resolveTimeoutMs?: number;
};

export type ResolvedExternalEndpoint = {
  url: URL;
  addresses: ResolvedAddress[];
  address: ResolvedAddress;
};

export type ExternalEndpointCheck = { ok: true } | { ok: false; reason: string };

type HostRule = { hostname: string; port: string | null };

const FORBIDDEN_IPS = new BlockList();
FORBIDDEN_IPS.addSubnet("0.0.0.0", 8, "ipv4");
FORBIDDEN_IPS.addSubnet("169.254.0.0", 16, "ipv4");
FORBIDDEN_IPS.addAddress("100.100.100.200", "ipv4");
FORBIDDEN_IPS.addSubnet("224.0.0.0", 4, "ipv4");
FORBIDDEN_IPS.addSubnet("240.0.0.0", 4, "ipv4");
FORBIDDEN_IPS.addAddress("::", "ipv6");
FORBIDDEN_IPS.addSubnet("fe80::", 10, "ipv6");
FORBIDDEN_IPS.addSubnet("ff00::", 8, "ipv6");

const PRIVATE_IPS = new BlockList();
PRIVATE_IPS.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_IPS.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE_IPS.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE_IPS.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_IPS.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_IPS.addSubnet("198.18.0.0", 15, "ipv4");
PRIVATE_IPS.addAddress("::1", "ipv6");
PRIVATE_IPS.addSubnet("fc00::", 7, "ipv6");

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

/** Convert IPv4-mapped IPv6 into dotted IPv4 so v4 policy always applies. */
function ipv4FromMappedV6(host: string): string | null {
  const mapped = /^::ffff:(.+)$/i.exec(host);
  if (!mapped) return null;
  const tail = mapped[1]!;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) {
    return tail.split(".").every((octet) => Number(octet) <= 255) ? tail : null;
  }
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
  if (!hex) return null;
  const value = (Number.parseInt(hex[1]!, 16) << 16) | Number.parseInt(hex[2]!, 16);
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(".");
}

function normalizeAddress(address: string): ResolvedAddress | null {
  const withoutZone = address.replace(/%.+$/, "");
  const mapped = ipv4FromMappedV6(withoutZone);
  const normalized = mapped ?? withoutZone;
  const family = isIP(normalized);
  return family === 4 || family === 6 ? { address: normalized, family } : null;
}

function classifyAddress(address: ResolvedAddress): HostClassification {
  const type = address.family === 4 ? "ipv4" : "ipv6";
  if (FORBIDDEN_IPS.check(address.address, type)) return "forbidden";
  if (PRIVATE_IPS.check(address.address, type)) {
    if (address.address === "::1" || (address.family === 4 && address.address.startsWith("127."))) {
      return "loopback";
    }
    return "private";
  }
  return "public";
}

function classifyLiteralHost(hostname: string): HostClassification | null {
  const host = normalizeHostname(hostname);
  if (FORBIDDEN_HOSTNAMES.has(host)) return "forbidden";
  if (LOOPBACK_HOSTNAMES.has(host)) return "loopback";
  const address = normalizeAddress(host);
  return address ? classifyAddress(address) : null;
}

function splitList(value = "") {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseHostRule(value: string): HostRule {
  if (value.includes("://") || /[/?#@]/.test(value)) {
    throw new Error(`OUTBOUND_ALLOWED_HOSTS contains an invalid entry: ${value}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    throw new Error(`OUTBOUND_ALLOWED_HOSTS contains an invalid entry: ${value}`);
  }
  if (!parsed.hostname || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`OUTBOUND_ALLOWED_HOSTS contains an invalid entry: ${value}`);
  }
  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || hostname.includes("*") || /\s/.test(hostname)) {
    throw new Error(`OUTBOUND_ALLOWED_HOSTS contains an invalid entry: ${value}`);
  }
  const closeBracket = value.startsWith("[") ? value.indexOf("]") : -1;
  const separator = closeBracket >= 0 ? closeBracket + 1 : value.lastIndexOf(":");
  const explicitPort =
    separator >= 0 && value[separator] === ":" ? value.slice(separator + 1) : null;
  if (explicitPort !== null && !/^\d+$/.test(explicitPort)) {
    throw new Error(`OUTBOUND_ALLOWED_HOSTS contains an invalid entry: ${value}`);
  }
  return { hostname, port: explicitPort };
}

function parseHostRules(value = "") {
  return splitList(value).map(parseHostRule);
}

function parseCidrRules(value = "") {
  const blockList = new BlockList();
  for (const entry of splitList(value)) {
    const separator = entry.lastIndexOf("/");
    const address = separator > 0 ? entry.slice(0, separator) : entry;
    const prefixText = separator > 0 ? entry.slice(separator + 1) : "";
    const family = isIP(address);
    const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : 0;
    const prefix = Number(prefixText);
    if (!family || !/^\d+$/.test(prefixText) || prefix < 0 || prefix > maxPrefix) {
      throw new Error(`OUTBOUND_ALLOWED_CIDRS contains an invalid entry: ${entry}`);
    }
    blockList.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
  }
  return blockList;
}

export function assertExternalEndpointAllowlistConfig(allowedHosts = "", allowedCidrs = "") {
  parseHostRules(allowedHosts);
  parseCidrRules(allowedCidrs);
}

function effectivePort(url: URL) {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

function hostIsAllowed(url: URL, options: ExternalEndpointOptions) {
  const hostname = normalizeHostname(url.hostname);
  const port = effectivePort(url);
  return parseHostRules(options.allowedHosts).some(
    (rule) =>
      rule.hostname === hostname &&
      (rule.port === port ||
        (rule.port === null && port === (url.protocol === "https:" ? "443" : "80"))),
  );
}

function addressIsAllowed(address: ResolvedAddress, options: ExternalEndpointOptions) {
  const type = address.family === 4 ? "ipv4" : "ipv6";
  return parseCidrRules(options.allowedCidrs).check(address.address, type);
}

function parseEndpoint(endpoint: string): URL | ExternalEndpointCheck {
  if (!endpoint.trim()) return { ok: true };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: "外部服务地址无效" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "外部服务地址必须使用 http(s) 协议" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "外部服务地址不能内嵌用户凭据" };
  }
  return url;
}

export function isLocalTestEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOCAL_TEST_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

/** Fast save-time validation. DNS results are validated again immediately before use. */
export function checkExternalEndpoint(
  endpoint: string,
  production: boolean,
  options: ExternalEndpointOptions = {},
): ExternalEndpointCheck {
  const parsed = parseEndpoint(endpoint);
  if (!(parsed instanceof URL)) return parsed;
  const classification = classifyLiteralHost(parsed.hostname);
  if (classification === "forbidden") {
    return { ok: false, reason: "外部服务地址不允许指向链路本地、元数据或未指定地址" };
  }
  const hostAllowed = hostIsAllowed(parsed, options);
  if (production && options.requireHostAllowlist && !hostAllowed) {
    return { ok: false, reason: "该外部服务地址未列入部署侧主机白名单" };
  }
  if (
    production &&
    (classification === "loopback" || classification === "private") &&
    !hostAllowed
  ) {
    const address = normalizeAddress(normalizeHostname(parsed.hostname));
    if (!address || !addressIsAllowed(address, options)) {
      return { ok: false, reason: "本机或内网服务地址必须由部署配置显式授权" };
    }
  }
  if (parsed.protocol === "https:") return { ok: true };
  if (!production) return { ok: true };
  if (classification === "public") {
    return { ok: false, reason: "生产环境的公网外部服务地址必须使用 HTTPS" };
  }
  if (hostAllowed) return { ok: true };
  if (classification === "loopback" || classification === "private") return { ok: true };
  return { ok: false, reason: "生产环境的外部服务地址必须使用 HTTPS" };
}

async function defaultResolver(hostname: string): Promise<ResolvedAddress[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.flatMap((result) => {
    const normalized = normalizeAddress(result.address);
    return normalized ? [normalized] : [];
  });
}

async function withAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error("外部服务地址解析已取消");
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error("外部服务地址解析已取消"));
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

export async function resolveExternalEndpoint(
  endpoint: string,
  production: boolean,
  options: ExternalEndpointOptions = {},
): Promise<ResolvedExternalEndpoint> {
  const check = checkExternalEndpoint(endpoint, production, options);
  if (!check.ok) throw new Error(`外部服务地址被拒绝：${check.reason}`);
  const url = new URL(endpoint);
  const literal = normalizeAddress(normalizeHostname(url.hostname));
  const resolveSignal =
    options.signal ?? AbortSignal.timeout(options.resolveTimeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS);
  if (resolveSignal.aborted) {
    throw resolveSignal.reason ?? new Error("外部服务地址解析已取消");
  }
  const rawAddresses = literal
    ? [literal]
    : await withAbortSignal(
        (options.resolver ?? defaultResolver)(normalizeHostname(url.hostname)),
        resolveSignal,
      );
  const addresses = Array.from(
    new Map(
      rawAddresses
        .map((address) => normalizeAddress(address.address))
        .filter((address): address is ResolvedAddress => Boolean(address))
        .map((address) => [`${address.family}:${address.address}`, address]),
    ).values(),
  );
  if (!addresses.length) throw new Error("外部服务地址没有可用的 DNS 解析结果");

  const classifications = new Set(addresses.map(classifyAddress));
  if (classifications.has("forbidden")) {
    throw new Error("外部服务地址解析到了链路本地、元数据或未指定地址");
  }
  if (
    classifications.has("public") &&
    (classifications.has("private") || classifications.has("loopback"))
  ) {
    throw new Error("外部服务地址返回了混合的公网和内网 DNS 结果");
  }
  const hostAllowed = hostIsAllowed(url, options);
  if (production && options.requireHostAllowlist && !hostAllowed) {
    throw new Error("外部服务地址未列入部署侧主机白名单");
  }
  if (production && (classifications.has("private") || classifications.has("loopback"))) {
    const allAddressesAllowed = addresses.every((address) => addressIsAllowed(address, options));
    if (!hostAllowed && !allAddressesAllowed) {
      throw new Error("外部服务地址解析到了未经部署配置授权的本机或内网地址");
    }
  }
  if (production && url.protocol === "http:" && classifications.has("public")) {
    throw new Error("生产环境的公网外部服务地址必须使用 HTTPS");
  }
  return { url, addresses, address: addresses[0]! };
}

export async function assertSendEndpoint(
  endpoint: string,
  production: boolean,
  options: ExternalEndpointOptions = {},
) {
  return resolveExternalEndpoint(endpoint, production, options);
}

export function createPinnedLookup(address: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

/**
 * Minimal fetch-compatible HTTP client for secret-bearing outbound calls.
 * It validates DNS and pins the connection to that exact result, closing the
 * validation/use gap that permits DNS rebinding with ordinary fetch().
 */
export async function fetchExternalEndpoint(
  endpoint: string,
  init: {
    method?: string;
    headers?: HeadersInit;
    body?: string | Uint8Array;
    signal?: AbortSignal;
    maxResponseBytes?: number;
  },
  production: boolean,
  options: ExternalEndpointOptions = {},
): Promise<Response> {
  const resolved = await resolveExternalEndpoint(endpoint, production, {
    ...options,
    signal: init.signal ?? options.signal,
  });
  const headers = new Headers(init.headers);
  if (headers.has("host")) throw new Error("外部请求不能覆盖 Host 头");
  const request = resolved.url.protocol === "https:" ? httpsRequest : httpRequest;
  const maxResponseBytes = init.maxResponseBytes ?? MAX_EXTERNAL_RESPONSE_BYTES;

  return new Promise<Response>((resolve, reject) => {
    const outgoing = request(
      resolved.url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
        lookup: createPinnedLookup(resolved.address),
        signal: init.signal,
        ...(resolved.url.protocol === "https:" && !isIP(normalizeHostname(resolved.url.hostname))
          ? { servername: normalizeHostname(resolved.url.hostname) }
          : {}),
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let received = 0;
        incoming.on("aborted", () => reject(new Error("外部服务响应被提前中断")));
        incoming.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxResponseBytes) {
            incoming.destroy(new Error("外部服务响应超过大小限制"));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("error", reject);
        incoming.on("end", () => {
          const receivedStatus = incoming.statusCode ?? 502;
          const status = receivedStatus >= 200 && receivedStatus <= 599 ? receivedStatus : 502;
          const body = status === 204 || status === 304 ? null : Buffer.concat(chunks);
          resolve(new Response(body, { status, headers: incoming.headers as HeadersInit }));
        });
      },
    );
    outgoing.on("error", reject);
    if (init.body !== undefined) outgoing.write(init.body);
    outgoing.end();
  });
}
