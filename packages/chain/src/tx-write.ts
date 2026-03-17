import { AGORA_ERROR_CODES, AgoraError, CHAIN_IDS } from "@agora/common";
import { getPublicClient } from "./client.js";

const WRITE_RETRYABLE_ERROR_PATTERNS = [
  /network/i,
  /fetch failed/i,
  /timeout/i,
  /timed out/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /503/,
  /504/,
  /429/,
] as const;

const WRITE_NON_RETRYABLE_ERROR_PATTERNS = [
  /insufficient funds/i,
  /user rejected/i,
  /rejected/i,
  /execution reverted/i,
  /revert/i,
  /invalid nonce/i,
  /nonce too low/i,
  /replacement transaction underpriced/i,
  /already known/i,
  /intrinsic gas too low/i,
] as const;

const DEFAULT_WRITE_MAX_ATTEMPTS = 3;
const DEFAULT_WRITE_RETRY_BASE_MS = 1_000;

export class AmbiguousWriteResultError extends AgoraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      code: AGORA_ERROR_CODES.chainWriteAmbiguous,
      retriable: false,
      nextAction: "Inspect the wallet or block explorer before retrying.",
      details,
    });
    this.name = "AmbiguousWriteResultError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isRetryableWriteError(error: unknown) {
  const message = toErrorMessage(error);
  if (WRITE_NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }
  return WRITE_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function classifyWriteError(error: unknown, label: string) {
  const message = toErrorMessage(error);
  if (/insufficient funds/i.test(message)) {
    return new AgoraError(`${label} failed because the wallet lacks gas.`, {
      code: AGORA_ERROR_CODES.insufficientGas,
      nextAction: "Fund the wallet with native gas and retry.",
      details: { label },
      cause: error,
    });
  }
  if (/user rejected|rejected/i.test(message)) {
    return new AgoraError(`${label} was rejected by the wallet signer.`, {
      code: AGORA_ERROR_CODES.userRejected,
      retriable: false,
      nextAction: "Approve the wallet request or use a signer that can submit automatically.",
      details: { label },
      cause: error,
    });
  }
  if (/execution reverted|revert/i.test(message)) {
    return new AgoraError(`${label} reverted during contract execution.`, {
      code: AGORA_ERROR_CODES.txReverted,
      retriable: false,
      nextAction:
        "Confirm the challenge state, submission limits, and wallet eligibility before retrying.",
      details: { label },
      cause: error,
    });
  }
  return error instanceof Error ? error : new Error(message);
}

export async function sendWriteWithRetry<T extends `0x${string}`>(input: {
  accountAddress: `0x${string}`;
  label: string;
  write: () => Promise<T>;
  maxAttempts?: number;
  publicClient?: Pick<
    ReturnType<typeof getPublicClient>,
    "getTransactionCount"
  >;
}) {
  const publicClient = input.publicClient ?? getPublicClient();
  const maxAttempts = input.maxAttempts ?? DEFAULT_WRITE_MAX_ATTEMPTS;
  let lastRetryableError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const nonceBefore = await publicClient
      .getTransactionCount({
        address: input.accountAddress,
        blockTag: "pending",
      })
      .catch(() => null);

    try {
      return await input.write();
    } catch (error) {
      if (!isRetryableWriteError(error)) {
        throw classifyWriteError(error, input.label);
      }
      lastRetryableError = error;
      if (attempt >= maxAttempts) {
        break;
      }

      const nonceAfter = await publicClient
        .getTransactionCount({
          address: input.accountAddress,
          blockTag: "pending",
        })
        .catch(() => null);
      if (
        nonceBefore !== null &&
        nonceAfter !== null &&
        nonceAfter > nonceBefore
      ) {
        throw new AmbiguousWriteResultError(
          `${input.label} may already have been submitted, but the RPC connection dropped before the transaction hash was returned.`,
          {
            label: input.label,
            accountAddress: input.accountAddress,
          },
        );
      }

      await sleep(DEFAULT_WRITE_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }

  throw new AgoraError(
    `${input.label} failed after ${maxAttempts} attempts.`,
    {
      code: AGORA_ERROR_CODES.chainWriteRetryExhausted,
      retriable: true,
      nextAction: "Inspect the RPC endpoint and retry.",
      cause: lastRetryableError ?? undefined,
      details: {
        label: input.label,
        accountAddress: input.accountAddress,
        maxAttempts,
        lastError:
          lastRetryableError instanceof Error
            ? lastRetryableError.message
            : lastRetryableError
              ? String(lastRetryableError)
              : null,
      },
    },
  );
}

export function getChainTopUpHint(chainId: number | undefined) {
  if (chainId === CHAIN_IDS.baseSepolia) {
    return "https://docs.base.org/tools/network-faucets";
  }
  return null;
}
