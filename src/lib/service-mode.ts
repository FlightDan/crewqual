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
export function resolveServiceMode(environment: ServiceModeEnvironment = process.env): ServiceMode {
  if (environment.NODE_ENV === "production") return "remote";
  return (environment.SERVICE_MODE ?? environment.NEXT_PUBLIC_SERVICE_MODE) === "remote"
    ? "remote"
    : "mock";
}

export function isRemoteServiceMode(environment: ServiceModeEnvironment = process.env): boolean {
  return resolveServiceMode(environment) === "remote";
}

export function isMockServiceMode(environment: ServiceModeEnvironment = process.env): boolean {
  return resolveServiceMode(environment) === "mock";
}
