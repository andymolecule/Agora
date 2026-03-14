import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resetConfigCache } from "@agora/common";
import {
  ensureScoringBackendReady,
  executeScorer,
  preflightOfficialScorerImages,
} from "../execution.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function restoreExecutorTestRuntime() {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  resetConfigCache();
}

test("remote executor backend stages files and writes local score output", async () => {
  process.env = {
    ...originalEnv,
    AGORA_SCORER_EXECUTOR_BACKEND: "remote_http",
    AGORA_SCORER_EXECUTOR_URL: "https://executor.example",
    AGORA_SCORER_EXECUTOR_TOKEN: "secret",
  };
  resetConfigCache();

  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "agora-execution-test-"),
  );
  const inputDir = path.join(tempRoot, "input");
  await fs.mkdir(inputDir, { recursive: true });
  await fs.writeFile(path.join(inputDir, "submission.csv"), "id,prediction\n1,1\n");
  await fs.writeFile(
    path.join(inputDir, "agora-runtime.json"),
    JSON.stringify({ version: "v1" }),
    "utf8",
  );

  const seenRequests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    seenRequests.push({
      url,
      authorization:
        init?.headers instanceof Headers
          ? init.headers.get("authorization")
          : init?.headers && "authorization" in init.headers
            ? String((init.headers as Record<string, string>).authorization)
            : null,
    });

    if (url.endsWith("/healthz")) {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "executor",
          backend: "local_docker",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.endsWith("/preflight")) {
      return new Response(
        JSON.stringify({ ok: true, preflightedImages: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.endsWith("/execute")) {
      assert.ok(init?.body instanceof FormData);
      const form = init.body;
      const requestRaw = form.get("request");
      assert.equal(typeof requestRaw, "string");
      assert.match(requestRaw as string, /ghcr\.io\/example\/scorer:v1/);
      const uploaded = form.getAll("files");
      assert.equal(uploaded.length, 2);
      assert.deepEqual(
        uploaded
          .map((value) => (value instanceof File ? value.name : "invalid"))
          .sort(),
        ["agora-runtime.json", "submission.csv"],
      );
      return new Response(
        JSON.stringify({
          ok: true,
          score: 0.91,
          details: { matched_rows: 2 },
          log: "remote ok",
          scoreJson: JSON.stringify({
            ok: true,
            score: 0.91,
            details: { matched_rows: 2 },
          }),
          containerImageDigest: "ghcr.io/example/scorer@sha256:abc",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof globalThis.fetch;

  try {
    await ensureScoringBackendReady();
    const preflighted = await preflightOfficialScorerImages([
      "ghcr.io/example/scorer:v1",
    ]);
    assert.equal(preflighted, 1);

    const result = await executeScorer({
      image: "ghcr.io/example/scorer:v1",
      inputDir,
      strictPull: true,
      timeoutMs: 5_000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.score, 0.91);
    assert.equal(result.log, "remote ok");
    assert.equal(
      result.containerImageDigest,
      "ghcr.io/example/scorer@sha256:abc",
    );
    const localScoreJson = await fs.readFile(result.outputPath, "utf8");
    assert.match(localScoreJson, /0.91/);
    assert.deepEqual(
      seenRequests.map((entry) => entry.url),
      [
        "https://executor.example/healthz",
        "https://executor.example/preflight",
        "https://executor.example/execute",
      ],
    );
    assert.ok(
      seenRequests.every(
        (entry) => entry.authorization === "Bearer secret",
      ),
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    restoreExecutorTestRuntime();
  }
});
