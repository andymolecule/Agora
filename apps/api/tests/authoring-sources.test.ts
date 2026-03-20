import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AgoraError,
  type CreateAuthoringSourceDraftRequestOutput,
  createCsvTableSubmissionContract,
  lookupManagedRuntimeFamily,
} from "@agora/common";
import {
  type AuthoringDraftViewRow,
  AuthoringDraftWriteConflictError,
} from "@agora/db";
import { buildManagedAuthoringIr } from "../src/lib/managed-authoring-ir.js";
import { createAuthoringSourcesRouter } from "../src/routes/authoring-sources.js";

function allowPartnerQuota(calls?: string[]) {
  return (key: string, routeKey: string) => {
    calls?.push(`${key}|${routeKey}`);
    return { allowed: true } as const;
  };
}

function buildStubArtifactFromSourceUrl(input: {
  sourceUrl: string;
  suggestedFilename?: string;
  mimeType?: string;
  sizeBytes?: number;
}) {
  const digest = createHash("sha256").update(input.sourceUrl).digest("hex");
  return {
    id: `external-${digest.slice(0, 12)}`,
    uri: `ipfs://${digest.slice(0, 24)}`,
    file_name:
      input.suggestedFilename ??
      new URL(input.sourceUrl).pathname.split("/").pop() ??
      "external-artifact",
    mime_type: input.mimeType ?? undefined,
    size_bytes: input.sizeBytes,
  };
}

function createDraft(
  overrides: Partial<AuthoringDraftViewRow> = {},
): AuthoringDraftViewRow {
  const uploadedArtifacts = overrides.uploaded_artifacts_json ?? [
    buildStubArtifactFromSourceUrl({
      sourceUrl: "https://cdn.beach.science/uploads/dataset.csv",
      mimeType: "text/csv",
      sizeBytes: 1024,
    }),
  ];
  const authoringIr =
    overrides.authoring_ir_json ??
    buildManagedAuthoringIr({
      intent: overrides.intent_json ?? null,
      uploadedArtifacts,
      sourceMessages: [
        {
          id: "msg-1",
          role: "poster",
          content: "We want a deterministic challenge.",
          created_at: "2026-03-18T00:00:00.000Z",
        },
      ],
      origin: {
        provider: "beach_science",
        external_id: "thread-42",
        external_url: "https://beach.science/thread/42",
        ingested_at: "2026-03-18T00:00:00.000Z",
      },
    });

  return {
    id: "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
    poster_address: null,
    state: overrides.state ?? "draft",
    intent_json: overrides.intent_json ?? null,
    authoring_ir_json: authoringIr,
    uploaded_artifacts_json: uploadedArtifacts,
    compilation_json: overrides.compilation_json ?? null,
    published_challenge_id: overrides.published_challenge_id ?? null,
    published_spec_json: overrides.published_spec_json ?? null,
    published_spec_cid: overrides.published_spec_cid ?? null,
    source_callback_url: overrides.source_callback_url ?? null,
    source_callback_registered_at:
      overrides.source_callback_registered_at ?? null,
    failure_message: overrides.failure_message ?? null,
    expires_at: overrides.expires_at ?? "2026-03-25T00:00:00.000Z",
    created_at: overrides.created_at ?? "2026-03-18T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-18T00:00:00.000Z",
  };
}

function normalizeExternalArtifactsStub(
  input: Pick<CreateAuthoringSourceDraftRequestOutput, "artifacts">,
) {
  return Promise.resolve(
    input.artifacts.map((artifact) =>
      buildStubArtifactFromSourceUrl({
        sourceUrl: artifact.source_url,
        suggestedFilename: artifact.suggested_filename,
        mimeType: artifact.mime_type,
        sizeBytes: artifact.size_bytes,
      }),
    ),
  );
}

function createTestRouter(
  dependencies?: Parameters<typeof createAuthoringSourcesRouter>[0],
) {
  return createAuthoringSourcesRouter({
    normalizeExternalArtifactsForDraft: normalizeExternalArtifactsStub,
    upsertAuthoringCallbackTarget: async () =>
      ({
        draft_id: "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
        callback_url: "https://hooks.beach.science/agora",
        registered_at: "2026-03-18T00:05:00.000Z",
        created_at: "2026-03-18T00:05:00.000Z",
        updated_at: "2026-03-18T00:05:00.000Z",
      }) as never,
    getAuthoringSourceLink: async () => null as never,
    upsertAuthoringSourceLink: async (_db, payload) =>
      ({
        provider: payload.provider,
        external_id: payload.external_id,
        draft_id: payload.draft_id,
        external_url: payload.external_url ?? null,
        created_at: "2026-03-18T00:05:00.000Z",
        updated_at: "2026-03-18T00:05:00.000Z",
      }) as never,
    ...dependencies,
  });
}

