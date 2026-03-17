import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("healthz reports API liveness without worker sealing state", async () => {
  const app = createApp();
  const response = await app.request(new Request("http://localhost/healthz"));

  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    ok: boolean;
    service: string;
    runtimeVersion: string;
    checkedAt: string;
    sealing?: unknown;
  };

  assert.equal(body.ok, true);
  assert.equal(body.service, "api");
  assert.equal(typeof body.runtimeVersion, "string");
  assert.equal(typeof body.checkedAt, "string");
  assert.equal("sealing" in body, false);
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
});

test("healthz preserves a caller supplied x-request-id", async () => {
  const app = createApp();
  const response = await app.request(
    new Request("http://localhost/healthz", {
      headers: { "x-request-id": "req-observe-123" },
    }),
  );

  assert.equal(response.headers.get("x-request-id"), "req-observe-123");
});
