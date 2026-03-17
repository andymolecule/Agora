import { AGORA_ERROR_CODES, AgoraError, ensureAgoraError } from "@agora/common";

function coerceStructuredAgoraError(error: unknown) {
  if (error instanceof AgoraError) {
    return error;
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      code?: unknown;
      retriable?: unknown;
      nextAction?: unknown;
      details?: unknown;
      status?: unknown;
    };
    if (
      typeof candidate.message === "string" &&
      typeof candidate.code === "string"
    ) {
      return new AgoraError(candidate.message, {
        code: candidate.code,
        retriable:
          typeof candidate.retriable === "boolean"
            ? candidate.retriable
            : false,
        nextAction:
          typeof candidate.nextAction === "string"
            ? candidate.nextAction
            : undefined,
        details:
          candidate.details && typeof candidate.details === "object"
            ? (candidate.details as Record<string, unknown>)
            : undefined,
        status:
          typeof candidate.status === "number" ? candidate.status : undefined,
        cause: error,
      });
    }
  }

  return ensureAgoraError(error, {
    code: AGORA_ERROR_CODES.cliCommandFailed,
    retriable: false,
    message:
      "CLI command failed. Next step: inspect the command arguments and retry.",
  });
}

function shouldPrintJsonError() {
  const formatFlagIndex = process.argv.findIndex((arg) => arg === "--format");
  if (formatFlagIndex >= 0) {
    return process.argv[formatFlagIndex + 1] === "json";
  }
  return process.argv.some((arg) => arg === "--json");
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    // viem's BaseError extends Error and has shortMessage
    const asAny = error as Error & { shortMessage?: string };
    return asAny.shortMessage ?? error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }

  return "Unknown error";
}

export function handleCommandError(error: unknown) {
  const agoraError = coerceStructuredAgoraError(error);
  if (shouldPrintJsonError()) {
    process.stderr.write(
      `${JSON.stringify(
        {
          error: agoraError.message,
          code: agoraError.code,
          retriable: agoraError.retriable,
          nextAction: agoraError.nextAction,
          details: agoraError.details,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const message = formatError(
    agoraError instanceof AgoraError && agoraError.nextAction
      ? new Error(
          agoraError.message.includes("Next step:")
            ? agoraError.message
            : `${agoraError.message} Next step: ${agoraError.nextAction}`,
        )
      : agoraError,
  );
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
