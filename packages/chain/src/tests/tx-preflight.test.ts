import assert from "node:assert/strict";
import test from "node:test";
import { AgoraError } from "@agora/common";
import {
  assertFinalizeChallengeAffordable,
  assertSubmitChallengeResultAffordable,
} from "../tx-preflight.js";

const accountAddress = "0x0000000000000000000000000000000000000001";
const challengeAddress = "0x0000000000000000000000000000000000000002";

function createMockPublicClient(input: {
  estimatedGas: bigint;
  maxFeePerGas?: bigint;
  gasPrice?: bigint;
  balance: bigint;
  estimateError?: Error;
}) {
  return {
    estimateContractGas: async () => {
      if (input.estimateError) {
        throw input.estimateError;
      }
      return input.estimatedGas;
    },
    estimateFeesPerGas: async () =>
      input.maxFeePerGas
        ? {
            maxFeePerGas: input.maxFeePerGas,
          }
        : {
            gasPrice: input.gasPrice ?? 1n,
          },
    getGasPrice: async () => input.gasPrice ?? 1n,
    getBalance: async () => input.balance,
  } as never;
}

test("submit affordability preflight rejects insufficient gas with a machine code", async () => {
  await assert.rejects(
    () =>
      assertSubmitChallengeResultAffordable({
        accountAddress,
        challengeAddress,
        publicClient: createMockPublicClient({
          estimatedGas: 100_000n,
          maxFeePerGas: 10n,
          balance: 100n,
        }),
        contractVersion: 2,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "INSUFFICIENT_GAS");
      return true;
    },
  );
});

test("finalize affordability preflight succeeds when balance covers buffered gas", async () => {
  const result = await assertFinalizeChallengeAffordable({
    accountAddress,
    challengeAddress,
    publicClient: createMockPublicClient({
      estimatedGas: 100_000n,
      maxFeePerGas: 10n,
      balance: 2_000_000n,
    }),
    contractVersion: 2,
  });

  assert.equal(result.estimatedGas, 100_000n);
  assert.ok(result.requiredBalanceWei > 0n);
});
