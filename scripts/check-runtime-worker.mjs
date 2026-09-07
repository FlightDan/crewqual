import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const runtimeModules = resolve("runtime/node_modules");
const sandbox = await mkdtemp(join(tmpdir(), "crewqual-runtime-worker-"));

try {
  await cp(resolve("src"), join(sandbox, "src"), { recursive: true });
  await cp(resolve("tsconfig.json"), join(sandbox, "tsconfig.json"));
  await writeFile(
    join(sandbox, "package.json"),
    await readFile(resolve("runtime/package.json"), "utf8"),
  );
  await symlink(runtimeModules, join(sandbox, "node_modules"), "dir");

  const result = spawnSync(process.execPath, ["--import", "tsx", "src/worker/index.ts"], {
    cwd: sandbox,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...process.env,
      NODE_ENV: "development",
      SERVICE_MODE: "mock",
      NEXT_PUBLIC_SERVICE_MODE: "mock",
      CREWQUAL_TEST_NO_EXTERNAL: "1",
    },
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Runtime Worker failed with status ${String(result.status)}:\n${output}`);
  }
  if (!output.includes('"event":"worker_disabled"')) {
    throw new Error(`Runtime Worker did not reach its entry point:\n${output}`);
  }
  process.stdout.write("Runtime-only Worker startup passed.\n");
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
