import {
  getAgoraRuntimeIdentity,
  getAgoraRuntimeVersion,
  loadConfig,
  readAuthoringPartnerRuntimeConfig,
} from "@agora/common";
import {
  WORKER_RUNTIME_TYPE,
  assertRuntimeDatabaseSchema,
  createSupabaseClient,
  upsertActiveWorkerRuntimeVersion,
} from "@agora/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import {
  apiLogger,
  captureApiException,
  initApiObservability,
} from "./lib/observability.js";

async function start() {
  initApiObservability();
  const config = loadConfig();
  const authoringPartnerRuntime = readAuthoringPartnerRuntimeConfig();
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

  if ((authoringPartnerRuntime.callbackSecretFallbackProviders?.length ?? 0) > 0) {
    apiLogger.warn(
      {
        event: "api.authoring.callback_secret_fallback",
        providers: authoringPartnerRuntime.callbackSecretFallbackProviders,
      },
      "Authoring callback signing is falling back to partner bearer keys for some providers",
    );
  }

  apiLogger.info(
    {
      event: "api.startup",
      port,
      runtimeIdentity,
    },
    "Agora API listening",
  );
}

start().catch((error) => {
  captureApiException(error, {
    service: "api",
    logger: apiLogger,
    bindings: { event: "api.startup.failed" },
  });
  process.exit(1);
});
