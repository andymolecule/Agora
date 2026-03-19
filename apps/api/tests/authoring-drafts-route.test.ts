import assert from "node:assert/strict";
import test from "node:test";
import {
  type AgoraAuthoringPartnerRuntimeConfig,
  type AuthoringDraftOutput,
  computeSpecHash,
  createCsvTableSubmissionContract,
  lookupManagedRuntimeFamily,
} from "@agora/common";
import type { AuthoringDraftViewRow } from "@agora/db";
import { resolveAuthoringDraftReturnUrl } from "../src/lib/authoring-drafts.js";
import { buildManagedAuthoringIr } from "../src/lib/managed-authoring-ir.js";
import { createAuthoringDraftRoutes } from "../src/routes/authoring-drafts.js";

function allowQuota() {
  return () =>
    (async (_c, next) => {
      await next();
    }) as never;
}

function createIntent() {
  return {
    title: "Drug response challenge",
    description: "Predict held-out drug response values.",
    payout_condition: "Highest R2 wins.",
    reward_total: "10",
    distribution: "winner_take_all" as const,
    deadline: "2026-03-25T00:00:00.000Z",
    dispute_window_hours: 168,
    domain: "other",
    tags: [],
    timezone: "UTC",
  };
}

function createReadySession(
  overrides: Partial<AuthoringDraftViewRow> = {},
): AuthoringDraftViewRow {
  const runtimeFamily = lookupManagedRuntimeFamily("tabular_regression");
  if (!runtimeFamily) {
    throw new Error("missing runtime family fixture");
  }

  const submissionContract = createCsvTableSubmissionContract({
    requiredColumns: ["id", "prediction"],
    idColumn: "id",
    valueColumn: "prediction",
  });
  const intent = overrides.intent_json ?? createIntent();
  const uploadedArtifacts = overrides.uploaded_artifacts_json ?? [
    {
      id: "train",
      uri: "ipfs://train",
      file_name: "train.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
      detected_columns: ["id", "feature_a", "label"],
    },
  ];
  const challengeSpec = {
    schema_version: 3 as const,
    id: "draft-1",
    title: intent.title,
    description: intent.description,
    domain: intent.domain,
    type: "prediction" as const,
    evaluation: {
      runtime_family: "tabular_regression" as const,
      metric: "r2",
      scorer_image: runtimeFamily.scorerImage,
      evaluation_bundle: "ipfs://bundle",
    },
    artifacts: [
      {
        role: "training_data" as const,
        visibility: "public" as const,
        uri: uploadedArtifacts[0]?.uri ?? "ipfs://train",
      },
    ],
    submission_contract: submissionContract,
    reward: {
      total: intent.reward_total,
      distribution: intent.distribution,
    },
    deadline: intent.deadline,
    dispute_window_hours: intent.dispute_window_hours,
    tags: [],
  };

  return {
    id: overrides.id ?? "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
    poster_address: overrides.poster_address ?? null,
    state: overrides.state ?? "ready",
    intent_json: intent,
    authoring_ir_json:
      overrides.authoring_ir_json ??
      buildManagedAuthoringIr({
        intent,
        uploadedArtifacts,
        runtimeFamily: "tabular_regression",
        metric: "r2",
        confidenceScore: 0.92,
        routingMode: "managed_supported",
        origin: {
          provider: "beach_science",
          external_id: "thread-42",
          external_url: "https://beach.science/thread/42",
          ingested_at: "2026-03-19T00:00:00.000Z",
        },
      }),
    uploaded_artifacts_json: uploadedArtifacts,
    compilation_json: overrides.compilation_json ?? {
      challenge_type: "prediction",
      runtime_family: "tabular_regression",
      metric: "r2",
      resolved_artifacts: [
        {
          role: "training_data",
          visibility: "public",
          uri: uploadedArtifacts[0]?.uri ?? "ipfs://train",
        },
      ],
      submission_contract: submissionContract,
      dry_run: {
        status: "validated",
        summary: "validated",
      },
      confidence_score: 0.92,
      reason_codes: [],
      warnings: [],
      confirmation_contract: {
        solver_submission: "CSV with id,prediction",
        scoring_summary: "Highest R2 wins.",
        public_private_summary: ["Dataset is public"],
        reward_summary: "10 USDC winner take all",
        deadline_summary: "Deadline in UTC",
        dry_run_summary: "validated",
      },
      challenge_spec: challengeSpec,
    },
    published_challenge_id: overrides.published_challenge_id ?? null,
    published_spec_json: overrides.published_spec_json ?? null,
    published_spec_cid: overrides.published_spec_cid ?? null,
    source_callback_url: overrides.source_callback_url ?? null,
    source_callback_registered_at:
      overrides.source_callback_registered_at ?? null,
    failure_message: overrides.failure_message ?? null,
    expires_at: overrides.expires_at ?? "2026-03-26T00:00:00.000Z",
    created_at: overrides.created_at ?? "2026-03-19T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-19T00:00:00.000Z",
  };
}

