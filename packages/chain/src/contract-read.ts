import type { Abi } from "viem";
import type { getPublicClient } from "./client.js";

const SLOW_CONTRACT_READ_THRESHOLD_MS = 2_000;
const CHAIN_RPC_RETRY_MAX_ATTEMPTS = 3;
const CHAIN_RPC_RETRY_BASE_DELAY_MS = 750;

type ChainReadLogFn = (
  bindings: Record<string, unknown>,
  message: string,
) => void;

export interface ChainReadLogger {
  warn: ChainReadLogFn;
  error: ChainReadLogFn;
}

const noopChainReadLog: ChainReadLogFn = () => undefined;

export const chainReadLogger: ChainReadLogger = {
  warn: noopChainReadLog,
  error: noopChainReadLog,
};

export function configureChainReadLogger(logger: ChainReadLogger) {
  chainReadLogger.warn = logger.warn;
  chainReadLogger.error = logger.error;
}

export function isTransientPinnedContractReadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /header not found|block not found|unknown block/i.test(message) ||
    /returned no data \("0x"\)|address is not a contract/i.test(message)
  );
}

export function isRetryableChainRpcError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    isTransientPinnedContractReadError(error) ||
    /\b429\b/.test(message) ||
    /\b408\b/.test(message) ||
    /\b5\d\d\b/.test(message) ||
    /timeout/i.test(message) ||
    /network/i.test(message) ||
    /ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(message)
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  chainReadLogger.warn(
    buildChainReadMeta(input, durationMs, extra),
    "Slow contract read",
  );
}

function logContractReadError(
  input: ContractReadInput,
  durationMs: number,
  error: unknown,
  extra: Record<string, unknown> = {},
) {
  chainReadLogger.error(
    buildChainReadMeta(input, durationMs, {
      transientPinnedReadError: isTransientPinnedContractReadError(error),
      error: error instanceof Error ? error.message : String(error),
      ...extra,
    }),
    "Contract read failed",
  );
}

async function executeContractRead<T>(input: ContractReadInput): Promise<T> {
  return input.publicClient.readContract({
    address: input.address,
    abi: input.abi,
    functionName: input.functionName as never,
    ...(input.args ? { args: input.args as never } : {}),
    ...(input.blockNumber !== undefined
      ? { blockNumber: input.blockNumber }
      : {}),
  } as never) as Promise<T>;
}

export async function withChainRpcRetry<T>(input: {
  action: () => Promise<T>;
  isRetryable?: (error: unknown) => boolean;
  maxAttempts?: number;
  baseDelayMs?: number;
}): Promise<T> {
  const isRetryable = input.isRetryable ?? isRetryableChainRpcError;
  const maxAttempts = input.maxAttempts ?? CHAIN_RPC_RETRY_MAX_ATTEMPTS;
  const baseDelayMs = input.baseDelayMs ?? CHAIN_RPC_RETRY_BASE_DELAY_MS;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await input.action();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Chain RPC retry exhausted without a final error.");
}

export async function readContractStrict<T>(
  input: ContractReadInput,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await withChainRpcRetry({
      action: () => executeContractRead<T>(input),
    });
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
    const result = await withChainRpcRetry({
      action: () => executeContractRead<T>(input),
      isRetryable: (error) =>
        !(
          input.blockNumber !== undefined &&
          isTransientPinnedContractReadError(error)
        ) && isRetryableChainRpcError(error),
    });
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

    chainReadLogger.warn(
      buildChainReadMeta(input, durationMs, {
        fallbackToLatest: true,
      }),
      "Pinned immutable contract read fell back to latest",
    );

    const fallbackInput = {
      ...input,
      blockNumber: undefined,
    };
    const fallbackStartedAt = Date.now();
    try {
      const result = await withChainRpcRetry({
        action: () => executeContractRead<T>(fallbackInput),
      });
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
