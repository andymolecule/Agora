import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("executor healthz returns backend metadata", async () => {
  const app = createApp({
    backend: "local_docker",
    authToken: undefined,
    ensureReady: async () => undefined,
    preflightImages: async () => 0,
    runScorer: async () => {
      throw new Error("unused");
    },
  });

  const response = await app.request(new Request("http://localhost/healthz"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    service: string;
    backend: string;
  };
  assert.equal(body.ok, true);
  assert.equal(body.service, "executor");
  assert.equal(body.backend, "local_docker");
});

test("executor preflight requires auth when configured", async () => {
  const app = createApp({
    backend: "local_docker",
    authToken: "secret",
    ensureReady: async () => undefined,
    preflightImages: async () => 0,
    runScorer: async () => {
      throw new Error("unused");
    },
  });

  const response = await app.request(
    new Request("http://localhost/preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: [] }),
    }),
  );
  assert.equal(response.status, 401);
});

test("executor execute stages uploaded files and returns scorer output", async () => {
  let stagedFiles: string[] = [];
  const app = createApp({
    backend: "local_docker",
    authToken: undefined,
    ensureReady: async () => undefined,
    preflightImages: async () => 0,
    runScorer: async (input) => {
      const fs = await import("node:fs/promises");
      const entries = await fs.readdir(input.inputDir);
      stagedFiles = entries.sort();
      const outputPath = `${input.inputDir}/../output/score.json`;
      await fs.mkdir(`${input.inputDir}/../output`, { recursive: true });
      await fs.writeFile(
        outputPath,
        JSON.stringify({ ok: true, score: 0.99, details: { rows: 2 } }),
        "utf8",
      );
      return {
        ok: true,
        score: 0.99,
        details: { rows: 2 },
        log: "ran",
        outputPath,
        containerImageDigest: "ghcr.io/example/scorer@sha256:abc",
      };
    },
  });

  const form = new FormData();
  form.set(
    "request",
    JSON.stringify({
      image: "ghcr.io/example/scorer:v1",
      timeoutMs: 1000,
      strictPull: false,
    }),
  );
  form.append(
    "files",
    new Blob(["id,prediction\ns1,1.0\n"]),
    "submission.csv",
  );
  form.append("files", new Blob(["{\"version\":\"v1\"}"]), "agora-runtime.json");

  const response = await app.request(
    new Request("http://localhost/execute", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    score: number;
    log: string;
    scoreJson: string;
  };
  assert.equal(body.ok, true);
  assert.equal(body.score, 0.99);
  assert.equal(body.log, "ran");
  assert.match(body.scoreJson, /0.99/);
  assert.deepEqual(stagedFiles, ["agora-runtime.json", "submission.csv"]);
});
