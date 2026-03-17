import assert from "node:assert/strict";
import test from "node:test";
import { readChallengeDefinitionMetadataFromChain } from "../challenge-definition.js";
import type { getPublicClient } from "../client.js";
import {
  isTransientPinnedContractReadError,
  readContractStrict,
  readImmutableContractWithLatestFallback,
} from "../contract-read.js";
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

test("challenge definition metadata falls back to latest when the pinned block header is unavailable", async () => {
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

        if (input.functionName === "specCid")
          return "bafybeigdyrzt5p3l7w4x6xqk2f4m7c5j2w2g7r3f2n3l5s6v7y8z9abcd";
        if (input.functionName === "deadline") return 1_700_000_000n;
        if (input.functionName === "contractVersion") return 2n;
        throw new Error(`Unexpected function ${input.functionName}`);
      },
    } as unknown as ReturnType<typeof getPublicClient>;

    const result = await readChallengeDefinitionMetadataFromChain({
      publicClient,
      challengeAddress: "0x217b97e7d1a8b878e1322fd191d88479a1f38c70",
      blockNumber: 38_812_516n,
    });

    assert.deepEqual(result, {
      specCid: "bafybeigdyrzt5p3l7w4x6xqk2f4m7c5j2w2g7r3f2n3l5s6v7y8z9abcd",
      onChainDeadline: 1_700_000_000n,
      contractVersion: 2,
    });
    assert.deepEqual(
      calls.map((call) => ({
        functionName: call.functionName,
        blockNumber: call.blockNumber,
      })),
      [
        { functionName: "specCid", blockNumber: 38_812_516n },
        { functionName: "deadline", blockNumber: 38_812_516n },
        { functionName: "contractVersion", blockNumber: 38_812_516n },
        { functionName: "specCid", blockNumber: undefined },
        { functionName: "deadline", blockNumber: undefined },
        { functionName: "contractVersion", blockNumber: undefined },
      ],
    );
    assert.equal(warnings.length, 3);
  } finally {
    restoreWarn();
  }
});

test("challenge definition metadata falls back to latest when the pinned block returns no data", async () => {
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
          throw new Error(
            'The contract function "specCid" returned no data ("0x"). The address may not be a contract yet.',
          );
        }

        if (input.functionName === "specCid")
          return "bafybeigdyrzt5p3l7w4x6xqk2f4m7c5j2w2g7r3f2n3l5s6v7y8z9abcd";
        if (input.functionName === "deadline") return 1_700_000_000n;
        if (input.functionName === "contractVersion") return 2n;
        throw new Error(`Unexpected function ${input.functionName}`);
      },
    } as unknown as ReturnType<typeof getPublicClient>;

    const result = await readChallengeDefinitionMetadataFromChain({
      publicClient,
      challengeAddress: "0x217b97e7d1a8b878e1322fd191d88479a1f38c70",
      blockNumber: 38_812_516n,
    });

    assert.deepEqual(result, {
      specCid: "bafybeigdyrzt5p3l7w4x6xqk2f4m7c5j2w2g7r3f2n3l5s6v7y8z9abcd",
      onChainDeadline: 1_700_000_000n,
      contractVersion: 2,
    });
    assert.equal(warnings.length, 3);
    assert.deepEqual(
      calls.map((call) => ({
        functionName: call.functionName,
        blockNumber: call.blockNumber,
      })),
      [
        { functionName: "specCid", blockNumber: 38_812_516n },
        { functionName: "deadline", blockNumber: 38_812_516n },
        { functionName: "contractVersion", blockNumber: 38_812_516n },
        { functionName: "specCid", blockNumber: undefined },
        { functionName: "deadline", blockNumber: undefined },
        { functionName: "contractVersion", blockNumber: undefined },
      ],
    );
  } finally {
    restoreWarn();
  }
});

test("challenge definition metadata does not swallow non-block RPC errors", async () => {
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
        readChallengeDefinitionMetadataFromChain({
          publicClient,
          challengeAddress: "0x217b97e7d1a8b878e1322fd191d88479a1f38c70",
          blockNumber: 38_812_516n,
        }),
      /Missing or invalid parameters/,
    );
    assert.equal(errors.length, 3);
  } finally {
    restoreError();
  }
});

test("transient pinned contract read classifier matches code-availability lag errors", () => {
  assert.equal(
    isTransientPinnedContractReadError(
      new Error('The contract function "specCid" returned no data ("0x").'),
    ),
    true,
  );
  assert.equal(
    isTransientPinnedContractReadError(
      new Error("The address is not a contract."),
    ),
    true,
  );
  assert.equal(
    isTransientPinnedContractReadError(
      new Error("Missing or invalid parameters"),
    ),
    false,
  );
});

test("immutable fallback contract reads emit a warning when the pinned block header is unavailable", async () => {
  const warnings: unknown[][] = [];
  const restoreWarn = patchChainReadLogger("warn", warnings);

  try {
    let callCount = 0;
    const publicClient = {
      async readContract(input: { blockNumber?: bigint }) {
        callCount += 1;
        if (input.blockNumber !== undefined) {
          throw new Error("header not found");
        }
        return 2n;
      },
    } as unknown as ReturnType<typeof getPublicClient>;

    const result = await readImmutableContractWithLatestFallback<bigint>({
      publicClient,
      address: "0x217b97e7d1a8b878e1322fd191d88479a1f38c70",
      abi: [] as never,
      functionName: "contractVersion",
      blockNumber: 38_812_516n,
    });

    assert.equal(result, 2n);
    assert.equal(callCount, 2);
    assert.equal(warnings.length, 1);
    assert.equal(
      warnings[0]?.[1],
      "Pinned immutable contract read fell back to latest",
    );
  } finally {
    restoreWarn();
  }
});

test("strict contract reads emit an error log when they fail", async () => {
  const errors: unknown[][] = [];
  const restoreError = patchChainReadLogger("error", errors);

  try {
    const publicClient = {
      async readContract() {
        throw new Error("upstream rpc timeout");
      },
    } as unknown as ReturnType<typeof getPublicClient>;

    await assert.rejects(
      () =>
        readContractStrict<bigint>({
          publicClient,
          address: "0x217b97e7d1a8b878e1322fd191d88479a1f38c70",
          abi: [] as never,
          functionName: "status",
        }),
      /upstream rpc timeout/,
    );

    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.[1], "Contract read failed");
  } finally {
    restoreError();
  }
});

test("strict contract reads retry retryable RPC errors before succeeding", async () => {
  let callCount = 0;
  const publicClient = {
    async readContract() {
      callCount += 1;
      if (callCount < 3) {
        throw new Error(
          "HTTP request failed.\n\nStatus: 429\nURL: https://sepolia.base.org/",
        );
      }
      return 1n;
    },
  } as unknown as ReturnType<typeof getPublicClient>;

  const result = await readContractStrict<bigint>({
    publicClient,
    address: "0x217b97e7d1a8b878e1322fd191d88479a1f38c70",
    abi: [] as never,
    functionName: "status",
  });

  assert.equal(result, 1n);
  assert.equal(callCount, 3);
});
