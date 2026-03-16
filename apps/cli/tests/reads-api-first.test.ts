import assert from "node:assert/strict";
import test from "node:test";
import { buildGetCommand } from "../src/commands/get.js";
import { buildListCommand } from "../src/commands/list.js";
import { buildStatusCommand } from "../src/commands/status.js";

const challengeId = "11111111-1111-4111-8111-111111111111";
const challengeAddress = "0x0000000000000000000000000000000000000001";
const factoryAddress = "0x0000000000000000000000000000000000000002";

function withConsoleCapture(fn: () => Promise<void>) {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalTable = console.table;
  console.log = (...args) => logs.push(args.join(" "));
  console.table = (value) => logs.push(JSON.stringify(value));
  return fn()
    .then(() => logs)
    .finally(() => {
      console.log = originalLog;
      console.table = originalTable;
    });
}

test("list command works with only AGORA_API_URL configured", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env = { AGORA_API_URL: "https://api.example" };
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: challengeId,
            title: "Challenge",
            domain: "longevity",
            reward_amount: 42,
            deadline: "2026-03-20T00:00:00.000Z",
            status: "open",
            contract_address: challengeAddress,
            factory_address: factoryAddress,
            factory_challenge_id: 7,
            submissions_count: 0,
            refs: {
              challengeId,
              challengeAddress,
              factoryAddress,
              factoryChallengeId: 7,
            },
          },
        ],
        meta: { next_cursor: null },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const logs = await withConsoleCapture(async () => {
      await buildListCommand().parseAsync(["--format", "json"], {
        from: "user",
      });
    });
    assert.match(logs.join("\n"), /Challenge/);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});

test("get and status commands rely on AGORA_API_URL only", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env = { AGORA_API_URL: "https://api.example" };
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          challenge: {
            id: challengeId,
            title: "Challenge",
            description: "desc",
            domain: "longevity",
            challenge_type: "prediction",
            reward_amount: 42,
            deadline: "2026-03-20T00:00:00.000Z",
            status: "open",
            spec_cid: "ipfs://spec",
            contract_address: challengeAddress,
            factory_address: factoryAddress,
            factory_challenge_id: 7,
            refs: {
              challengeId,
              challengeAddress,
              factoryAddress,
              factoryChallengeId: 7,
            },
          },
          datasets: {
            train_cid: null,
            train_url: null,
            test_cid: null,
            test_url: null,
            spec_cid: "ipfs://spec",
            spec_url: "https://gateway/spec",
          },
          submissions: [],
          leaderboard: [],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const getLogs = await withConsoleCapture(async () => {
      await buildGetCommand().parseAsync([challengeId, "--format", "json"], {
        from: "user",
      });
    });
    const statusLogs = await withConsoleCapture(async () => {
      await buildStatusCommand().parseAsync([challengeId, "--format", "json"], {
        from: "user",
      });
    });

    assert.match(getLogs.join("\n"), new RegExp(challengeId));
    assert.match(statusLogs.join("\n"), /countdown/);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});
