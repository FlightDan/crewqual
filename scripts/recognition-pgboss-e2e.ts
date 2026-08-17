import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createBoss } from "@/server/jobs";
import { getPrisma } from "@/server/prisma";
import {
  processRecognitionJob,
  type RecognitionJobPayload,
  type RecognitionResult,
} from "@/server/worker-handlers";

const db = getPrisma();
const boss = createBoss();
const runId = randomUUID();
const queue = `crewqual.recognition.integration-${runId}`;
let evidenceImageId: string | null = null;
let handled = 0;
let extractionCalls = 0;
let workerError: unknown;

async function waitForHandled(expected: number) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (workerError) throw workerError;
    if (handled >= expected) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expected} pg-boss recognition jobs; handled=${handled}`);
}

const fakeRecognize = async (objectKey: string): Promise<RecognitionResult> => {
  extractionCalls += 1;
  return {
    available: true,
    provider: "fake-local-vlm",
    objectKey,
    fields: {
      credentialNumber: { value: "FAKE-CREDENTIAL", confidence: 0.99, evidence: "fixture" },
      holderName: { value: "测试飞行员", confidence: 0.99, evidence: "fixture" },
      expiryDate: { value: "2028-08-16", confidence: 0.99, evidence: "fixture" },
      issuingAuthority: { value: "CrewQual E2E", confidence: 0.99, evidence: "fixture" },
    },
  };
};

async function main() {
  try {
    await boss.start();
    await boss.createQueue(queue, { retryLimit: 0, expireInSeconds: 60 });
    const evidence = await db.evidenceImage.create({
      data: {
        objectKey: `integration/${runId}.jpg`,
        mimeType: "image/jpeg",
        width: 32,
        height: 32,
        byteSize: 128,
        sha256: runId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        status: "linked",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    evidenceImageId = evidence.id;
    const task = await db.recognitionTask.create({
      data: {
        evidenceImageId: evidence.id,
        status: "QUEUED",
        retryLimit: 0,
        provider: "fake-local-vlm",
      },
    });
    const payload: RecognitionJobPayload = {
      recognitionId: task.id,
      evidenceImageId: evidence.id,
    };

    await boss.work<RecognitionJobPayload>(queue, async (jobs) => {
      try {
        for (const job of jobs) {
          await processRecognitionJob(db, job.data, fakeRecognize);
          handled += 1;
        }
      } catch (error) {
        workerError = error;
        throw error;
      }
    });

    assert.ok(await boss.send(queue, payload), "first pg-boss job id");
    await waitForHandled(1);
    const completed = await db.recognitionTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(completed.status, "COMPLETED");
    assert.equal((completed.result as { provider?: string } | null)?.provider, "fake-local-vlm");

    assert.ok(await boss.send(queue, payload), "replay pg-boss job id");
    await waitForHandled(2);
    assert.equal(extractionCalls, 1, "completed extraction must be reused on queue replay");

    console.log(
      JSON.stringify({
        event: "recognition_pgboss_e2e_passed",
        handled,
        extractionCalls,
        taskStatus: completed.status,
        provider: "fake-local-vlm",
      }),
    );
  } finally {
    await boss.offWork(queue).catch(() => undefined);
    await boss.deleteAllJobs(queue).catch(() => undefined);
    await boss.deleteQueue(queue).catch(() => undefined);
    await boss.stop().catch(() => undefined);
    if (evidenceImageId) {
      await db.evidenceImage.deleteMany({ where: { id: evidenceImageId } }).catch(() => undefined);
    }
    await db.$disconnect();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ event: "recognition_pgboss_e2e_failed", error: String(error) }));
  process.exitCode = 1;
});