function createNonExecutableSemiCustomSession(
  overrides: Partial<AuthoringDraftViewRow> = {},
): AuthoringDraftViewRow {
  const intent = overrides.intent_json ?? createIntent();
  const uploadedArtifacts = overrides.uploaded_artifacts_json ?? [
    {
      id: "train",
      uri: "ipfs://train",
      file_name: "train.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
      detected_columns: ["id", "feature_a", "label"],
    },
  ];

  const challengeSpec = {
    schema_version: 3 as const,
    id: "draft-semi-custom",
    title: intent.title,
    description: intent.description,
    domain: intent.domain,
    type: "custom" as const,
    evaluation: {
      runtime_family: "semi_custom" as const,
      metric: "validation_score",
      evaluator_contract: {
        version: "v1" as const,
        archetype: "structured_record_score" as const,
        summary: "Score a JSON report against a deterministic rubric.",
        artifact_roles: {
          solver_visible: ["training_data"],
          hidden: ["hidden_labels"],
        },
        submission: {
          kind: "json_file" as const,
          schema_requirements: {
            expected_kind: "json_file",
          },
          validation_rules: ["Submission must be valid JSON."],
        },
        scoring: {
          metric: "validation_score",
          comparator: "maximize" as const,
          deterministic_rule:
            "Validate the structured report against the hidden rubric.",
          minimum_threshold: null,
        },
        notes: [],
      },
    },
    artifacts: [
      {
        role: "training_data" as const,
        visibility: "public" as const,
        uri: uploadedArtifacts[0]?.uri ?? "ipfs://train",
      },
    ],
    submission_contract: {
      version: "v1" as const,
      kind: "opaque_file" as const,
      file: {
        extension: ".bin",
        mime: "application/octet-stream",
        max_bytes: 10_000_000,
      },
    },
    reward: {
      total: intent.reward_total,
      distribution: intent.distribution,
    },
    deadline: intent.deadline,
    dispute_window_hours: intent.dispute_window_hours,
    tags: [],
  };

  return {
    ...createReadySession(overrides),
    state: overrides.state ?? "needs_review",
    authoring_ir_json:
      overrides.authoring_ir_json ??
      buildManagedAuthoringIr({
        intent,
        uploadedArtifacts,
        confidenceScore: 0.55,
        origin: {
          provider: "beach_science",
          external_id: "thread-42",
          external_url: "https://beach.science/thread/42",
          ingested_at: "2026-03-19T00:00:00.000Z",
        },
      }),
    compilation_json:
      overrides.compilation_json ??
      ({
        challenge_type: "custom",
        runtime_family: "semi_custom",
        metric: "validation_score",
        resolved_artifacts: challengeSpec.artifacts,
        submission_contract: challengeSpec.submission_contract,
        dry_run: {
          status: "skipped",
          summary:
            "Semi-custom evaluator contract is typed but not executable.",
        },
        confidence_score: 0.55,
        reason_codes: ["semi_custom_contract_built"],
        warnings: [
          "Semi-custom evaluator contract is typed and reviewable, but the scorer execution path is not configured yet.",
        ],
        confirmation_contract: {
          solver_submission: "JSON file",
          scoring_summary: "Deterministic JSON rubric",
          public_private_summary: ["Training data is public"],
          reward_summary: "10 USDC winner take all",
          deadline_summary: "Deadline in UTC",
          dry_run_summary:
            "Semi-custom evaluator contract is typed but not executable.",
        },
        challenge_spec: challengeSpec,
      } as AuthoringDraftViewRow["compilation_json"]),
  };
}

