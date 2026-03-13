import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKER_RUNTIME_MISMATCH_EXIT_AFTER_CHECKS,
  shouldExitForRuntimeMismatch,
} from "../src/worker.js";

test("worker only exits after sustained runtime mismatch checks", () => {
  assert.equal(shouldExitForRuntimeMismatch(1), false);
  assert.equal(
    shouldExitForRuntimeMismatch(WORKER_RUNTIME_MISMATCH_EXIT_AFTER_CHECKS - 1),
    false,
  );
  assert.equal(
    shouldExitForRuntimeMismatch(WORKER_RUNTIME_MISMATCH_EXIT_AFTER_CHECKS),
    true,
  );
});