function applyUpdate(
  draft: AuthoringDraftViewRow,
  patch: Record<string, unknown>,
): AuthoringDraftViewRow {
  return {
    ...draft,
    ...patch,
    updated_at:
      typeof patch.updated_at === "string"
        ? patch.updated_at
        : "2026-03-18T01:00:00.000Z",
  } as AuthoringDraftViewRow;
}

function partnerConfig() {
  return {
    partnerKeys: {
      beach_science: "beach-secret",
      github: "github-secret",
    },
    callbackSecrets: {
      beach_science: "beach-secret",
      github: "github-secret",
    },
    returnOrigins: {
      beach_science: ["https://beach.science"],
      github: ["https://github.com"],
    },
  };
}

function createCompileIntent() {
  return {
    title: "Drug response challenge",
    description: "Predict held-out drug response values.",
    payout_condition: "Highest R2 wins.",
    reward_total: "10",
    distribution: "winner_take_all" as const,
    deadline: "2026-03-19T00:00:00.000Z",
    domain: "other" as const,
    tags: [],
    timezone: "UTC",
  };
}

function createReadyCompileOutcome(input: {
  intent: ReturnType<typeof createCompileIntent>;
  uploadedArtifacts: AuthoringDraftViewRow["uploaded_artifacts_json"];
}) {
  const submissionContract = createCsvTableSubmissionContract({
    requiredColumns: ["id", "prediction"],
    idColumn: "id",
    valueColumn: "prediction",
  });
  const runtimeFamily = lookupManagedRuntimeFamily("tabular_regression");
  if (!runtimeFamily) {
    throw new Error("missing runtime family fixture");
  }

  return {
    state: "ready" as const,
    authoringIr: buildManagedAuthoringIr({
      intent: input.intent,
      uploadedArtifacts: input.uploadedArtifacts,
      presetId: "tabular_regression",
      metric: "r2",
      confidenceScore: 0.92,
      routingMode: "preset_supported",
    }),
    compilation: {
      authoring_path: "preset_supported" as const,
      challenge_type: "prediction" as const,
      preset_id: "tabular_regression" as const,
      definition_id: null,
      backend_kind: "preset_interpreter" as const,
      execution_runtime_family: "tabular_regression" as const,
      metric: "r2",
      resolved_artifacts: [
        {
          role: "training_data" as const,
          visibility: "public" as const,
          uri:
            input.uploadedArtifacts[0]?.uri ??
            "https://cdn.beach.science/uploads/dataset.csv",
        },
      ],
      submission_contract: submissionContract,
      dry_run: {
        status: "validated" as const,
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
      challenge_spec: {
        schema_version: 4 as const,
        id: "draft-1",
        title: input.intent.title,
        description: input.intent.description,
        domain: input.intent.domain,
        type: "prediction" as const,
        evaluation: {
          preset_id: "tabular_regression" as const,
          backend_kind: "preset_interpreter" as const,
          execution_runtime_family: "tabular_regression" as const,
          metric: "r2",
          scorer_image: runtimeFamily.scorerImage,
          evaluation_bundle: "ipfs://bundle",
        },
        artifacts: [
          {
            role: "training_data" as const,
            visibility: "public" as const,
            uri:
              input.uploadedArtifacts[0]?.uri ??
              "https://cdn.beach.science/uploads/dataset.csv",
          },
        ],
        submission_contract: submissionContract,
        reward: {
          total: input.intent.reward_total,
          distribution: input.intent.distribution,
        },
        deadline: input.intent.deadline,
        tags: [],
      },
    },
    message: "ready",
  };
}

test("authoring source route returns a specific error when auth is missing", async () => {
  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async () => ({}) as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            id: "msg-1",
            role: "poster",
            content: "We want a deterministic challenge.",
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_SOURCE_MISSING_AUTH",
  );
});

