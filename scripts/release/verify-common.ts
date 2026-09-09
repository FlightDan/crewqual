import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

// Cosign SBOM attestations can exceed Node's 1 MiB spawnSync output buffer.
// Keep a bounded buffer large enough for signed release metadata.
const COMMAND_MAX_BUFFER = 64 * 1024 * 1024;

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
  acceptanceScope: "local" | "isolated" | "full";
  policyVersion: "2026-09-isolated-v1";
  requiredGates: string[];
  coverageLimitations: string[];
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

export function command(
  name: string,
  args: string[],
  options: { allowFailure?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  const result = spawnSync(name, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: options.env ?? process.env,
    maxBuffer: COMMAND_MAX_BUFFER,
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

export const RELEASE_POLICY_VERSION = "2026-09-isolated-v1" as const;

export function requiredReleaseGates(scope: ReleaseEvidence["acceptanceScope"]) {
  const gates = ["preflight", "bootstrap", "supply-chain"];
  if (scope !== "local") gates.push("isolated-recovery", "e2e");
  if (scope === "full") gates.push("s3-dr");
  return gates;
}

export function assertRequiredGates(evidence: ReleaseEvidence) {
  if (evidence.profile === "final" && evidence.acceptanceScope === "local") {
    throw new Error("Final releases cannot use local acceptance");
  }
  const expected = requiredReleaseGates(evidence.acceptanceScope);
  if (
    evidence.policyVersion !== RELEASE_POLICY_VERSION ||
    JSON.stringify([...evidence.requiredGates].sort()) !== JSON.stringify(expected.sort())
  ) {
    throw new Error("Release evidence acceptance policy mismatch");
  }
  for (const id of expected) {
    const matching = evidence.gates.filter((gate) => gate.id === id);
    if (matching.length !== 1 || matching[0].status !== "PASS") {
      throw new Error(`Required release gate must pass exactly once: ${id}`);
    }
  }
}

export function isPermissionDenial(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const response = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    response.$metadata?.httpStatusCode === 403 &&
    ["AccessDenied", "Forbidden", "AccessDeniedException"].includes(
      response.name ?? response.Code ?? "",
    )
  );
}

/** Accept only an unconditional deny of insecure transport for all S3 operations and resources. */
export function assertTlsOnlyBucketPolicy(raw: string, bucket: string) {
  const policy = JSON.parse(raw) as { Statement?: unknown };
  const statements = Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement];
  const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);
  const resourceSet = [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`];
  const matches = statements.some((value) => {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    const principal = item.Principal;
    const allPrincipals =
      principal === "*" ||
      (principal &&
        typeof principal === "object" &&
        !Array.isArray(principal) &&
        Object.keys(principal).length === 1 &&
        array((principal as Record<string, unknown>).AWS).includes("*"));
    const condition = item.Condition;
    if (
      !condition ||
      typeof condition !== "object" ||
      Array.isArray(condition) ||
      Object.keys(condition).length !== 1
    )
      return false;
    const bool = (condition as Record<string, unknown>).Bool;
    if (!bool || typeof bool !== "object" || Array.isArray(bool) || Object.keys(bool).length !== 1)
      return false;
    const transport = (bool as Record<string, unknown>)["aws:SecureTransport"];
    return (
      item.Effect === "Deny" &&
      allPrincipals &&
      !item.NotAction &&
      !item.NotResource &&
      !item.NotPrincipal &&
      array(item.Action).some((action) => action === "s3:*" || action === "*") &&
      resourceSet.every(
        (resource) => array(item.Resource).includes(resource) || array(item.Resource).includes("*"),
      ) &&
      (transport === false || transport === "false")
    );
  });
  if (!matches) throw new Error(`bucket ${bucket} missing unconditional TLS-only deny policy`);
}

/** Complete cleanup even after a failed gate, keeping both failures reviewable. */
export async function withCleanup<T>(
  action: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let actionFailed = false;
  let actionError: unknown;
  try {
    return await action();
  } catch (error) {
    actionFailed = true;
    actionError = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      if (!actionFailed) throw cleanupError;
      const detail = (error: unknown) => (error instanceof Error ? error.message : String(error));
      throw new AggregateError(
        [actionError, cleanupError],
        `${detail(actionError)}; cleanup failed: ${detail(cleanupError)}`,
      );
    }
  }
}

/** Delete only this disposable Compose project and independently prove its data volumes are gone. */
export function cleanupAcceptanceProject(
  project: string,
  envFile: string,
  env: NodeJS.ProcessEnv,
  run: typeof command = command,
) {
  if (!/^crewqual-(?:e2e|recovery)-[a-z0-9]+$/.test(project)) {
    throw new Error("Refusing cleanup outside a disposable acceptance project");
  }
  const errors: string[] = [];
  const down = run(
    "docker",
    [
      "compose",
      "-f",
      "docker-compose.release.yml",
      "--env-file",
      envFile,
      "-p",
      project,
      "down",
      "-v",
      "--remove-orphans",
    ],
    { allowFailure: true, env },
  );
  if (down.status !== 0)
    errors.push(
      `Compose teardown failed (${down.status}): ${down.output || down.error || "unknown error"}`,
    );
  const filter = `label=com.docker.compose.project=${project}`;
  for (const [resource, args] of [
    ["containers", ["ps", "--all", "--quiet", "--filter", filter]],
    ["volumes", ["volume", "ls", "--quiet", "--filter", filter]],
  ] as const) {
    const remaining = run("docker", [...args], { allowFailure: true, env });
    if (remaining.status !== 0) {
      errors.push(
        `Cannot verify project ${resource} cleanup (${remaining.status}): ${remaining.output || remaining.error || "unknown error"}`,
      );
    } else if (remaining.output.trim()) {
      errors.push(`Project ${resource} remain after teardown: ${remaining.output.trim()}`);
    }
  }
  if (errors.length) throw new Error(errors.join("; "));
}
