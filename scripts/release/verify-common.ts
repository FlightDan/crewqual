import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export type GateStatus = "PASS" | "FAIL" | "SKIPPED";

export type GateResult = {
  id: string;
  status: GateStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  detail?: string;
  evidence?: string[];
};

export type ReleaseEvidence = {
  schemaVersion: 1;
  runId: string;
  profile: "rc" | "final";
  tag: string;
  commit: string;
  startedAt: string;
  finishedAt?: string;
  gates: GateResult[];
  artifacts: Array<{ path: string; sha256: string }>;
};

export function runId() {
  return (
    process.env.RELEASE_RUN_ID ??
    `${new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14)}-${randomBytes(4).toString("hex")}`
  );
}

export function artifactDir(id = runId()) {
  return process.env.RELEASE_EVIDENCE_DIR ?? join(process.cwd(), ".artifacts", "release", id);
}

export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

export async function sha256File(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function command(name: string, args: string[], options: { allowFailure?: boolean } = {}) {
  const result = spawnSync(name, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${name} ${args.join(" ")} failed (${result.status ?? "spawn"}): ${output}`);
  }
  return { status: result.status ?? 1, output, error: result.error?.message };
}

export async function writeJson(path: string, value: unknown) {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function gate(
  evidence: ReleaseEvidence,
  id: string,
  action: () => Promise<{ detail?: string; evidence?: string[] }>,
) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    const result = await action();
    const item: GateResult = {
      id,
      status: "PASS",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      ...result,
    };
    evidence.gates.push(item);
    return item;
  } catch (error) {
    const item: GateResult = {
      id,
      status: "FAIL",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
    evidence.gates.push(item);
    return item;
  }
}

export function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (!value?.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    result[key] = inline ?? argv[index + 1] ?? "";
    if (inline === undefined) index += 1;
  }
  return result;
}
