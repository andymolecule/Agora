import assert from "node:assert/strict";
import test from "node:test";
import {
  SubmissionWorkflowError,
  cleanupSubmissionArtifact,
} from "../src/lib/submission-workflow.js";

test("cleanupSubmissionArtifact refuses to delete a live submission intent", async () => {
  const db = {} as never;

  await assert.rejects(
    cleanupSubmissionArtifact({
      intentId: "2d931510-d99f-494a-8c67-87feb05e1594",
      resultCid: "ipfs://bafy-test",
      createSupabaseClientImpl: () => db,
      getSubmissionIntentByIdImpl: async () =>
        ({
          id: "2d931510-d99f-494a-8c67-87feb05e1594",
          challenge_id: "challenge-1",
          solver_address: "0xsolver",
          result_hash: "0xhash",
          result_cid: "ipfs://bafy-test",
          result_format: "plain_v0",
          trace_id: null,
          expires_at: "2026-03-31T00:00:00.000Z",
          created_at: "2026-03-20T00:00:00.000Z",
        }) as never,
      countSubmissionIntentsByResultCidImpl: async () => 1,
      countSubmissionsByResultCidImpl: async () => 0,
      unpinCidImpl: async () => {
        throw new Error("should not unpin");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SubmissionWorkflowError);
      assert.equal(error.code, "SUBMISSION_INTENT_RETENTION_REQUIRED");
      return true;
    },
  );
});

test("cleanupSubmissionArtifact unpins orphaned results when nothing references them", async () => {
  const unpinned: string[] = [];

  const result = await cleanupSubmissionArtifact({
    resultCid: "ipfs://bafy-orphan",
    createSupabaseClientImpl: () => ({} as never),
    getSubmissionIntentByIdImpl: async () => null,
    countSubmissionIntentsByResultCidImpl: async () => 0,
    countSubmissionsByResultCidImpl: async () => 0,
    unpinCidImpl: async (cid) => {
      unpinned.push(cid);
    },
  });

  assert.deepEqual(result, {
    cleanedIntent: false,
    unpinned: true,
  });
  assert.deepEqual(unpinned, ["ipfs://bafy-orphan"]);
});
