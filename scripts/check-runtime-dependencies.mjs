import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const runtimePackages = ["runtime/worker/package.json", "runtime/ops/package.json"];
const forbidden = new Set([
  "next",
  "react",
  "react-dom",
  "@radix-ui/react-dialog",
  "@radix-ui/react-tabs",
  "@tanstack/react-query",
  "@playwright/test",
  "vitest",
  "eslint",
  "typescript",
]);

for (const relativePath of runtimePackages) {
  const runtime = JSON.parse(await readFile(resolve(relativePath), "utf8"));
  const dependencies = runtime.dependencies ?? {};
  for (const [name, range] of Object.entries(dependencies)) {
    const rootRange = root.dependencies?.[name] ?? root.devDependencies?.[name];
    if (!rootRange) {
      throw new Error(`${relativePath}: ${name} is not declared by the root package.json`);
    }
    if (rootRange !== range) {
      throw new Error(`${relativePath}: ${name} range ${range} differs from root ${rootRange}`);
    }
    if (forbidden.has(name)) {
      throw new Error(`${relativePath}: forbidden frontend/test dependency ${name}`);
    }
  }
}

console.log("Runtime dependency manifests match package.json and contain no forbidden packages.");
