import assert from "node:assert/strict";
import {
  type RuntimeSchemaCheck,
  assertRuntimeDatabaseSchema,
  verifyRuntimeDatabaseSchema,
} from "../schema-compatibility";

type MockResponse = { error: { message: string } | null };

function createMockDb(results: Record<string, MockResponse>) {
  return {
    from(table: string) {
      return {
        select(select: string) {
          const key = `${table}:${select}`;
          return {
            async limit() {
              return results[key] ?? { error: null };
            },
          };
        },
      };
    },
  };
}

const checks: RuntimeSchemaCheck[] = [
  {
    id: "worker_runtime_version_column",
    table: "worker_runtime_state",
    select: "runtime_version",
    nextStep: "apply migration",
  },
  {
    id: "worker_executor_ready_column",
    table: "worker_runtime_state",
    select: "executor_ready",
    nextStep: "apply migration",
  },
  {
    id: "submission_intents_columns",
    table: "submission_intents",
    select: "result_format,matched_submission_id,trace_id",
    nextStep: "apply migration",
  },
  {
    id: "submissions_registration_columns",
    table: "submissions",
    select: "submission_intent_id,trace_id",
    nextStep: "apply migration",
  },
  {
    id: "score_jobs_trace_id_column",
    table: "score_jobs",
    select: "trace_id",
    nextStep: "apply migration",
  },
  {
    id: "challenge_runtime_v3_columns",
    table: "challenges",
    select: "runtime_family,evaluation_json,artifacts_json",
    nextStep: "apply migration",
  },
  {
    id: "authoring_drafts_table",
    table: "authoring_drafts",
    select:
      "state,intent_json,authoring_ir_json,uploaded_artifacts_json,compilation_json,source_callback_url,source_callback_registered_at,expires_at",
    nextStep: "apply migration",
  },
  {
    id: "published_challenge_links_table",
    table: "published_challenge_links",
    select:
      "draft_id,challenge_id,published_spec_json,published_spec_cid,return_to,published_at",
    nextStep: "apply migration",
  },
  {
    id: "authoring_callback_deliveries_table",
    table: "authoring_callback_deliveries",
    select:
      "draft_id,provider,callback_url,event,payload_json,status,attempts,max_attempts,last_attempt_at,next_attempt_at,delivered_at,last_error",
    nextStep: "apply migration",
  },
];

const passingDb = createMockDb({});
const passingFailures = await verifyRuntimeDatabaseSchema(
  passingDb as never,
  checks,
);
assert.deepEqual(passingFailures, []);

const failingDb = createMockDb({
  "worker_runtime_state:executor_ready": {
    error: {
      message: "Could not find the 'executor_ready' column in the schema cache",
    },
  },
});

const failures = await verifyRuntimeDatabaseSchema(failingDb as never, checks);
assert.equal(failures.length, 1);
assert.equal(failures[0]?.checkId, "worker_executor_ready_column");

await assert.rejects(
  () => assertRuntimeDatabaseSchema(failingDb as never, checks),
  /Database schema is incompatible with the current Agora runtime/,
);

console.log("schema compatibility checks passed");
