export type ServiceMode = "mock" | "remote";

type ServiceModeEnvironment = {
  NODE_ENV?: string;
  SERVICE_MODE?: string;
  NEXT_PUBLIC_SERVICE_MODE?: string;
};

/**
 * Mock is the safe non-production default. Remote must be explicit so an
 * accidentally exposed development server cannot silently reach real APIs.
 */
function runtimeServiceModeEnvironment(): ServiceModeEnvironment {
  return {
    // These must remain direct property reads. Next replaces public variables
    // in browser bundles only when their names are statically visible.
    NODE_ENV: process.env.NODE_ENV,
    SERVICE_MODE: typeof window === "undefined" ? process.env.SERVICE_MODE : undefined,
    NEXT_PUBLIC_SERVICE_MODE: process.env.NEXT_PUBLIC_SERVICE_MODE,
  };
}

export function resolveServiceMode(environment?: ServiceModeEnvironment): ServiceMode {
  const resolved = environment ?? runtimeServiceModeEnvironment();
  if (resolved.NODE_ENV === "production") return "remote";
  return (resolved.SERVICE_MODE ?? resolved.NEXT_PUBLIC_SERVICE_MODE) === "remote"
    ? "remote"
    : "mock";
}

export function isRemoteServiceMode(environment?: ServiceModeEnvironment): boolean {
  return resolveServiceMode(environment) === "remote";
}

export function isMockServiceMode(environment?: ServiceModeEnvironment): boolean {
  return resolveServiceMode(environment) === "mock";
}
