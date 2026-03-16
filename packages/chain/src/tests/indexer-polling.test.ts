import assert from "node:assert/strict";
import test from "node:test";
import { chunkedGetLogs, isRetryableError } from "../indexer/polling.js";

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

test("indexer retries retryable getLogs calls before succeeding", async () => {
  let callCount = 0;
  const publicClient = {
    async getLogs() {
      callCount += 1;
      if (callCount < 3) {
        throw new Error(
          "HTTP request failed.\n\nStatus: 429\nURL: https://sepolia.base.org/",
        );
      }
      return [];
    },
  } as never;

  const logs = await chunkedGetLogs(
    publicClient,
    "0x217b97e7d1a8b878e1322fd191d88479a1f38c70",
    1n,
    2n,
  );

  assert.deepEqual(logs, []);
  assert.equal(callCount, 3);
});
