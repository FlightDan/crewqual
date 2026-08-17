import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(absolute);
    return entry.name === "route.ts" ? [absolute] : [];
  });
}

const apiRoot = path.resolve(process.cwd(), "src/app/api");
const routes = routeFiles(apiRoot).sort();

function relativeRoute(file: string) {
  return path.relative(apiRoot, file).replaceAll(path.sep, "/");
}

function hasMutation(source: string) {
  return /export async function (POST|PATCH|PUT|DELETE)\b/.test(source);
}

describe("production API route contract inventory", () => {
  it("keeps every route wrapped in the structured error envelope", () => {
    expect(routes.length).toBeGreaterThan(30);
    for (const file of routes) {
      const route = relativeRoute(file);
      if (route.startsWith("dev/")) continue;
      const source = readFileSync(file, "utf8");
      expect(source, route).toContain("jsonError");
    }
  });

  it("requires an authenticated administrator on every non-public admin route", () => {
    for (const file of routes.filter((item) => item.includes(`${path.sep}admin${path.sep}`))) {
      const route = relativeRoute(file);
      if (route === "admin/login/route.ts") continue;
      const source = readFileSync(file, "utf8");
      expect(source, route).toMatch(/getAdmin\(|authenticateAdmin\(/);
      if (hasMutation(source)) {
        expect(source, route).toMatch(/assertSameOrigin\(|getAdmin\([^\n]+true/);
      }
    }
  });

  it("requires an authenticated pilot on pilot/evidence/recognition routes except token entry", () => {
    for (const file of routes) {
      const route = relativeRoute(file);
      const isPilotScoped = route.startsWith("pilot/") || route.startsWith("evidence-images/");
      const isRecognitionRoute = route.startsWith("recognitions/");
      if (!isPilotScoped && !isRecognitionRoute) continue;
      if (route === "pilot/access-link/route.ts") continue;
      const source = readFileSync(file, "utf8");
      expect(source, route).toMatch(/authenticatePilot\(|consumePilotAccessToken\(/);
      if (hasMutation(source)) expect(source, route).toContain("assertSameOrigin");
    }
  });

  it("keeps public operational endpoints explicit rather than accidentally unguarded", () => {
    const publicRoutes = new Set(["health/route.ts", "dev/pilot-access/route.ts"]);
    const sourceByRoute = new Map(
      routes.map((file) => [relativeRoute(file), readFileSync(file, "utf8")]),
    );
    for (const route of publicRoutes) expect(sourceByRoute.has(route)).toBe(true);
    expect(sourceByRoute.get("health/route.ts")).toContain("SERVICE_MODE");
    expect(sourceByRoute.get("dev/pilot-access/route.ts")).toContain("assertRemoteMode");
  });
});
