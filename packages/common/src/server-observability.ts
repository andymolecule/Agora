import { randomUUID } from "node:crypto";
import pino, { type Logger } from "pino";
import {
  type AgoraObservabilityRuntimeConfig,
  readObservabilityRuntimeConfig,
} from "./config.js";

export const AGORA_REQUEST_ID_HEADER = "x-request-id";
export const AGORA_LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOG_LEVELS = new Set<string>(AGORA_LOG_LEVELS);

export type AgoraLogLevel = (typeof AGORA_LOG_LEVELS)[number];
export type AgoraLogger = Logger;
export type AgoraLogBindings = Record<string, unknown>;

export interface AgoraSentryInitOptions {
  dsn?: string;
  enabled: boolean;
  environment: string;
  release: string;
  tracesSampleRate: number;
  initialScope: {
    tags: Record<string, string>;
  };
}

function compactBindings(
  bindings: AgoraLogBindings = {},
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(bindings).filter(([, value]) => value !== undefined),
  );
}

export function parseAgoraLogLevel(value?: string | null): AgoraLogLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized && LOG_LEVELS.has(normalized)) {
    return normalized as AgoraLogLevel;
  }
  return "info";
}

export function createAgoraLogger(input: {
  service: string;
  observability?: AgoraObservabilityRuntimeConfig;
  bindings?: AgoraLogBindings;
}): AgoraLogger {
  const observability = input.observability ?? readObservabilityRuntimeConfig();
  const logger = pino({
    level: parseAgoraLogLevel(observability.logLevel),
    messageKey: "message",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
  });

  return logger.child(
    compactBindings({
      service: input.service,
      env: observability.nodeEnv,
      runtimeVersion: observability.runtimeVersion,
      ...input.bindings,
    }),
  );
}

export function normalizeRequestId(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!REQUEST_ID_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function resolveRequestId(value?: string | null): string {
  return normalizeRequestId(value) ?? randomUUID();
}

export function buildErrorLogFields(
  error: unknown,
  bindings: AgoraLogBindings = {},
) {
  if (error instanceof Error) {
    return compactBindings({
      ...bindings,
      err: error,
      error: error.message,
    });
  }

  return compactBindings({
    ...bindings,
    error: String(error),
  });
}

export function buildAgoraSentryInitOptions(
  service: string,
  observability: AgoraObservabilityRuntimeConfig = readObservabilityRuntimeConfig(),
): AgoraSentryInitOptions {
  return {
    dsn: observability.sentryDsn,
    enabled: Boolean(observability.sentryDsn),
    environment: observability.sentryEnvironment,
    release: observability.runtimeVersion,
    tracesSampleRate: observability.sentryTracesSampleRate,
    initialScope: {
      tags: {
        service,
        runtimeVersion: observability.runtimeVersion,
      },
    },
  };
}
