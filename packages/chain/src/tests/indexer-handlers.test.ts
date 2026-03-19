import assert from "node:assert/strict";
import test from "node:test";
import { enqueueChallengeFinalizedCallback } from "../indexer/handlers.js";

test("enqueueChallengeFinalizedCallback creates a durable partner callback for finalized challenges", async () => {
  const queued: Array<{
    event: string;
    provider: string;
    callback_url: string;
    payload_json: {
      event: string;
      draft_id: string;
      challenge: {
        challenge_id: string;
        status: string;
        winner_solver_address: string | null;
      };
    };
  }> = [];

  await enqueueChallengeFinalizedCallback({
    db: {} as never,
    challengeId: "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
    contractAddress: "0x2222222222222222222222222222222222222222",
    getPublishedChallengeLinkByChallengeIdImpl: async () =>
      ({
        draft_id: "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
      }) as never,
    getAuthoringDraftViewByIdImpl: async () =>
      ({
        id: "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
        source_callback_url: "https://hooks.beach.science/agora",
        authoring_ir_json: {
          origin: {
            provider: "beach_science",
          },
        },
      }) as never,
    getChallengeByIdImpl: async () =>
      ({
        id: "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
        factory_challenge_id: 7,
        status: "finalized",
        deadline: "2026-03-25T00:00:00.000Z",
        reward_amount: 10,
        tx_hash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        winner_solver_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }) as never,
    createAuthoringCallbackDeliveryImpl: async (_db, payload) => {
      queued.push({
        event: payload.event,
        provider: payload.provider,
        callback_url: payload.callback_url,
        payload_json: payload.payload_json as never,
      });
      return {} as never;
    },
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.event, "challenge_finalized");
  assert.equal(queued[0]?.provider, "beach_science");
  assert.equal(queued[0]?.callback_url, "https://hooks.beach.science/agora");
  assert.equal(
    queued[0]?.payload_json.challenge.challenge_id,
    "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
  );
  assert.equal(queued[0]?.payload_json.challenge.status, "finalized");
  assert.equal(
    queued[0]?.payload_json.challenge.winner_solver_address,
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
});
