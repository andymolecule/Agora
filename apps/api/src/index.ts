import {
  getAgoraRuntimeIdentity,
  getAgoraRuntimeVersion,
  loadConfig,
} from "@agora/common";
import {
  WORKER_RUNTIME_TYPE,
  assertRuntimeDatabaseSchema,
  createSupabaseClient,
  upsertActiveWorkerRuntimeVersion,
} from "@agora/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

async function start() {
  const config = loadConfig();
  const port = config.AGORA_API_PORT ?? 3000;
  const db = createSupabaseClient(true);
  await assertRuntimeDatabaseSchema(db);
  await upsertActiveWorkerRuntimeVersion(db, {
    worker_type: WORKER_RUNTIME_TYPE.scoring,
    active_runtime_version: getAgoraRuntimeVersion(config),
  });
  const app = createApp();
  const runtimeIdentity = getAgoraRuntimeIdentity(config);

  serve({ fetch: app.fetch, port });

  console.log("Agora API runtime identity", runtimeIdentity);
  console.log(`Agora API listening on http://localhost:${port}`);
}

start().catch((error) => {
  console.error(
    `Agora API failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
