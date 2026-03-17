import { readObservabilityRuntimeConfig } from "@agora/common";
import {
  AGORA_REQUEST_ID_HEADER,
  type AgoraLogBindings,
  type AgoraLogger,
  buildAgoraSentryInitOptions,
  buildErrorLogFields,
  createAgoraLogger,
  resolveRequestId,
} from "@agora/common/server-observability";
import * as Sentry from "@sentry/node";
import type { MiddlewareHandler } from "hono";

const observability = readObservabilityRuntimeConfig();
export const executorLogger = createAgoraLogger({
  service: "executor",
  observability,
});
let sentryInitialized = false;

export interface ExecutorContextEnv {
  Variables: {
    logger: AgoraLogger;
    requestId: string;
  };
}

export function initExecutorObservability() {
  if (!sentryInitialized) {
    const sentry = buildAgoraSentryInitOptions("executor", observability);
    if (sentry.enabled) {
      Sentry.init({
        ...sentry,
        sendDefaultPii: false,
      });
    }
    sentryInitialized = true;
  }
  return executorLogger;
}

export function createExecutorRequestObservabilityMiddleware(): MiddlewareHandler<ExecutorContextEnv> {
  return async (c, next) => {
    const requestId = resolveRequestId(c.req.header(AGORA_REQUEST_ID_HEADER));
    const path = new URL(c.req.url).pathname;
    const logger = executorLogger.child({
      requestId,
      method: c.req.method,
      path,
    });
    const startedAt = Date.now();

    c.set("requestId", requestId);
    c.set("logger", logger);
    c.header(AGORA_REQUEST_ID_HEADER, requestId);

    await next();

    logger.info(
      {
        event: "http.request.completed",
        status: c.res.status,
        durationMs: Date.now() - startedAt,
      },
      "Request completed",
    );
  };
}

export function captureExecutorException(
  error: unknown,
  input: {
    logger?: AgoraLogger;
    requestId?: string;
    method?: string;
    path?: string;
    bindings?: AgoraLogBindings;
  } = {},
) {
  const logger = input.logger ?? executorLogger;
  logger.error(
    buildErrorLogFields(error, {
      event: "executor.error",
      requestId: input.requestId,
      method: input.method,
      path: input.path,
      ...input.bindings,
    }),
    "Unhandled executor error",
  );

  if (!observability.sentryDsn) {
    return;
  }

  const errorObject = error instanceof Error ? error : new Error(String(error));
  Sentry.withScope((scope) => {
    scope.setTag("service", "executor");
    if (input.requestId) {
      scope.setTag("request_id", input.requestId);
    }
    if (input.method) {
      scope.setTag("http.method", input.method);
    }
    if (input.path) {
      scope.setTag("http.path", input.path);
    }
    for (const [key, value] of Object.entries(input.bindings ?? {})) {
      if (value !== undefined) {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureException(errorObject);
  });
}

export { AGORA_REQUEST_ID_HEADER };