function createRouterForPublish(input: {
  session: AuthoringDraftViewRow;
  deliveredEvents?: string[];
}) {
  let storedSession = input.session;
  let publishedLink: {
    draft_id: string;
    challenge_id: string | null;
    published_spec_json: NonNullable<
      AuthoringDraftViewRow["published_spec_json"]
    >;
    published_spec_cid: string;
    return_to: string | null;
    published_at: string;
    created_at: string;
    updated_at: string;
  } | null = storedSession.published_spec_cid
    ? {
        draft_id: storedSession.id,
        challenge_id: null,
        published_spec_json:
          storedSession.published_spec_json ??
          storedSession.compilation_json?.challenge_spec ??
          null,
        published_spec_cid: storedSession.published_spec_cid,
        return_to: null,
        published_at: "2026-03-19T01:00:00.000Z",
        created_at: "2026-03-19T01:00:00.000Z",
        updated_at: "2026-03-19T01:00:00.000Z",
      }
    : null;
  const partnerRuntimeConfig: AgoraAuthoringPartnerRuntimeConfig = {
    partnerKeys: { beach_science: "partner-key" },
    callbackSecrets: { beach_science: "callback-secret" },
    returnOrigins: { beach_science: ["https://beach.science"] },
  };

  return createAuthoringDraftRoutes({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () =>
      ({
        ...storedSession,
        published_spec_json:
          publishedLink?.published_spec_json ??
          storedSession.published_spec_json,
        published_spec_cid:
          publishedLink?.published_spec_cid ?? storedSession.published_spec_cid,
      }) as never,
    getPublishedChallengeLinkByDraftId: async () => publishedLink as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = {
        ...storedSession,
        ...patch,
        updated_at: "2026-03-19T01:00:00.000Z",
      } as AuthoringDraftViewRow;
      return storedSession as never;
    },
    upsertPublishedChallengeLink: async (_db, payload) => {
      publishedLink = {
        draft_id: payload.draft_id,
        challenge_id: payload.challenge_id ?? null,
        published_spec_json: payload.published_spec_json,
        published_spec_cid: payload.published_spec_cid,
        return_to: payload.return_to ?? null,
        published_at: payload.published_at ?? "2026-03-19T01:00:00.000Z",
        created_at: "2026-03-19T01:00:00.000Z",
        updated_at: "2026-03-19T01:00:00.000Z",
      };
      return publishedLink as never;
    },
    pinJSON: async () => "bafy-published-spec" as never,
    getPublicClient: () =>
      ({
        verifyTypedData: async () => true,
      }) as never,
    consumeNonce: async () => true,
    canonicalizeChallengeSpec: async (spec) => spec,
    readApiServerRuntimeConfig: () => ({
      nodeEnv: "test",
      apiPort: 3000,
      chainId: 84532,
      corsOrigins: [],
    }),
    readAuthoringReviewRuntimeConfig: () => ({
      token: "review-token",
    }),
    deliverAuthoringDraftLifecycleEvent: async ({ event }) => {
      input.deliveredEvents?.push(event);
      return true;
    },
    requireWriteQuota: allowQuota() as never,
    resolveAuthoringDraftReturnUrl: (resolveInput) =>
      resolveAuthoringDraftReturnUrl({
        ...resolveInput,
        runtimeConfig: partnerRuntimeConfig,
      }),
  });
}

