import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringDraftViewRow } from "@agora/db";
import { enforceAuthoringSponsorMonthlyBudget } from "../src/lib/authoring-sponsored-publish.js";
import { buildManagedAuthoringIr } from "../src/lib/managed-authoring-ir.js";

function createDraft(): AuthoringDraftViewRow {
  return {
    id: "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
    poster_address: null,
    state: "ready",
    intent_json: {
      title: "Drug response challenge",
      description: "Predict held-out drug response values.",
      payout_condition: "Highest R2 wins.",
      reward_total: "10",
      distribution: "winner_take_all",
      deadline: "2026-03-25T00:00:00.000Z",
      domain: "other",
      tags: [],
      timezone: "UTC",
    },
    authoring_ir_json: buildManagedAuthoringIr({
      intent: {
        title: "Drug response challenge",
        description: "Predict held-out drug response values.",
        payout_condition: "Highest R2 wins.",
        reward_total: "10",
        distribution: "winner_take_all",
        deadline: "2026-03-25T00:00:00.000Z",
        domain: "other",
        tags: [],
        timezone: "UTC",
      },
      uploadedArtifacts: [],
      runtimeFamily: "tabular_regression",
      metric: "r2",
      confidenceScore: 0.9,
      routingMode: "managed_supported",
      sourceMessages: [
        {
          id: "msg-1",
          role: "poster",
          content: "OpenClaw wants to post a challenge.",
          created_at: "2026-03-18T00:00:00.000Z",
        },
      ],
      origin: {
        provider: "beach_science",
        external_id: "thread-42",
        external_url: "https://beach.science/thread/42",
        ingested_at: "2026-03-18T00:00:00.000Z",
        raw_context: {
          poster_agent_handle: "lab-alpha",
        },
      },
    }),
    uploaded_artifacts_json: [],
    compilation_json: null,
    published_challenge_id: null,
    published_spec_json: null,
    published_spec_cid: null,
    source_callback_url: "https://hooks.beach.science/agora",
    source_callback_registered_at: "2026-03-18T00:05:00.000Z",
    failure_message: null,
    expires_at: "2026-03-25T00:00:00.000Z",
    created_at: "2026-03-18T00:00:00.000Z",
    updated_at: "2026-03-18T00:00:00.000Z",
  };
}

function createSpec() {
  return {
    schema_version: 3 as const,
    id: "draft-1",
    title: "Drug response challenge",
    description: "Predict held-out drug response values.",
    domain: "other" as const,
    type: "prediction" as const,
    evaluation: {
      runtime_family: "tabular_regression",
      metric: "r2",
      scorer_image: "ghcr.io/agora/tabular-regression@sha256:abc",
      evaluation_bundle: "ipfs://bundle",
    },
    artifacts: [
      {
        role: "training_data",
        visibility: "public" as const,
        uri: "ipfs://artifact",
      },
    ],
    submission_contract: {
      kind: "csv_table" as const,
      required_columns: ["id", "prediction"],
      id_column: "id",
      value_column: "prediction",
    },
    reward: {
      total: "10",
      distribution: "winner_take_all" as const,
    },
    deadline: "2026-03-25T00:00:00.000Z",
  };
}

test("enforceAuthoringSponsorMonthlyBudget allows publishes within the partner cap", async () => {
  await assert.doesNotReject(() =>
    enforceAuthoringSponsorMonthlyBudget({
      db: {} as never,
      draft: createDraft(),
      spec: createSpec(),
      sponsorMonthlyBudgetUsdc: 500,
      sumRewardAmountForSourceProviderImpl: async () => 100,
    }),
  );
});

test("enforceAuthoringSponsorMonthlyBudget rejects publishes that exceed the partner cap", async () => {
  await assert.rejects(
    () =>
      enforceAuthoringSponsorMonthlyBudget({
        db: {} as never,
        draft: createDraft(),
        spec: createSpec(),
        sponsorMonthlyBudgetUsdc: 100,
        sumRewardAmountForSourceProviderImpl: async () => 95,
      }),
    /sponsor budget for beach_science would be exceeded/i,
  );
});
