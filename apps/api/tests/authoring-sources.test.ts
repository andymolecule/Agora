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
  type AuthoringDraftViewRow as PostingSessionRow,
  AuthoringDraftWriteConflictError as PostingSessionWriteConflictError,
} from "@agora/db";
import { buildClarificationQuestionsFromAuthoringIr } from "../src/lib/managed-authoring-ir.js";
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

function createSession(
  overrides: Partial<PostingSessionRow> = {},
): PostingSessionRow {
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
    clarification_questions_json:
      overrides.clarification_questions_json ??
      buildClarificationQuestionsFromAuthoringIr(authoringIr),
    review_summary_json: overrides.review_summary_json ?? null,
    approved_confirmation_json: overrides.approved_confirmation_json ?? null,
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
    ...dependencies,
  });
}

function applyUpdate(
  session: PostingSessionRow,
  patch: Record<string, unknown>,
): PostingSessionRow {
  return {
    ...session,
    ...patch,
    updated_at:
      typeof patch.updated_at === "string"
        ? patch.updated_at
        : "2026-03-18T01:00:00.000Z",
  } as PostingSessionRow;
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
  uploadedArtifacts: PostingSessionRow["uploaded_artifacts_json"];
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
      runtimeFamily: "tabular_regression",
      metric: "r2",
      confidenceScore: 0.92,
      routingMode: "managed_supported",
    }),
    compilation: {
      challenge_type: "prediction" as const,
      runtime_family: "tabular_regression" as const,
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
        schema_version: 3 as const,
        id: "draft-1",
        title: input.intent.title,
        description: input.intent.description,
        domain: input.intent.domain,
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
    new Request("http://localhost/sources", {
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
    new Request("http://localhost/sources", {
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
  let storedSession = createSession();

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async (_db, payload) => {
      capturedPayload = payload as Record<string, unknown>;
      storedSession = createSession({
        state: payload.state,
        intent_json: payload.intent_json ?? null,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
        expires_at: payload.expires_at,
      });
      return storedSession as never;
    },
    getAuthoringDraftViewById: async () => storedSession as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
  });

  const response = await router.request(
    new Request("http://localhost/sources", {
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
    "partner:beach_science|/api/authoring/sources",
  ]);
  assert.equal(
    (
      capturedPayload?.authoring_ir_json as {
        origin?: { provider?: string; external_id?: string | null };
      }
    ).origin?.provider,
    "beach_science",
  );
  assert.equal(capturedPayload?.clarification_questions_json, undefined);

  const payload = (await response.json()) as {
    data: {
      session: {
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
    payload.data.session.authoring_ir?.origin?.external_id,
    "thread-42",
  );
  assert.equal(payload.data.card.draft_id, createSession().id);
  assert.equal(payload.data.card.provider, "beach_science");
  assert.equal(payload.data.card.clarification_count > 0, true);
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
    new Request("http://localhost/sources", {
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
  const storedSession = createSession({
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
    getAuthoringDraftViewById: async () => storedSession as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(`http://localhost/drafts/${storedSession.id}`, {
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
  let storedSession = createSession({
    source_callback_url: "https://hooks.beach.science/agora",
    source_callback_registered_at: "2026-03-18T00:05:00.000Z",
  });
  const quotaCalls: string[] = [];
  const deliveredEvents: Array<{ event: string; state: string }> = [];

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedSession as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = applyUpdate(
        storedSession,
        patch as Record<string, unknown>,
      );
      return storedSession as never;
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
    deliverAuthoringDraftLifecycleEvent: async ({ event, session }) => {
      deliveredEvents.push({ event, state: session.state });
      return true;
    },
  });

  const response = await router.request(
    new Request(`http://localhost/drafts/${storedSession.id}/clarify`, {
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
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(quotaCalls, [
    "partner:beach_science|/api/authoring/drafts/clarify",
  ]);
  assert.equal(storedSession.state, "draft");
  assert.equal(storedSession.uploaded_artifacts_json.length, 2);
  assert.equal(
    storedSession.authoring_ir_json?.origin.raw_context?.revision,
    "rev-8",
  );
  assert.equal(
    storedSession.authoring_ir_json?.source.poster_messages.length,
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
  let storedSession = createSession();

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedSession as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = applyUpdate(
        storedSession,
        patch as Record<string, unknown>,
      );
      return storedSession as never;
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(`http://localhost/drafts/${storedSession.id}/clarify`, {
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
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(
    storedSession.authoring_ir_json?.source.poster_messages.length,
    1,
  );
  assert.equal(storedSession.uploaded_artifacts_json.length, 1);
  assert.equal(
    storedSession.uploaded_artifacts_json[0]?.file_name,
    "dataset.csv",
  );
});

test("authoring source draft clarify returns a conflict when the draft changed concurrently", async () => {
  const storedSession = createSession();

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedSession as never,
    updateAuthoringDraft: async () => {
      throw new PostingSessionWriteConflictError("stale");
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(`http://localhost/drafts/${storedSession.id}/clarify`, {
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
    }),
  );

  assert.equal(response.status, 409);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_CONFLICT",
  );
});

test("authoring source draft clarify stays successful when callback delivery throws", async () => {
  let storedSession = createSession({
    source_callback_url: "https://hooks.beach.science/agora",
    source_callback_registered_at: "2026-03-18T00:05:00.000Z",
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedSession as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = applyUpdate(
        storedSession,
        patch as Record<string, unknown>,
      );
      return storedSession as never;
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
    deliverAuthoringDraftLifecycleEvent: async () => {
      throw new Error("callback unavailable");
    },
  });

  const response = await router.request(
    new Request(`http://localhost/drafts/${storedSession.id}/clarify`, {
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
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(storedSession.state, "draft");
});

test("authoring source draft compile reuses stored artifacts and dispatches compile callbacks", async () => {
  let storedSession = createSession({
    source_callback_url: "https://hooks.beach.science/agora",
    source_callback_registered_at: "2026-03-18T00:05:00.000Z",
  });
  const quotaCalls: string[] = [];
  const deliveredEvents: string[] = [];

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedSession as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = applyUpdate(
        storedSession,
        patch as Record<string, unknown>,
      );
      return storedSession as never;
    },
    compileManagedAuthoringPostingSession: async ({
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
    new Request(`http://localhost/drafts/${storedSession.id}/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        intent: createCompileIntent(),
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(quotaCalls, [
    "partner:beach_science|/api/authoring/drafts/compile",
  ]);
  assert.equal(storedSession.state, "ready");
  assert.equal(storedSession.intent_json?.reward_total, "10");
  assert.equal(
    storedSession.authoring_ir_json?.origin.provider,
    "beach_science",
  );
  assert.deepEqual(deliveredEvents, ["draft_compiled"]);

  const payload = (await response.json()) as {
    data: {
      card: { state: string; title: string | null };
    };
  };
  assert.equal(payload.data.card.state, "ready");
  assert.equal(payload.data.card.title, "Drug response challenge");
});

test("authoring source draft compile rejects expired drafts", async () => {
  const storedSession = createSession({
    expires_at: "2020-01-01T00:00:00.000Z",
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedSession as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(`http://localhost/drafts/${storedSession.id}/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        intent: createCompileIntent(),
      }),
    }),
  );

  assert.equal(response.status, 410);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_EXPIRED",
  );
});

test("authoring source draft compile returns busy when a compile is already in progress", async () => {
  const storedSession = createSession({
    state: "compiling",
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedSession as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(`http://localhost/drafts/${storedSession.id}/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        intent: createCompileIntent(),
      }),
    }),
  );

  assert.equal(response.status, 409);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_BUSY",
  );
});

test("authoring source draft compile stays successful when callback delivery throws", async () => {
  let storedSession = createSession({
    source_callback_url: "https://hooks.beach.science/agora",
    source_callback_registered_at: "2026-03-18T00:05:00.000Z",
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedSession as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = applyUpdate(
        storedSession,
        patch as Record<string, unknown>,
      );
      return storedSession as never;
    },
    compileManagedAuthoringPostingSession: async ({
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
    new Request(`http://localhost/drafts/${storedSession.id}/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        intent: createCompileIntent(),
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(storedSession.state, "ready");
});

test("authoring source draft webhook registration persists callback metadata", async () => {
  let storedSession = createSession();
  const quotaCalls: string[] = [];

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftViewById: async () => storedSession as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = applyUpdate(
        storedSession,
        patch as Record<string, unknown>,
      );
      return storedSession as never;
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
  });

  const response = await router.request(
    new Request(`http://localhost/drafts/${storedSession.id}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        callback_url: "https://hooks.beach.science/agora",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(quotaCalls, [
    "partner:beach_science|/api/authoring/drafts/webhook",
  ]);
  assert.equal(
    storedSession.source_callback_url,
    "https://hooks.beach.science/agora",
  );
  assert.equal(typeof storedSession.source_callback_registered_at, "string");

  const payload = (await response.json()) as {
    data: { card: { callback_registered: boolean } };
  };
  assert.equal(payload.data.card.callback_registered, true);
});

test("authoring callback sweep requires the internal review token", async () => {
  const router = createTestRouter({
    readPostingReviewRuntimeConfig: () => ({
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
    "POSTING_REVIEW_UNAUTHORIZED",
  );
});

test("authoring callback sweep returns the durable delivery summary", async () => {
  const router = createTestRouter({
    readPostingReviewRuntimeConfig: () => ({
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
