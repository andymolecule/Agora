import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableError } from "../indexer/polling.js";

test("indexer treats missing historical block errors as retryable", () => {
  assert.equal(isRetryableError(new Error("header not found")), true);
  assert.equal(isRetryableError(new Error("unknown block")), true);
  assert.equal(
    isRetryableError(
      new Error('The contract function "specCid" returned no data ("0x").'),
    ),
    true,
  );
  assert.equal(
    isRetryableError(new Error("The address is not a contract.")),
    true,
  );
});

test("indexer does not treat deterministic contract errors as retryable", () => {
  assert.equal(
    isRetryableError(new Error("Unsupported challenge contract version 1")),
    false,
  );
});
