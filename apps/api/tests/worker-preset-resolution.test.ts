import assert from "node:assert/strict";
import test from "node:test";
import { resolveRunnerPolicyForEvaluationPlan } from "../src/worker.js";

test("uses evaluation plan limits for managed presets", () => {
  const policy = resolveRunnerPolicyForEvaluationPlan({
    backendKind: "preset_interpreter",
    image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
    limits: {
      memory: "2g",
      cpus: "2",
      pids: 64,
      timeoutMs: 600_000,
    },
  });
  assert.equal(policy.source, "evaluation_plan");
  assert.equal(policy.timeoutMs, 600_000);
  assert.deepEqual(policy.limits, { memory: "2g", cpus: "2", pids: 64 });
});

test("docking-style presets use the plan limits directly", () => {
  const policy = resolveRunnerPolicyForEvaluationPlan({
    backendKind: "preset_interpreter",
    image: "ghcr.io/andymolecule/gems-ranking-scorer:v1",
    limits: {
      memory: "4g",
      cpus: "2",
      pids: 64,
      timeoutMs: 1_200_000,
    },
  });
  assert.equal(policy.source, "evaluation_plan");
  assert.equal(policy.timeoutMs, 1_200_000);
  assert.deepEqual(policy.limits, { memory: "4g", cpus: "2", pids: 64 });
});

test("throws when preset-backed plans are missing limits", () => {
  assert.throws(
    () =>
      resolveRunnerPolicyForEvaluationPlan({
        backendKind: "preset_interpreter",
        image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
      }),
    /missing evaluation plan runner limits/,
  );
});

test("throws when expert runtimes use an invalid scorer image", () => {
  assert.throws(
    () =>
      resolveRunnerPolicyForEvaluationPlan({
        backendKind: "oci_image",
        image: "ghcr.io/andymolecule/gems-match-scorer:v1",
      }),
    /Invalid runtime family configuration/,
  );
});

test("custom runners use default runner limits", () => {
  const policy = resolveRunnerPolicyForEvaluationPlan({
    backendKind: "oci_image",
    image: `ghcr.io/acme/custom-scorer@sha256:${"a".repeat(64)}`,
  });
  assert.equal(policy.source, "default");
  assert.equal(policy.limits, undefined);
});
