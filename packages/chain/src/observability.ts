import { readObservabilityRuntimeConfig } from "@agora/common";
import {
  type ChainReadLogger,
  chainReadLogger,
  configureChainReadLogger,
} from "./contract-read.js";

const observability = readObservabilityRuntimeConfig();

type ChainServiceLogFn = (
  bindings: Record<string, unknown>,
  message: string,
) => void;

interface ChainServiceLogger {
  info: ChainServiceLogFn;
  warn: ChainServiceLogFn;
  error: ChainServiceLogFn;
}

const importServerObservability = () =>
  import("@agora/common/server-observability");
const importSentry = () => import("@sentry/node");

type ServerObservabilityModule = Awaited<
  ReturnType<typeof importServerObservability>
>;
type SentryModule = Awaited<ReturnType<typeof importSentry>>;

const noopLog: ChainServiceLogFn = () => undefined;

export const indexerLogger: ChainServiceLogger = {
  info: noopLog,
  warn: noopLog,
  error: noopLog,
};

let serverObservabilityModule: ServerObservabilityModule | null = null;
let sentryModule: SentryModule | null = null;
let sentryInitialized = false;

function configureIndexerLogger(logger: ChainServiceLogger) {
  indexerLogger.info = logger.info;
  indexerLogger.warn = logger.warn;
  indexerLogger.error = logger.error;
}

function fallbackBuildErrorLogFields(
  error: unknown,
  bindings: Record<string, unknown> = {},
) {
  if (error instanceof Error) {
    return {
      ...bindings,
      error: error.message,
    };
  }

  return {
    ...bindings,
    error: String(error),
  };
}

async function loadObservabilityDeps() {
  if (serverObservabilityModule && sentryModule) {
    return {
      serverObservability: serverObservabilityModule,
      sentry: sentryModule,
    };
  }

  const [serverObservability, sentry] = await Promise.all([
    importServerObservability(),
    importSentry(),
  ]);
  serverObservabilityModule = serverObservability;
  sentryModule = sentry;
  return {
    serverObservability,
    sentry,
  };
}

export async function initIndexerObservability() {
  const { serverObservability, sentry } = await loadObservabilityDeps();
  const pinoIndexerLogger = serverObservability.createAgoraLogger({
    service: "indexer",
    observability,
  });
  const pinoChainReadLogger = serverObservability.createAgoraLogger({
    service: "chain-read",
    observability,
  });

  configureIndexerLogger({
    info: pinoIndexerLogger.info.bind(pinoIndexerLogger),
    warn: pinoIndexerLogger.warn.bind(pinoIndexerLogger),
    error: pinoIndexerLogger.error.bind(pinoIndexerLogger),
  });

  configureChainReadLogger({
    warn: pinoChainReadLogger.warn.bind(
      pinoChainReadLogger,
    ) as ChainReadLogger["warn"],
    error: pinoChainReadLogger.error.bind(
      pinoChainReadLogger,
    ) as ChainReadLogger["error"],
  });

  if (!sentryInitialized) {
    const sentryOptions = serverObservability.buildAgoraSentryInitOptions(
      "indexer",
      observability,
    );
    if (sentryOptions.enabled) {
      sentry.init({
        ...sentryOptions,
        sendDefaultPii: false,
      });
    }
    sentryInitialized = true;
  }

  return indexerLogger;
}

export function captureIndexerException(
  error: unknown,
  input: {
    logger?: ChainServiceLogger;
    bindings?: Record<string, unknown>;
  } = {},
) {
  const logger = input.logger ?? indexerLogger;
  const buildErrorLogFields =
    serverObservabilityModule?.buildErrorLogFields ??
    fallbackBuildErrorLogFields;

  logger.error(
    buildErrorLogFields(error, {
      event: "indexer.error",
      ...input.bindings,
    }),
    "Unhandled indexer error",
  );

  if (!observability.sentryDsn || !sentryModule) {
    return;
  }

  const errorObject = error instanceof Error ? error : new Error(String(error));
  sentryModule.withScope((scope) => {
    scope.setTag("service", "indexer");
    for (const [key, value] of Object.entries(input.bindings ?? {})) {
      if (value !== undefined) {
        scope.setExtra(key, value);
      }
    }
    sentryModule?.captureException(errorObject);
  });
}

export { chainReadLogger };
