import assert from "node:assert/strict";
import test from "node:test";
import { resolveRunnerPolicyForChallenge } from "../src/worker.js";

test("uses runtime_family to resolve runner limits", () => {
  const policy = resolveRunnerPolicyForChallenge({
    image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
    runtime_family: "tabular_regression",
  });
  assert.equal(policy.source, "runtime_family");
  assert.equal(policy.timeoutMs, 600_000);
  assert.deepEqual(policy.limits, { memory: "2g", cpus: "2", pids: 64 });
});

test("docking runtime family resolves its managed runner limits", () => {
  const policy = resolveRunnerPolicyForChallenge({
    image: "ghcr.io/andymolecule/gems-ranking-scorer:v1",
    runtime_family: "docking",
  });
  assert.equal(policy.source, "runtime_family");
  assert.equal(policy.timeoutMs, 1_200_000);
  assert.deepEqual(policy.limits, { memory: "4g", cpus: "2", pids: 64 });
});

test("throws when runtime_family is unknown", () => {
  assert.throws(
    () =>
      resolveRunnerPolicyForChallenge({
        image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
        runtime_family: "does_not_exist",
      }),
    /Unknown runtime family on challenge/,
  );
});

test("throws when expert runtimes use an invalid scorer image", () => {
  assert.throws(
    () =>
      resolveRunnerPolicyForChallenge({
        image: "ghcr.io/andymolecule/gems-match-scorer:v1",
        runtime_family: "expert_custom",
      }),
    /Invalid runtime family configuration/,
  );
});

test("custom runners use default runner limits", () => {
  const policy = resolveRunnerPolicyForChallenge({
    image: `ghcr.io/acme/custom-scorer@sha256:${"a".repeat(64)}`,
    runtime_family: "expert_custom",
  });
  assert.equal(policy.source, "default");
  assert.equal(policy.limits, undefined);
});
