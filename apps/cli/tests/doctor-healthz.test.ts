import assert from "node:assert/strict";
import test from "node:test";
import {
  checkApiHealth,
  checkSubmissionPublicKey,
} from "../src/commands/doctor.js";

test("doctor falls back to /api/healthz when the web origin does not expose /healthz", async () => {
  const calls: string[] = [];

  const detail = await checkApiHealth(
    "https://agora-market.vercel.app",
    async (input) => {
      const url = String(input);
      calls.push(url);

      if (url.endsWith("/api/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response("not found", { status: 404 });
    },
  );

  assert.equal(detail, "api/healthz ok via web proxy");
  assert.deepEqual(calls, [
    "https://agora-market.vercel.app/healthz",
    "https://agora-market.vercel.app/api/healthz",
  ]);
});

test("doctor still accepts direct API origins that expose /healthz", async () => {
  const calls: string[] = [];

  const detail = await checkApiHealth("https://api.example", async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/healthz")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response("not found", { status: 404 });
  });

  assert.equal(detail, "healthz ok");
  assert.deepEqual(calls, ["https://api.example/healthz"]);
});

test("doctor validates the submission sealing public key endpoint", async () => {
  const detail = await checkSubmissionPublicKey(
    "https://api.example",
    async () =>
      new Response(
        JSON.stringify({
          data: {
            kid: "submission-seal",
            version: "sealed_submission_v2",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

  assert.equal(detail, "kid=submission-seal, version=sealed_submission_v2");
});
