import assert from "node:assert/strict";
import test from "node:test";
import { createAgentRoutes } from "../src/routes/agents.js";

function allowQuota() {
  return () =>
    (async (_c, next) => {
      await next();
    }) as never;
}

test("agent registration returns the bare registration object", async () => {
  const router = createAgentRoutes({
    registerAgent: async () => ({
      agent_id: "agent-abc",
      api_key: "agora_xxxxxxxx",
      status: "created",
    }),
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        telegram_bot_id: "bot_123456",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    agent_id: "agent-abc",
    api_key: "agora_xxxxxxxx",
    status: "created",
  });
});

test("agent registration returns the session-contract invalid_request envelope on bad input", async () => {
  const router = createAgentRoutes({
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        telegram_bot_id: "",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: "invalid_request",
      message: "Invalid agent registration payload.",
      next_action: "Fix the request body and retry.",
    },
  });
});
