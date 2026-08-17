import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

describe("application service composition boundary", () => {
  it("keeps route and business component code independent from concrete Mock adapters", () => {
    const files = [
      ...sourceFiles(join(process.cwd(), "src/app")),
      ...sourceFiles(join(process.cwd(), "src/components/pilot")),
      ...sourceFiles(join(process.cwd(), "src/components/admin")),
    ];
    const offenders = files.filter((file) =>
      /@\/services\/mock-[^"']+/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