function buildPublishRequestBody(session: AuthoringDraftViewRow) {
  const spec = session.compilation_json?.challenge_spec;
  if (!spec) {
    throw new Error("publish fixture requires a compiled challenge spec");
  }

  return {
    auth: {
      address: "0x00000000000000000000000000000000000000aa",
      nonce: "publish-nonce-1234",
      signature: `0x${"11".repeat(65)}`,
      specHash: computeSpecHash(spec),
    },
  };
}

test("authoring draft publish accepts an explicit allowlisted return_to", async () => {
  const draft = createReadySession();
  const router = createRouterForPublish({ session: draft });

  const response = await router.request(
    new Request(`http://localhost/drafts/${draft.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...buildPublishRequestBody(draft),
        return_to: "https://beach.science/thread/42?tab=publish",
      }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: {
      returnTo: string | null;
      returnToSource: "requested" | "origin_external_url" | null;
      draft: AuthoringDraftOutput;
    };
  };
  assert.equal(
    payload.data.returnTo,
    "https://beach.science/thread/42?tab=publish",
  );
  assert.equal(payload.data.returnToSource, "requested");
  assert.equal(payload.data.draft.state, "published");
  assert.equal(
    payload.data.draft.approved_confirmation?.scoring_summary,
    "Highest R2 wins.",
  );
});

test("authoring draft publish falls back to the stored origin external_url", async () => {
  const draft = createReadySession();
  const router = createRouterForPublish({ session: draft });

  const response = await router.request(
    new Request(`http://localhost/drafts/${draft.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPublishRequestBody(draft)),
    }),
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: {
      returnTo: string | null;
      returnToSource: "requested" | "origin_external_url" | null;
      draft: AuthoringDraftOutput;
    };
  };
  assert.equal(payload.data.returnTo, "https://beach.science/thread/42");
  assert.equal(payload.data.returnToSource, "origin_external_url");
  assert.equal(
    payload.data.draft.approved_confirmation?.scoring_summary,
    "Highest R2 wins.",
  );
});

test("authoring draft publish rejects return_to for direct drafts", async () => {
  const draft = createReadySession({
    authoring_ir_json: buildManagedAuthoringIr({
      intent: createIntent(),
      uploadedArtifacts: [
        {
          id: "train",
          uri: "ipfs://train",
          file_name: "train.csv",
          mime_type: "text/csv",
          size_bytes: 1024,
          detected_columns: ["id", "feature_a", "label"],
        },
      ],
      runtimeFamily: "tabular_regression",
      metric: "r2",
      confidenceScore: 0.92,
      routingMode: "managed_supported",
      origin: {
        provider: "direct",
        external_id: null,
        external_url: null,
        ingested_at: "2026-03-19T00:00:00.000Z",
      },
    }),
  });
  const router = createRouterForPublish({ session: draft });

  const response = await router.request(
    new Request(`http://localhost/drafts/${draft.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...buildPublishRequestBody(draft),
        return_to: "https://beach.science/thread/42",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_RETURN_URL_NOT_ALLOWED",
  );
});

test("authoring review approval rejects non-scoreable semi-custom drafts", async () => {
  const draft = createNonExecutableSemiCustomSession();
  const router = createRouterForPublish({ session: draft });

  const response = await router.request(
    new Request(`http://localhost/review/drafts/${draft.id}/decision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agora-review-token": "review-token",
      },
      body: JSON.stringify({
        action: "approve",
      }),
    }),
  );

  assert.equal(response.status, 409);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_REVIEW_NOT_SCOREABLE",
  );
});

test("authoring draft publish rejects non-scoreable ready drafts", async () => {
  const draft = createNonExecutableSemiCustomSession({
    state: "ready",
  });
  const router = createRouterForPublish({ session: draft });

  const response = await router.request(
    new Request(`http://localhost/drafts/${draft.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPublishRequestBody(draft)),
    }),
  );

  assert.equal(response.status, 409);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_NOT_SCOREABLE",
  );
});
