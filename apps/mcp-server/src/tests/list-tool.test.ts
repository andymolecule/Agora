import assert from "node:assert/strict";
import test from "node:test";
import { agoraListChallenges } from "../tools/list-challenges.js";

test("list tool preserves pagination metadata for agent callers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Challenge",
            description: "Challenge detail",
            domain: "omics",
            challenge_type: "prediction",
            reward_amount: 100,
            deadline: "2026-03-12T00:00:00.000Z",
            status: "open",
            contract_address: "0x0000000000000000000000000000000000000001",
            factory_address: "0x0000000000000000000000000000000000000002",
            factory_challenge_id: 7,
            refs: {
              challengeId: "11111111-1111-4111-8111-111111111111",
              challengeAddress: "0x0000000000000000000000000000000000000001",
              factoryAddress: "0x0000000000000000000000000000000000000002",
              factoryChallengeId: 7,
            },
          },
        ],
        meta: {
          next_cursor: "2026-03-12T00:00:00.000Z",
          applied_updated_since: "2026-03-11T00:00:00.000Z",
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );

  process.env.AGORA_API_URL = "https://api.agora.test";

  try {
    const response = await agoraListChallenges({
      updatedSince: "2026-03-11T00:00:00.000Z",
    });
    assert.equal(response.meta?.next_cursor, "2026-03-12T00:00:00.000Z");
    assert.equal(response.data.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.AGORA_API_URL = undefined;
  }
});
