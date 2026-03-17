import assert from "node:assert/strict";
import test from "node:test";
import type { getPublicClient } from "../client.js";
import { getFactoryContractVersion } from "../factory.js";
import { chainReadLogger } from "../observability.js";

function patchChainReadLogger(level: "warn" | "error", sink: unknown[][]) {
  const logger = chainReadLogger as unknown as Record<
    string,
    (...args: unknown[]) => void
  >;
  const original = logger[level];
  if (!original) {
    throw new Error(`chainReadLogger.${level} is unavailable in tests`);
  }
  logger[level] = (...args: unknown[]) => {
    sink.push(args);
  };
  return () => {
    logger[level] = original;
  };
}

test("factory contractVersion falls back to latest when the pinned block header is unavailable", async () => {
  const warnings: unknown[][] = [];
  const restoreWarn = patchChainReadLogger("warn", warnings);

  try {
    const calls: Array<{ functionName: string; blockNumber?: bigint }> = [];
    const publicClient = {
      async readContract(input: {
        functionName: string;
        blockNumber?: bigint;
      }) {
        calls.push(input);
        if (input.blockNumber !== undefined) {
          throw new Error("header not found");
        }
        return 2n;
      },
    } as unknown as ReturnType<typeof getPublicClient>;

    const version = await getFactoryContractVersion(
      "0x14e9f4d792cf613e5c33bb4deb51d5a0eb09e045",
      38_812_526n,
      publicClient,
    );

    assert.equal(version, 2);
    assert.deepEqual(
      calls.map((call) => ({
        functionName: call.functionName,
        blockNumber: call.blockNumber,
      })),
      [
        { functionName: "contractVersion", blockNumber: 38_812_526n },
        { functionName: "contractVersion", blockNumber: undefined },
      ],
    );
    assert.equal(warnings.length, 1);
  } finally {
    restoreWarn();
  }
});

test("factory contractVersion does not swallow non-transient RPC errors", async () => {
  const errors: unknown[][] = [];
  const restoreError = patchChainReadLogger("error", errors);

  try {
    const publicClient = {
      async readContract() {
        throw new Error("Missing or invalid parameters");
      },
    } as unknown as ReturnType<typeof getPublicClient>;

    await assert.rejects(
      () =>
        getFactoryContractVersion(
          "0x14e9f4d792cf613e5c33bb4deb51d5a0eb09e045",
          38_812_526n,
          publicClient,
        ),
      /Missing or invalid parameters/,
    );
    assert.equal(errors.length, 1);
  } finally {
    restoreError();
  }
});
