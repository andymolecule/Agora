import assert from "node:assert/strict";
import test from "node:test";
import { canServeSubmissionSealPublicKey } from "../src/routes/submissions.js";

test("submission public key stays disabled without a ready worker", () => {
  assert.equal(
    canServeSubmissionSealPublicKey({
      hasPublicSealConfig: true,
      hasReadyWorkerForActiveKey: false,
    }),
    false,
  );
});

test("submission public key requires both API config and a ready worker", () => {
  assert.equal(
    canServeSubmissionSealPublicKey({
      hasPublicSealConfig: false,
      hasReadyWorkerForActiveKey: true,
    }),
    false,
  );
  assert.equal(
    canServeSubmissionSealPublicKey({
      hasPublicSealConfig: true,
      hasReadyWorkerForActiveKey: true,
    }),
    true,
  );
});
