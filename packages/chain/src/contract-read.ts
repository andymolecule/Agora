import type { Abi } from "viem";
import type { getPublicClient } from "./client.js";

const SLOW_CONTRACT_READ_THRESHOLD_MS = 2_000;

export function isTransientPinnedContractReadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /header not found|block not found|unknown block/i.test(message) ||
    /returned no data \("0x"\)|address is not a contract/i.test(message)
  );
}

type ContractReadInput = {
  publicClient: ReturnType<typeof getPublicClient>;
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  blockNumber?: bigint;
};

function buildChainReadMeta(
  input: ContractReadInput,
  durationMs: number,
  extra: Record<string, unknown> = {},
) {
  return {
    address: input.address,
    functionName: input.functionName,
    blockNumber: input.blockNumber?.toString() ?? null,
    argCount: input.args?.length ?? 0,
    durationMs,
    ...extra,
  };
}

function logSlowContractRead(
  input: ContractReadInput,
  durationMs: number,
  extra: Record<string, unknown> = {},
) {
  if (durationMs < SLOW_CONTRACT_READ_THRESHOLD_MS) {
    return;
  }

  console.warn(
    "[chain-read] Slow contract read",
    buildChainReadMeta(input, durationMs, extra),
  );
}

function logContractReadError(
  input: ContractReadInput,
  durationMs: number,
  error: unknown,
  extra: Record<string, unknown> = {},
) {
  console.error(
    "[chain-read] Contract read failed",
    buildChainReadMeta(input, durationMs, {
      transientPinnedReadError: isTransientPinnedContractReadError(error),
      error: error instanceof Error ? error.message : String(error),
      ...extra,
    }),
  );
}

async function executeContractRead<T>(input: ContractReadInput): Promise<T> {
  return input.publicClient.readContract({
    address: input.address,
    abi: input.abi,
    functionName: input.functionName as never,
    ...(input.args ? { args: input.args as never } : {}),
    ...(input.blockNumber !== undefined ? { blockNumber: input.blockNumber } : {}),
  } as never) as Promise<T>;
}

export async function readContractStrict<T>(
  input: ContractReadInput,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await executeContractRead<T>(input);
    logSlowContractRead(input, Date.now() - startedAt);
    return result;
  } catch (error) {
    logContractReadError(input, Date.now() - startedAt, error);
    throw error;
  }
}

export async function readImmutableContractWithLatestFallback<T>(
  input: ContractReadInput,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await executeContractRead<T>(input);
    logSlowContractRead(input, Date.now() - startedAt);
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (
      input.blockNumber === undefined ||
      !isTransientPinnedContractReadError(error)
    ) {
      logContractReadError(input, durationMs, error);
      throw error;
    }

    console.warn(
      "[chain-read] Pinned immutable contract read fell back to latest",
      buildChainReadMeta(input, durationMs, {
        fallbackToLatest: true,
      }),
    );

    const fallbackInput = {
      ...input,
      blockNumber: undefined,
    };
    const fallbackStartedAt = Date.now();
    try {
      const result = await executeContractRead<T>(fallbackInput);
      logSlowContractRead(fallbackInput, Date.now() - fallbackStartedAt, {
        fallbackToLatest: true,
        originalBlockNumber: input.blockNumber?.toString() ?? null,
      });
      return result;
    } catch (fallbackError) {
      logContractReadError(
        fallbackInput,
        Date.now() - fallbackStartedAt,
        fallbackError,
        {
          fallbackToLatest: true,
          originalBlockNumber: input.blockNumber?.toString() ?? null,
        },
      );
      throw fallbackError;
    }
  }
}
