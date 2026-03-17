import assert from "node:assert/strict";
import {
  AGORA_REQUEST_ID_HEADER,
  buildAgoraSentryInitOptions,
  normalizeRequestId,
  parseAgoraLogLevel,
  resolveRequestId,
} from "../server-observability.js";

assert.equal(AGORA_REQUEST_ID_HEADER, "x-request-id");
assert.equal(parseAgoraLogLevel("DEBUG"), "debug");
assert.equal(parseAgoraLogLevel("unexpected"), "info");
assert.equal(normalizeRequestId("  req-123  "), "req-123");
assert.equal(normalizeRequestId("bad request id"), null);
assert.match(
  resolveRequestId(undefined),
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);

const sentry = buildAgoraSentryInitOptions("api", {
  nodeEnv: "production",
  logLevel: "warn",
  runtimeVersion: "ff16b4f8c15a",
  sentryDsn: "https://public@example.ingest.sentry.io/123",
  sentryEnvironment: "production",
  sentryTracesSampleRate: 0.25,
});

assert.equal(sentry.enabled, true);
assert.equal(sentry.environment, "production");
assert.equal(sentry.release, "ff16b4f8c15a");
assert.equal(sentry.tracesSampleRate, 0.25);
assert.deepEqual(sentry.initialScope.tags, {
  service: "api",
  runtimeVersion: "ff16b4f8c15a",
});

console.log("server observability helpers validation passed");
