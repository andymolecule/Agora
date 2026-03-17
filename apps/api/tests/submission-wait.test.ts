import assert from "node:assert/strict";
import test from "node:test";
import { waitForSubmissionStatusDataWithReader } from "../src/routes/submissions.js";

const basePayload = {
  submission: {
    id: "22222222-2222-4222-8222-222222222222",
    challenge_id: "11111111-1111-4111-8111-111111111111",
    challenge_address: "0x0000000000000000000000000000000000000001",
    on_chain_sub_id: 0,
    solver_address: "0x0000000000000000000000000000000000000002",
    score: null,
    scored: false,
    submitted_at: "2026-03-17T00:00:00.000Z",
    scored_at: null,
    refs: {
      submissionId: "22222222-2222-4222-8222-222222222222",
      challengeId: "11111111-1111-4111-8111-111111111111",
      challengeAddress: "0x0000000000000000000000000000000000000001",
      onChainSubmissionId: 0,
    },
  },
  proofBundle: null,
  job: {
    status: "queued",
    attempts: 1,
    maxAttempts: 3,
    lastError: null,
    nextAttemptAt: null,
    lockedAt: null,
  },
  scoringStatus: "pending" as const,
  terminal: false,
  recommendedPollSeconds: 15,
};

test("wait helper returns immediately for terminal submissions", async () => {
  const data = await waitForSubmissionStatusDataWithReader({
    submissionId: "22222222-2222-4222-8222-222222222222",
    timeoutSeconds: 30,
    readStatus: async () => ({
      ...basePayload,
      submission: {
        ...basePayload.submission,
        score: "100",
        scored: true,
        scored_at: "2026-03-17T00:10:00.000Z",
      },
      proofBundle: { reproducible: true },
      job: {
        ...basePayload.job,
        status: "scored",
      },
      scoringStatus: "complete",
      terminal: true,
      recommendedPollSeconds: 60,
    }),
    sleepImpl: async () => {
      throw new Error("sleep should not be called");
    },
  });

  assert.equal(data.terminal, true);
  assert.equal(data.waitedMs, 0);
  assert.equal(data.timedOut, false);
});

test("wait helper returns when the submission changes before timing out", async () => {
  let reads = 0;
  const data = await waitForSubmissionStatusDataWithReader({
    submissionId: "22222222-2222-4222-8222-222222222222",
    timeoutSeconds: 30,
    readStatus: async () => {
      reads += 1;
      if (reads === 1) {
        return basePayload;
      }
      return {
        ...basePayload,
        job: {
          ...basePayload.job,
          status: "running",
          lockedAt: "2026-03-17T00:01:00.000Z",
        },
      };
    },
    sleepImpl: async () => undefined,
  });

  assert.equal(reads, 2);
  assert.equal(data.job?.status, "running");
  assert.equal(data.timedOut, false);
});
