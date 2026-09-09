import { createHmac, timingSafeEqual } from "node:crypto";
import type { SecuritySignalKind } from "@/generated/prisma/client";
import { getServerConfig } from "@/server/config";
import { requestAddress } from "@/server/rate-limit";
import { recordSecuritySignal, type SecuritySignalInput } from "@/server/security-events";
import { classifySecurityRoute } from "@/server/security-route-classifier";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_CLASS_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const METHOD_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

function validIngressTarget(method: string, pathname: string) {
  return (
    METHOD_PATTERN.test(method) &&
    pathname.startsWith("/") &&
    pathname.length <= 2_048 &&
    !pathname.includes("?") &&
    !pathname.includes("#") &&
    !/[\r\n\0]/.test(pathname)
  );
}

function ingressMac(
  rawKey: string,
  routeClass: string,
  method: string,
  pathname: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update("crewqual/public-ingress/v1\0")
    .update(rawKey)
    .update("\0")
    .update(routeClass)
    .update("\0")
    .update(method)
    .update("\0")
    .update(pathname)
    .digest("hex");
}

/** Seal the complete Caddy ingress identity before it is copied into the app request. */
export function sealPublicRequestKey(
  rawKey: string,
  routeClass: string,
  method: string,
  pathname: string,
  secret?: string,
) {
  if (
    !UUID_PATTERN.test(rawKey) ||
    !ROUTE_CLASS_PATTERN.test(routeClass) ||
    !validIngressTarget(method, pathname)
  ) {
    throw new Error("Invalid public ingress context");
  }
  const material = secret ?? getServerConfig().NETWORK_ACCESS_SECRET;
  if (!material) throw new Error("Public ingress key is unavailable");
  return `${rawKey}.${ingressMac(rawKey, routeClass, method, pathname, material)}`;
}

export function verifyPublicRequestKey(
  value: string,
  routeClass: string,
  method: string,
  pathname: string,
  secret?: string,
) {
  const separator = value.lastIndexOf(".");
  if (
    separator < 0 ||
    !ROUTE_CLASS_PATTERN.test(routeClass) ||
    !validIngressTarget(method, pathname)
  )
    return false;
  const rawKey = value.slice(0, separator);
  const provided = value.slice(separator + 1);
  if (!UUID_PATTERN.test(rawKey) || !/^[0-9a-f]{64}$/i.test(provided)) return false;
  const material = secret ?? getServerConfig().NETWORK_ACCESS_SECRET;
  if (!material) return false;
  const expected = ingressMac(rawKey, routeClass, method, pathname, material);
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

export function publicSecurityRequestContext(request: Request) {
  const requestKey = request.headers.get("x-crewqual-request-key")?.trim() ?? "";
  const routeClass = request.headers.get("x-crewqual-route-class")?.trim() ?? "";
  const pathname = new URL(request.url).pathname;
  const expectedClass = classifySecurityRoute(pathname, request.method).routeClass;
  if (
    expectedClass !== routeClass ||
    !verifyPublicRequestKey(requestKey, routeClass, request.method, pathname)
  )
    return null;
  return { requestKey, routeClass, pathname, address: requestAddress(request) };
}

export async function recordPublicSecuritySignal(
  request: Request,
  input: Omit<SecuritySignalInput, "requestKey" | "address" | "routeClass" | "pathname"> & {
    kind: SecuritySignalKind;
  },
) {
  const context = publicSecurityRequestContext(request);
  if (!context) return "ignored" as const;
  return recordSecuritySignal({ ...context, ...input });
}

export function publicApiErrorSignal(request: Request, error: { code: string; status: number }) {
  const kind: SecuritySignalKind | null =
    error.code === "ORIGIN_MISMATCH" || error.code === "CSRF_FAILED"
      ? "CSRF_DENIED"
      : error.status === 401
        ? "AUTH_FAILURE"
        : error.status === 429
          ? "AUTH_RATE_LIMIT"
          : error.status === 403
            ? "AUTHORIZATION_DENIED"
            : error.status === 404
              ? "RESOURCE_NOT_FOUND"
              : null;
  if (!kind) return;
  void recordPublicSecuritySignal(request, { kind, outcome: error.code }).catch(() => undefined);
}
