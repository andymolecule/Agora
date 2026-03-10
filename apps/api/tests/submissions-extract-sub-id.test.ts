import test from "node:test";
import assert from "node:assert/strict";
import {
  canReadPublicSubmissionVerification,
  getSubmissionReadRetryMessage,
  isInvalidOnChainSubmissionReadError,
} from "../src/routes/submissions.js";
import { CHALLENGE_STATUS } from "@agora/common";

test("public submission verification stays locked while challenge is open", () => {
  assert.equal(
    canReadPublicSubmissionVerification(CHALLENGE_STATUS.open),
    false,
  );
  assert.equal(
    canReadPublicSubmissionVerification(CHALLENGE_STATUS.scoring),
    true,
  );
  assert.equal(
    canReadPublicSubmissionVerification(CHALLENGE_STATUS.disputed),
    true,
  );
  assert.equal(
    canReadPublicSubmissionVerification(CHALLENGE_STATUS.finalized),
    true,
  );
});

test("invalid on-chain submission read errors are detected", () => {
  assert.equal(
    isInvalidOnChainSubmissionReadError(
      new Error('The contract function "getSubmission" reverted. Error: InvalidSubmission()'),
    ),
    true,
  );
  assert.equal(
    isInvalidOnChainSubmissionReadError(new Error("network timeout")),
    false,
  );
});

test("submission read retry message includes actionable retry guidance", () => {
  const message = getSubmissionReadRetryMessage({
    submissionId: 0n,
    challengeAddress: "0x7fb0607d046052f7cc7eb6a3c90e33299dacbd17",
  });

  assert.match(message, /submission #0/i);
  assert.match(message, /retry in a few seconds/i);
});
