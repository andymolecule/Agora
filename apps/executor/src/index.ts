import { readExecutorServerRuntimeConfig } from "@agora/common";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import {
  captureExecutorException,
  executorLogger,
  initExecutorObservability,
} from "./lib/observability.js";

async function start() {
  initExecutorObservability();
  const runtime = readExecutorServerRuntimeConfig();
  const app = createApp();

  serve({ fetch: app.fetch, port: runtime.port });

  executorLogger.info(
    {
      event: "executor.startup",
      port: runtime.port,
      nodeEnv: runtime.nodeEnv,
    },
    "Agora executor listening",
  );
}

start().catch((error) => {
  captureExecutorException(error, {
    logger: executorLogger,
    bindings: { event: "executor.startup.failed" },
  });
  process.exit(1);
});
