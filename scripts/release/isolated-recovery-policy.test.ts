import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTlsOnlyBucketPolicy,
  withCleanup,
  cleanupAcceptanceProject,
  isPermissionDenial,
  assertRequiredGates,
  requiredReleaseGates,
  RELEASE_POLICY_VERSION,
  type ReleaseEvidence,
} from "./verify-common";

test("permission probes fail closed on transport, unsupported APIs and unstructured messages", () => {
  assert.equal(
    isPermissionDenial({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } }),
    true,
  );
  for (const error of [
    new Error("AccessDenied ACL"),
    { name: "NotImplemented", $metadata: { httpStatusCode: 501 } },
    { name: "InvalidRequest", $metadata: { httpStatusCode: 403 } },
    { name: "AccessDenied", $metadata: { httpStatusCode: 500 } },
  ])
    assert.equal(isPermissionDenial(error), false);
});

test("TLS policy requires a deny applying to every principal, S3 action and bucket/object resource", () => {
  const valid = {
    Effect: "Deny",
    Principal: "*",
    Action: "s3:*",
    Resource: ["arn:aws:s3:::example", "arn:aws:s3:::example/*"],
    Condition: { Bool: { "aws:SecureTransport": "false" } },
  };
  const check = (statement: unknown) =>
    assertTlsOnlyBucketPolicy(JSON.stringify({ Statement: [statement] }), "example");
  assert.doesNotThrow(() => check(valid));
  for (const patch of [
    { Effect: "Allow" },
    { Principal: { AWS: "arn:aws:iam::123:root" } },
    { Action: "s3:GetObject" },
    { Resource: ["arn:aws:s3:::example/*"] },
    { Condition: { Bool: { "aws:SecureTransport": "true" } } },
    {
      Condition: {
        Bool: { "aws:SecureTransport": "false" },
        StringEquals: { "s3:prefix": "restricted" },
      },
    },
    { NotAction: "s3:PutObject" },
  ])
    assert.throws(() => check({ ...valid, ...patch }));
});

test("required gate policy rejects omitted, skipped, duplicate or downgraded recovery gates", () => {
  const evidence: ReleaseEvidence = {
    schemaVersion: 1,
    acceptanceScope: "isolated",
    policyVersion: RELEASE_POLICY_VERSION,
    requiredGates: requiredReleaseGates("isolated"),
    coverageLimitations: [],
    runId: "test",
    profile: "final",
    tag: "v1.0.6",
    commit: "a".repeat(40),
    startedAt: "now",
    artifacts: [],
    gates: requiredReleaseGates("isolated").map((id) => ({
      id,
      status: "PASS",
      startedAt: "now",
      finishedAt: "now",
      durationMs: 0,
    })),
  };
  assert.doesNotThrow(() => assertRequiredGates(evidence));
  assert.throws(() =>
    assertRequiredGates({
      ...evidence,
      gates: evidence.gates.filter((gate) => gate.id !== "isolated-recovery"),
    }),
  );
  assert.throws(() =>
    assertRequiredGates({
      ...evidence,
      gates: evidence.gates.map((gate) =>
        gate.id === "isolated-recovery" ? { ...gate, status: "SKIPPED" } : gate,
      ),
    }),
  );
  assert.throws(() =>
    assertRequiredGates({ ...evidence, requiredGates: requiredReleaseGates("local") }),
  );
  assert.throws(() =>
    assertRequiredGates({ ...evidence, gates: [...evidence.gates, evidence.gates[0]] }),
  );
});

test("cleanup failure cannot turn a successful gate into PASS", async () => {
  await assert.rejects(
    withCleanup(
      async () => "passed",
      async () => {
        throw new Error("volume is busy");
      },
    ),
    /volume is busy/,
  );
});

test("failed gate still cleans up and retains its original error alongside a teardown failure", async () => {
  const original = new Error("restore checksum mismatch");
  const cleanup = new Error("volume is busy");
  let calls = 0;
  await assert.rejects(
    withCleanup(
      async () => {
        throw original;
      },
      async () => {
        calls++;
        throw cleanup;
      },
    ),
    (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors, [original, cleanup]);
      assert.match(error.message, /restore checksum mismatch.*volume is busy/);
      return true;
    },
  );
  assert.equal(calls, 1);
  await assert.rejects(
    withCleanup(
      async () => {
        throw original;
      },
      async () => {},
    ),
    (error: unknown) => error === original,
  );
});

test("cleanup independently detects retained containers and volumes, including after a failed down", () => {
  for (const [downStatus, containerIds, volumeNames] of [
    [0, "container-123", ""],
    [0, "", "project_postgres-data"],
    [1, "", ""],
  ] as const) {
    const calls: string[][] = [];
    assert.throws(
      () =>
        cleanupAcceptanceProject(
          "crewqual-recovery-test",
          "/tmp/project.env",
          {},
          (_name, args) => {
            calls.push(args);
            if (args[0] === "compose")
              return {
                status: downStatus,
                output: downStatus ? "teardown failure" : "",
                error: undefined,
              };
            return {
              status: 0,
              output: args[0] === "ps" ? containerIds : volumeNames,
              error: undefined,
            };
          },
        ),
      /teardown failed|remain after teardown/,
    );
    assert.equal(calls.length, 3, "must inspect both resources even after down failed");
    assert(calls[0].includes("-v"));
    assert.deepEqual(
      calls.slice(1).map((args) => args.at(-1)),
      [
        "label=com.docker.compose.project=crewqual-recovery-test",
        "label=com.docker.compose.project=crewqual-recovery-test",
      ],
    );
  }
});

test("cleanup fails closed when resource discovery fails and never deletes unrelated resources", () => {
  assert.throws(
    () =>
      cleanupAcceptanceProject("production", "/tmp/project.env", {}, () => {
        throw new Error("must not run");
      }),
    /Refusing cleanup/,
  );
  assert.throws(
    () =>
      cleanupAcceptanceProject("crewqual-e2e-test", "/tmp/project.env", {}, (_name, args) => ({
        status: args[0] === "volume" ? 1 : 0,
        output: "",
        error: undefined,
      })),
    /Cannot verify project volumes/,
  );
  assert.doesNotThrow(() =>
    cleanupAcceptanceProject("crewqual-e2e-test", "/tmp/project.env", {}, (_name, args) => {
      if (args[0] === "compose") assert.equal(args[args.indexOf("-p") + 1], "crewqual-e2e-test");
      else assert.equal(args.at(-1), "label=com.docker.compose.project=crewqual-e2e-test");
      assert(!args.includes("prune"));
      return { status: 0, output: "", error: undefined };
    }),
  );
});