test("authoring source route returns a specific error for malformed bearer auth", async () => {
  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async () => ({}) as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Token beach-secret",
      },
      body: JSON.stringify({
        messages: [
          {
            id: "msg-1",
            role: "poster",
            content: "We want a deterministic challenge.",
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_SOURCE_INVALID_AUTH_FORMAT",
  );
});

test("authoring source route creates a partner-owned draft with source context and a host card", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const quotaCalls: string[] = [];
  let storedDraft = createDraft();

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async (_db, payload) => {
      capturedPayload = payload as Record<string, unknown>;
      storedDraft = createDraft({
        state: payload.state,
        intent_json: payload.intent_json ?? null,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
        expires_at: payload.expires_at,
      });
      return storedDraft as never;
    },
    getAuthoringDraftViewById: async () => storedDraft as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        title: "Beach thread title",
        external_id: "thread-42",
        external_url: "https://beach.science/thread/42",
        raw_context: {
          revision: "rev-7",
        },
        messages: [
          {
            id: "msg-1",
            role: "poster",
            content:
              "We need a challenge that rewards the best deterministic prediction.",
          },
          {
            id: "msg-2",
            role: "participant",
            content: "Solvers should upload a CSV with id and prediction.",
          },
        ],
        artifacts: [
          {
            source_url:
              "https://cdn.beach.science/uploads/dataset.csv?download=1",
            mime_type: "text/csv",
            size_bytes: 1024,
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(quotaCalls, [
    "partner:beach_science|/api/authoring/external/sources",
  ]);
  assert.equal(
    (
      capturedPayload?.authoring_ir_json as {
        origin?: { provider?: string; external_id?: string | null };
      }
    ).origin?.provider,
    "beach_science",
  );
  assert.equal(
    (capturedPayload as { clarification_questions?: unknown })
      ?.clarification_questions,
    undefined,
  );

  const payload = (await response.json()) as {
    data: {
      draft: {
        authoring_ir?: { origin?: { external_id?: string | null } };
      };
      card: {
        draft_id: string;
        provider: string;
        clarification_count: number;
      };
    };
  };
  assert.equal(
    payload.data.draft.authoring_ir?.origin?.external_id,
    "thread-42",
  );
  assert.equal(payload.data.card.draft_id, createDraft().id);
  assert.equal(payload.data.card.provider, "beach_science");
  assert.equal(payload.data.card.clarification_count > 0, true);
});

test("authoring source route refreshes an existing linked draft instead of creating a duplicate", async () => {
  let storedDraft = createDraft({
    state: "ready",
    intent_json: createCompileIntent(),
  });
  let createCalled = false;

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async () => {
      createCalled = true;
      return storedDraft as never;
    },
    getAuthoringDraftViewById: async () => storedDraft as never,
    getAuthoringSourceLink: async () =>
      ({
        provider: "beach_science",
        external_id: "thread-42",
        draft_id: storedDraft.id,
        external_url: "https://beach.science/thread/42",
      }) as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedDraft = applyUpdate(
        storedDraft,
        patch as Record<string, unknown>,
      );
      return storedDraft as never;
    },
    upsertAuthoringSourceLink: async () =>
      ({
        provider: "beach_science",
        external_id: "thread-42",
        draft_id: storedDraft.id,
        external_url: "https://beach.science/thread/42",
        created_at: "2026-03-18T00:00:00.000Z",
        updated_at: "2026-03-18T01:00:00.000Z",
      }) as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        title: "Updated Beach thread title",
        external_id: "thread-42",
        external_url: "https://beach.science/thread/42",
        messages: [
          {
            id: "msg-1",
            role: "poster",
            content: "Updated deterministic challenge framing.",
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(createCalled, false);
  assert.equal(storedDraft.state, "draft");
  assert.equal(
    storedDraft.authoring_ir_json?.source.poster_messages[0]?.content,
    "Updated deterministic challenge framing.",
  );

  const payload = (await response.json()) as {
    data: { draft: { id: string; state: string } };
  };
  assert.equal(payload.data.draft.id, storedDraft.id);
  assert.equal(payload.data.draft.state, "draft");
});

test("authoring source route returns artifact normalization failures without creating a draft", async () => {
  let createCalled = false;

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async () => {
      createCalled = true;
      return {} as never;
    },
    normalizeExternalArtifactsForDraft: async () => {
      throw new AgoraError(
        "External artifact content-type did not match the declared mime_type. Next step: correct the artifact metadata or source file and retry.",
        {
          code: "AUTHORING_SOURCE_ARTIFACT_TYPE_MISMATCH",
          status: 422,
        },
      );
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        messages: [
          {
            id: "msg-1",
            role: "poster",
            content: "We want a deterministic challenge.",
          },
        ],
        artifacts: [
          {
            source_url: "https://cdn.beach.science/uploads/dataset.csv",
            mime_type: "text/csv",
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 422);
  assert.equal(createCalled, false);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_SOURCE_ARTIFACT_TYPE_MISMATCH",
  );
});

test("authoring source draft routes hide drafts owned by another provider", async () => {
  const storedDraft = createDraft({
    authoring_ir_json: buildManagedAuthoringIr({
      intent: null,
      uploadedArtifacts: [],
      sourceMessages: [
        {
          id: "msg-1",
          role: "poster",
          content: "GitHub-originated thread",
          created_at: "2026-03-18T00:00:00.000Z",
        },
      ],
      origin: {
        provider: "github",
        external_id: "issue-1",
        external_url: "https://github.com/example/repo/issues/1",
        ingested_at: "2026-03-18T00:00:00.000Z",
      },
    }),
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(`http://localhost/external/drafts/${storedDraft.id}`, {
      method: "GET",
      headers: {
        authorization: "Bearer beach-secret",
      },
    }),
  );

  assert.equal(response.status, 404);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_NOT_FOUND",
  );
});

test("authoring source draft clarify appends transcript context and dispatches callbacks", async () => {
  let storedDraft = createDraft({
    source_callback_url: "https://hooks.beach.science/agora",
    source_callback_registered_at: "2026-03-18T00:05:00.000Z",
  });
  const quotaCalls: string[] = [];
  const deliveredEvents: Array<{ event: string; state: string }> = [];

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedDraft = applyUpdate(
        storedDraft,
        patch as Record<string, unknown>,
      );
      return storedDraft as never;
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
    deliverAuthoringDraftLifecycleEvent: async ({ event, draft }) => {
      deliveredEvents.push({ event, state: draft.state });
      return true;
    },
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/clarify`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          raw_context: { revision: "rev-8" },
          messages: [
            {
              id: "msg-2",
              role: "participant",
              content:
                "Reward should be 50 USDC and the winner must maximize R2.",
            },
          ],
          artifacts: [
            {
              source_url: "https://cdn.beach.science/uploads/hidden.csv",
              mime_type: "text/csv",
            },
          ],
        }),
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(quotaCalls, [
    "partner:beach_science|/api/authoring/external/drafts/clarify",
  ]);
  assert.equal(storedDraft.state, "draft");
  assert.equal(storedDraft.uploaded_artifacts_json.length, 2);
  assert.equal(
    storedDraft.authoring_ir_json?.origin.raw_context?.revision,
    "rev-8",
  );
  assert.equal(
    storedDraft.authoring_ir_json?.source.poster_messages.length,
    2,
  );
  assert.deepEqual(deliveredEvents, [
    { event: "draft_updated", state: "draft" },
  ]);

  const payload = (await response.json()) as {
    data: {
      card: { callback_registered: boolean; clarification_count: number };
    };
  };
  assert.equal(payload.data.card.callback_registered, true);
  assert.equal(payload.data.card.clarification_count > 0, true);
});

test("authoring source draft clarify treats duplicate message ids and artifact urls as idempotent", async () => {
  let storedDraft = createDraft();

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedDraft = applyUpdate(
        storedDraft,
        patch as Record<string, unknown>,
      );
      return storedDraft as never;
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/clarify`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          messages: [
            {
              id: "msg-1",
              role: "poster",
              content: "We want a deterministic challenge.",
            },
          ],
          artifacts: [
            {
              source_url: "https://cdn.beach.science/uploads/dataset.csv",
              suggested_filename: "renamed.csv",
              mime_type: "text/plain",
            },
          ],
        }),
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(
    storedDraft.authoring_ir_json?.source.poster_messages.length,
    1,
  );
  assert.equal(storedDraft.uploaded_artifacts_json.length, 1);
  assert.equal(
    storedDraft.uploaded_artifacts_json[0]?.file_name,
    "dataset.csv",
  );
});

test("authoring source draft clarify returns a conflict when the draft changed concurrently", async () => {
  const storedDraft = createDraft();

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    updateAuthoringDraft: async () => {
      throw new AuthoringDraftWriteConflictError("stale");
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/clarify`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          messages: [
            {
              id: "msg-2",
              role: "participant",
              content: "Reward should be 50 USDC.",
            },
          ],
        }),
      },
    ),
  );

  assert.equal(response.status, 409);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_CONFLICT",
  );
});

test("authoring source draft clarify stays successful when callback delivery throws", async () => {
  let storedDraft = createDraft({
    source_callback_url: "https://hooks.beach.science/agora",
    source_callback_registered_at: "2026-03-18T00:05:00.000Z",
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedDraft = applyUpdate(
        storedDraft,
        patch as Record<string, unknown>,
      );
      return storedDraft as never;
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
    deliverAuthoringDraftLifecycleEvent: async () => {
      throw new Error("callback unavailable");
    },
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/clarify`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          messages: [
            {
              id: "msg-2",
              role: "participant",
              content:
                "Reward should be 50 USDC and the winner must maximize R2.",
            },
          ],
        }),
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(storedDraft.state, "draft");
});

test("authoring source draft compile reuses stored artifacts and dispatches compile callbacks", async () => {
  let storedDraft = createDraft({
    source_callback_url: "https://hooks.beach.science/agora",
    source_callback_registered_at: "2026-03-18T00:05:00.000Z",
  });
  const quotaCalls: string[] = [];
  const deliveredEvents: string[] = [];

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedDraft = applyUpdate(
        storedDraft,
        patch as Record<string, unknown>,
      );
      return storedDraft as never;
    },
    compileManagedAuthoringDraftOutcome: async ({
      intent,
      uploadedArtifacts,
    }) =>
      createReadyCompileOutcome({
        intent: intent as ReturnType<typeof createCompileIntent>,
        uploadedArtifacts,
      }),
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
    deliverAuthoringDraftLifecycleEvent: async ({ event }) => {
      deliveredEvents.push(event);
      return true;
    },
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/compile`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          intent: createCompileIntent(),
        }),
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(quotaCalls, [
    "partner:beach_science|/api/authoring/external/drafts/compile",
  ]);
  assert.equal(storedDraft.state, "ready");
  assert.equal(storedDraft.intent_json?.reward_total, "10");
  assert.equal(
    storedDraft.authoring_ir_json?.origin.provider,
    "beach_science",
  );
  assert.deepEqual(deliveredEvents, ["draft_compiled"]);

  const payload = (await response.json()) as {
    data: {
      card: { state: string; title: string | null };
      assessment: {
        feasible: boolean;
        publishable: boolean;
        requires_review: boolean;
        preset_id: string | null;
        execution_runtime_family: string | null;
        metric: string | null;
      };
    };
  };
  assert.equal(payload.data.card.state, "ready");
  assert.equal(payload.data.card.title, "Drug response challenge");
  assert.equal(payload.data.assessment.feasible, true);
  assert.equal(payload.data.assessment.publishable, true);
  assert.equal(payload.data.assessment.requires_review, false);
  assert.equal(payload.data.assessment.preset_id, "tabular_regression");
  assert.equal(
    payload.data.assessment.execution_runtime_family,
    "tabular_regression",
  );
  assert.equal(payload.data.assessment.metric, "r2");
});

test("authoring source draft compile rejects expired drafts", async () => {
  const storedDraft = createDraft({
    expires_at: "2020-01-01T00:00:00.000Z",
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/compile`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          intent: createCompileIntent(),
        }),
      },
    ),
  );

  assert.equal(response.status, 410);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_EXPIRED",
  );
});

