import { getPublicClient } from "../client.js";

export const POLL_INTERVAL_MS = 30_000;
const confirmationDepthValue = Number(
  process.env.AGORA_INDEXER_CONFIRMATION_DEPTH ?? 3,
);
export const CONFIRMATION_DEPTH = BigInt(
  Number.isFinite(confirmationDepthValue) && confirmationDepthValue > 0
    ? Math.floor(confirmationDepthValue)
    : 0,
);
const MAX_BLOCK_RANGE = BigInt(9_999);
const RETRYABLE_EVENT_MAX_ATTEMPTS = Number(
  process.env.AGORA_INDEXER_RETRY_MAX_ATTEMPTS ?? 8,
);
const RETRYABLE_EVENT_BASE_DELAY_MS = Number(
  process.env.AGORA_INDEXER_RETRY_BASE_DELAY_MS ?? 30_000,
);
const RETRY_REPLAY_WINDOW_BLOCKS = BigInt(
  Number(process.env.AGORA_INDEXER_REPLAY_WINDOW_BLOCKS ?? 2000),
);

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

type RetryEventState = {
  attempts: number;
  nextAttemptAt: number;
  blockNumber: bigint;
};

const retryEventState = new Map<string, RetryEventState>();

export function retryKey(txHash: string, logIndex: number) {
  return `${txHash}:${logIndex}`;
}

export function onRetryableEvent(key: string, blockNumber: bigint) {
  const now = Date.now();
  const state = retryEventState.get(key) ?? {
    attempts: 0,
    nextAttemptAt: now,
    blockNumber,
  };
  state.blockNumber = blockNumber;

  if (state.nextAttemptAt > now) {
    return {
      shouldRetryNow: false,
      exhausted: false,
      attempts: state.attempts,
      waitMs: state.nextAttemptAt - now,
    };
  }

  state.attempts += 1;
  if (state.attempts >= RETRYABLE_EVENT_MAX_ATTEMPTS) {
    retryEventState.delete(key);
    return {
      shouldRetryNow: true,
      exhausted: true,
      attempts: state.attempts,
      waitMs: 0,
    };
  }

  const delay = RETRYABLE_EVENT_BASE_DELAY_MS * 2 ** (state.attempts - 1);
  state.nextAttemptAt = now + delay;
  retryEventState.set(key, state);
  return {
    shouldRetryNow: true,
    exhausted: false,
    attempts: state.attempts,
    waitMs: delay,
  };
}

export function clearRetryableEvent(key: string) {
  retryEventState.delete(key);
}

export function getDueReplayBlock(now: number): bigint | null {
  let minBlock: bigint | null = null;
  for (const state of retryEventState.values()) {
    if (state.nextAttemptAt > now) continue;
    if (minBlock === null || state.blockNumber < minBlock) {
      minBlock = state.blockNumber;
    }
  }
  return minBlock;
}

export function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b429\b/.test(message) ||
    /\b408\b/.test(message) ||
    /\b5\d\d\b/.test(message) ||
    /timeout/i.test(message) ||
    /network/i.test(message) ||
    /ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(message)
  );
}

export async function chunkedGetLogs(
  publicClient: ReturnType<typeof getPublicClient>,
  address: `0x${string}`,
  from: bigint,
  to: bigint,
) {
  let allLogs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + MAX_BLOCK_RANGE < to ? cursor + MAX_BLOCK_RANGE : to;
    const logs = await publicClient.getLogs({
      address,
      fromBlock: cursor,
      toBlock: end,
    });
    allLogs = allLogs.concat(Array.from(logs));
    cursor = end + BigInt(1);
  }
  return allLogs;
}

export function rewindStartBlock(targetBlock: bigint) {
  return targetBlock > RETRY_REPLAY_WINDOW_BLOCKS
    ? targetBlock - RETRY_REPLAY_WINDOW_BLOCKS
    : BigInt(0);
}
