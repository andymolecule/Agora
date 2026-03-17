import assert from "node:assert/strict";
import test from "node:test";
import { AgoraError } from "@agora/common";
import {
  AmbiguousWriteResultError,
  isRetryableWriteError,
  sendWriteWithRetry,
} from "../tx-write.js";

const accountAddress = "0x0000000000000000000000000000000000000001";

test("sendWriteWithRetry retries transient transport errors", async () => {
  let attempts = 0;
  const txHash = await sendWriteWithRetry({
    accountAddress,
    label: "Submission transaction",
    maxAttempts: 3,
    publicClient: {
      getTransactionCount: async () => 7,
    } as never,
    write: async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("fetch failed");
      }
      return "0x1111111111111111111111111111111111111111111111111111111111111111";
    },
  });

  assert.equal(attempts, 2);
  assert.equal(
    txHash,
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  );
});

test("sendWriteWithRetry stops when the pending nonce moved", async () => {
  let nonceReads = 0;
  await assert.rejects(
    () =>
      sendWriteWithRetry({
        accountAddress,
        label: "Submission transaction",
        maxAttempts: 3,
        publicClient: {
          getTransactionCount: async () => {
            nonceReads += 1;
            return nonceReads === 1 ? 3 : 4;
          },
        } as never,
        write: async () => {
          throw new Error("network timeout");
        },
      }),
    AmbiguousWriteResultError,
  );
});

test("sendWriteWithRetry returns a machine-readable retry exhaustion error", async () => {
  await assert.rejects(
    () =>
      sendWriteWithRetry({
        accountAddress,
        label: "Submission transaction",
        maxAttempts: 2,
        publicClient: {
          getTransactionCount: async () => 3,
        } as never,
        write: async () => {
          throw new Error("fetch failed");
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "CHAIN_WRITE_RETRY_EXHAUSTED");
      assert.equal(error.retriable, true);
      assert.equal(error.details?.lastError, "fetch failed");
      return true;
    },
  );
});

test("retryable write detection excludes deterministic reverts", () => {
  assert.equal(isRetryableWriteError(new Error("fetch failed")), true);
  assert.equal(
    isRetryableWriteError(new Error("execution reverted: ChallengeClosed")),
    false,
  );
  assert.equal(
    isRetryableWriteError(
      new Error("insufficient funds for gas * price + value"),
    ),
    false,
  );
});