test("authoring source draft compile returns busy when a compile is already in progress", async () => {
  const storedDraft = createDraft({
    state: "compiling",
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/compile`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          intent: createCompileIntent(),
        }),
      },
    ),
  );

  assert.equal(response.status, 409);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_BUSY",
  );
});

test("authoring source draft compile stays successful when callback delivery throws", async () => {
  let storedDraft = createDraft({
    source_callback_url: "https://hooks.beach.science/agora",
    source_callback_registered_at: "2026-03-18T00:05:00.000Z",
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedDraft = applyUpdate(
        storedDraft,
        patch as Record<string, unknown>,
      );
      return storedDraft as never;
    },
    compileManagedAuthoringDraftOutcome: async ({
      intent,
      uploadedArtifacts,
    }) =>
      createReadyCompileOutcome({
        intent: intent as ReturnType<typeof createCompileIntent>,
        uploadedArtifacts,
      }),
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
    deliverAuthoringDraftLifecycleEvent: async () => {
      throw new Error("callback unavailable");
    },
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/compile`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          intent: createCompileIntent(),
        }),
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(storedDraft.state, "ready");
});

test("authoring source draft publish uses the internal sponsor path and returns challenge refs", async () => {
  const intent = createCompileIntent();
  const readyOutcome = createReadyCompileOutcome({
    intent,
    uploadedArtifacts: createDraft().uploaded_artifacts_json,
  });
  let storedDraft = createDraft({
    state: "ready",
    intent_json: intent,
    authoring_ir_json: buildManagedAuthoringIr({
      intent,
      uploadedArtifacts: createDraft().uploaded_artifacts_json,
      presetId: "tabular_regression",
      metric: "r2",
      confidenceScore: 0.92,
      routingMode: "preset_supported",
      sourceMessages: [
        {
          id: "msg-1",
          role: "poster",
          content: "Beach/OpenClaw found a prediction challenge.",
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
    compilation_json: readyOutcome.compilation,
  });
  const deliveredDraftEvents: string[] = [];
  const deliveredChallengeEvents: string[] = [];

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    getPublishedChallengeLinkByDraftId: async () => null as never,
    canonicalizeChallengeSpec: async (spec) => spec as never,
    pinJSON: async () => "ipfs://challenge-spec-42",
    sponsorAndPublishAuthoringDraft: async ({
      spec,
      specCid,
      returnTo,
      sponsorMonthlyBudgetUsdc,
    }) => {
      assert.equal(specCid, "ipfs://challenge-spec-42");
      assert.equal(returnTo, "https://beach.science/thread/42?tab=publish");
      assert.equal(sponsorMonthlyBudgetUsdc, 500);
      assert.equal(spec.source?.provider, "beach_science");
      assert.equal(spec.source?.external_id, "thread-42");
      assert.equal(spec.source?.agent_handle, "lab-alpha");
      storedDraft = createDraft({
        ...storedDraft,
        state: "published",
        poster_address: "0x1111111111111111111111111111111111111111",
        published_challenge_id: "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
        published_spec_cid: specCid,
        published_spec_json: readyOutcome.compilation.challenge_spec,
      });
      return {
        draft: storedDraft,
        txHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sponsorAddress: "0x1111111111111111111111111111111111111111",
        challenge: {
          challengeId: "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
          challengeAddress: "0x2222222222222222222222222222222222222222",
          factoryChallengeId: 7,
          refs: {
            challengeId: "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
            challengeAddress: "0x2222222222222222222222222222222222222222",
            factoryAddress: "0x3333333333333333333333333333333333333333",
            factoryChallengeId: 7,
          },
        },
      };
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    readAuthoringSponsorRuntimeConfig: () => ({
      privateKey:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      monthlyBudgetsUsdc: {
        beach_science: 500,
      },
    }),
    consumeWriteQuota: allowPartnerQuota() as never,
    deliverAuthoringDraftLifecycleEvent: async ({ event }) => {
      deliveredDraftEvents.push(event);
      return true;
    },
    deliverChallengeLifecycleEvent: async ({ event }) => {
      deliveredChallengeEvents.push(event);
      return true;
    },
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          funding: "sponsor",
          return_to: "https://beach.science/thread/42?tab=publish",
        }),
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(deliveredDraftEvents, ["draft_published"]);
  assert.deepEqual(deliveredChallengeEvents, ["challenge_created"]);

  const payload = (await response.json()) as {
    data: {
      specCid: string;
      txHash: string;
      sponsorAddress: string;
      challenge: {
        challengeId: string;
        challengeAddress: string;
        factoryChallengeId: number;
      };
      draft: { state: string; published_challenge_id: string | null };
      card: { published_challenge_id: string | null };
    };
  };
  assert.equal(payload.data.specCid, "ipfs://challenge-spec-42");
  assert.equal(
    payload.data.txHash,
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(
    payload.data.sponsorAddress,
    "0x1111111111111111111111111111111111111111",
  );
  assert.equal(
    payload.data.challenge.challengeId,
    "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
  );
  assert.equal(
    payload.data.draft.published_challenge_id,
    "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
  );
  assert.equal(
    payload.data.card.published_challenge_id,
    "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
  );
  assert.equal(
    payload.data.challenge.challengeAddress,
    "0x2222222222222222222222222222222222222222",
  );
  assert.equal(payload.data.challenge.factoryChallengeId, 7);
  assert.equal(payload.data.draft.state, "published");
});

test("authoring source draft publish rejects poster funding until the self-funded path is enabled", async () => {
  const intent = createCompileIntent();
  const readyOutcome = createReadyCompileOutcome({
    intent,
    uploadedArtifacts: createDraft().uploaded_artifacts_json,
  });
  const storedDraft = createDraft({
    state: "ready",
    intent_json: intent,
    authoring_ir_json: buildManagedAuthoringIr({
      intent,
      uploadedArtifacts: createDraft().uploaded_artifacts_json,
      presetId: "tabular_regression",
      metric: "r2",
      confidenceScore: 0.92,
      routingMode: "preset_supported",
      sourceMessages: [
        {
          id: "msg-1",
          role: "poster",
          content: "Beach/OpenClaw found a prediction challenge.",
          created_at: "2026-03-18T00:00:00.000Z",
        },
      ],
      origin: {
        provider: "beach_science",
        external_id: "thread-42",
        external_url: "https://beach.science/thread/42",
        ingested_at: "2026-03-18T00:00:00.000Z",
      },
    }),
    compilation_json: readyOutcome.compilation,
  });
  let sponsorPublishCalled = false;

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    sponsorAndPublishAuthoringDraft: async () => {
      sponsorPublishCalled = true;
      throw new Error("sponsor publish should not run for poster funding");
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    readAuthoringSponsorRuntimeConfig: () => ({
      privateKey:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      monthlyBudgetsUsdc: {
        beach_science: 500,
      },
    }),
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          funding: "poster",
          poster_address: "0x00000000000000000000000000000000000000aa",
        }),
      },
    ),
  );

  assert.equal(response.status, 501);
  assert.equal(sponsorPublishCalled, false);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_EXTERNAL_POSTER_FUNDING_NOT_ENABLED",
  );
});

