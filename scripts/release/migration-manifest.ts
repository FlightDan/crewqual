import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function main() {
  const output =
    process.argv[2] ??
    process.env.MIGRATION_CHECKSUM_MANIFEST ??
    ".artifacts/migration-checksums.json";
  const root = join(process.cwd(), "prisma", "migrations");
  const entries = await readdir(root, { withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries
    .filter((item) => item.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name, "migration.sql");
    if (!existsSync(path)) continue;
    files[path.replace(`${process.cwd()}/`, "")] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify({ output, count: Object.keys(files).length }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
