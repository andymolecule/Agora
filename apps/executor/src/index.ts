import { serve } from "@hono/node-server";
import { readExecutorServerRuntimeConfig } from "@agora/common";
import { createApp } from "./app.js";

async function start() {
  const runtime = readExecutorServerRuntimeConfig();
  const app = createApp();

  serve({ fetch: app.fetch, port: runtime.port });

  console.log(
    `Agora executor listening on http://localhost:${runtime.port} (${runtime.nodeEnv})`,
  );
}

start().catch((error) => {
  console.error(
    `Agora executor failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