test("authoring source draft webhook registration persists callback metadata", async () => {
  let storedDraft = createDraft();
  const quotaCalls: string[] = [];

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedDraft as never,
    upsertAuthoringCallbackTarget: async (_db, payload) => {
      storedDraft = applyUpdate(storedDraft, {
        source_callback_url: payload.callback_url,
        source_callback_registered_at: payload.registered_at,
      });
      return {
        draft_id: storedDraft.id,
        callback_url: storedDraft.source_callback_url ?? payload.callback_url,
        registered_at:
          storedDraft.source_callback_registered_at ?? payload.registered_at,
        created_at: "2026-03-18T00:05:00.000Z",
        updated_at: "2026-03-18T00:05:00.000Z",
      } as never;
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedDraft.id}/webhook`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
          callback_url: "https://hooks.beach.science/agora",
        }),
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(quotaCalls, [
    "partner:beach_science|/api/authoring/external/drafts/webhook",
  ]);
  assert.equal(
    storedDraft.source_callback_url,
    "https://hooks.beach.science/agora",
  );
  assert.equal(typeof storedDraft.source_callback_registered_at, "string");

  const payload = (await response.json()) as {
    data: { card: { callback_registered: boolean } };
  };
  assert.equal(payload.data.card.callback_registered, true);
});

test("authoring callback sweep requires the internal review token", async () => {
  const router = createTestRouter({
    readAuthoringReviewRuntimeConfig: () => ({
      token: "review-token",
    }),
  });

  const response = await router.request(
    new Request("http://localhost/callbacks/sweep", {
      method: "POST",
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_REVIEW_UNAUTHORIZED",
  );
});

test("authoring callback sweep returns the durable delivery summary", async () => {
  const router = createTestRouter({
    readAuthoringReviewRuntimeConfig: () => ({
      token: "review-token",
    }),
    sweepPendingAuthoringDraftLifecycleEvents: async ({ limit }) =>
      ({
        due: 3,
        claimed: 3,
        delivered: 2,
        rescheduled: 1,
        exhausted: 0,
        conflicted: 0,
        limit,
      }) as never,
  });

  const response = await router.request(
    new Request("http://localhost/callbacks/sweep?limit=17", {
      method: "POST",
      headers: {
        "x-agora-review-token": "review-token",
      },
    }),
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: {
      due: number;
      claimed: number;
      delivered: number;
      rescheduled: number;
      exhausted: number;
      conflicted: number;
      limit: number;
    };
  };
  assert.deepEqual(payload.data, {
    due: 3,
    claimed: 3,
    delivered: 2,
    rescheduled: 1,
    exhausted: 0,
    conflicted: 0,
    limit: 17,
  });
});
