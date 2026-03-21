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
  type AuthoringDraftRow,
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

function createSubmitIntent() {
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

function createSession(
  overrides: Partial<AuthoringDraftRow> = {},
): AuthoringDraftRow {
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
  session: AuthoringDraftRow,
  patch: Record<string, unknown>,
): AuthoringDraftRow {
  return {
    ...session,
    ...patch,
    updated_at:
      typeof patch.updated_at === "string"
        ? patch.updated_at
        : "2026-03-18T01:00:00.000Z",
  } as AuthoringDraftRow;
}

function partnerConfig() {
  return {
    partnerKeys: {
      beach_science: "beach-secret",
    },
    callbackSecrets: {
      beach_science: "beach-secret",
    },
    returnOrigins: {
      beach_science: ["https://beach.science"],
    },
  };
}

function createReadyCompileOutcome(input: {
  intent: ReturnType<typeof createSubmitIntent>;
  uploadedArtifacts: AuthoringDraftRow["uploaded_artifacts_json"];
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
      routingMode: "managed_supported",
      origin: {
        provider: "beach_science",
        external_id: "thread-42",
        external_url: "https://beach.science/thread/42",
        ingested_at: "2026-03-18T00:00:00.000Z",
      },
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

function createSubmitBody(overrides: Record<string, unknown> = {}) {
  return {
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
        source_url: "https://cdn.beach.science/uploads/dataset.csv?download=1",
        mime_type: "text/csv",
        size_bytes: 1024,
      },
    ],
    intent: createSubmitIntent(),
    ...overrides,
  };
}

test("authoring source submit returns a specific error when auth is missing", async () => {
  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async () => ({}) as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/drafts/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createSubmitBody()),
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_SOURCE_MISSING_AUTH",
  );
});

test("authoring source submit returns a specific error for malformed bearer auth", async () => {
  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async () => ({}) as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Token beach-secret",
      },
      body: JSON.stringify(createSubmitBody()),
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_SOURCE_INVALID_AUTH_FORMAT",
  );
});

test("authoring source submit creates a partner-owned compiled draft", async () => {
  const quotaCalls: string[] = [];
  let storedSession = createSession();

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async (_db, payload) => {
      storedSession = createSession({
        state: payload.state,
        intent_json: payload.intent_json ?? null,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
        expires_at: payload.expires_at,
      });
      return storedSession as never;
    },
    getAuthoringDraftById: async () => storedSession as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = applyUpdate(
        storedSession,
        patch as Record<string, unknown>,
      );
      return storedSession as never;
    },
    compileManagedAuthoringDraftOutcome: async ({
      intent,
      uploadedArtifacts,
    }) =>
      createReadyCompileOutcome({
        intent: intent as ReturnType<typeof createSubmitIntent>,
        uploadedArtifacts,
      }),
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify(createSubmitBody()),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(quotaCalls, [
    "partner:beach_science|/api/authoring/external/drafts/submit",
  ]);
  assert.equal(storedSession.state, "ready");
  assert.equal(storedSession.intent_json?.reward_total, "10");
  assert.equal(
    storedSession.authoring_ir_json?.origin.provider,
    "beach_science",
  );

  const payload = (await response.json()) as {
    data: {
      card: { state: string; provider: string };
      assessment: {
        feasible: boolean;
        publishable: boolean;
        runtime_family: string | null;
        metric: string | null;
      };
      draft: { authoring_ir?: { origin?: { external_id?: string | null } } };
    };
  };
  assert.equal(payload.data.card.state, "ready");
  assert.equal(payload.data.card.provider, "beach_science");
  assert.equal(payload.data.assessment.feasible, true);
  assert.equal(payload.data.assessment.publishable, true);
  assert.equal(payload.data.assessment.runtime_family, "tabular_regression");
  assert.equal(payload.data.assessment.metric, "r2");
  assert.equal(
    payload.data.draft.authoring_ir?.origin?.external_id,
    "thread-42",
  );
});

test("authoring source submit refreshes an existing linked draft instead of creating a duplicate", async () => {
  let storedSession = createSession({
    state: "ready",
    intent_json: createSubmitIntent(),
  });
  let createCalled = false;

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async () => {
      createCalled = true;
      return storedSession as never;
    },
    getAuthoringDraftById: async () => storedSession as never,
    getAuthoringSourceLink: async () =>
      ({
        provider: "beach_science",
        external_id: "thread-42",
        draft_id: storedSession.id,
        external_url: "https://beach.science/thread/42",
      }) as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = applyUpdate(
        storedSession,
        patch as Record<string, unknown>,
      );
      return storedSession as never;
    },
    compileManagedAuthoringDraftOutcome: async ({
      intent,
      uploadedArtifacts,
    }) =>
      createReadyCompileOutcome({
        intent: intent as ReturnType<typeof createSubmitIntent>,
        uploadedArtifacts,
      }),
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify(
        createSubmitBody({
          title: "Updated Beach thread title",
          messages: [
            {
              id: "msg-1",
              role: "poster",
              content: "Updated deterministic challenge framing.",
            },
          ],
        }),
      ),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(createCalled, false);
  assert.equal(storedSession.state, "ready");
  assert.equal(
    storedSession.authoring_ir_json?.source.poster_messages[0]?.content,
    "Updated deterministic challenge framing.",
  );

  const payload = (await response.json()) as {
    data: { draft: { id: string; state: string } };
  };
  assert.equal(payload.data.draft.id, storedSession.id);
  assert.equal(payload.data.draft.state, "ready");
});

test("authoring source submit returns artifact normalization failures without creating a draft", async () => {
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
    new Request("http://localhost/external/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify(createSubmitBody()),
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
          content: "Direct-originated thread",
          created_at: "2026-03-18T00:00:00.000Z",
        },
      ],
      origin: {
        provider: "direct",
        external_id: "issue-1",
        external_url: null,
        ingested_at: "2026-03-18T00:00:00.000Z",
      },
    }),
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftById: async () => storedSession as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request(`http://localhost/external/drafts/${storedSession.id}`, {
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

test("authoring source submit returns busy when the linked draft is already compiling", async () => {
  const storedSession = createSession({
    state: "compiling",
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftById: async () => storedSession as never,
    getAuthoringSourceLink: async () =>
      ({
        provider: "beach_science",
        external_id: "thread-42",
        draft_id: storedSession.id,
        external_url: "https://beach.science/thread/42",
      }) as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify(createSubmitBody()),
    }),
  );

  assert.equal(response.status, 409);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_BUSY",
  );
});

test("authoring source submit returns a conflict when the draft changed concurrently", async () => {
  const storedSession = createSession({
    intent_json: createSubmitIntent(),
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftById: async () => storedSession as never,
    getAuthoringSourceLink: async () =>
      ({
        provider: "beach_science",
        external_id: "thread-42",
        draft_id: storedSession.id,
        external_url: "https://beach.science/thread/42",
      }) as never,
    updateAuthoringDraft: async () => {
      throw new AuthoringDraftWriteConflictError("stale");
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/external/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify(createSubmitBody()),
    }),
  );

  assert.equal(response.status, 409);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_CONFLICT",
  );
});

test("authoring source submit stays successful when callback delivery throws", async () => {
  let storedSession = createSession({
    source_callback_url: "https://hooks.beach.science/agora",
    source_callback_registered_at: "2026-03-18T00:05:00.000Z",
  });

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async (_db, payload) => {
      storedSession = createSession({
        state: payload.state,
        intent_json: payload.intent_json ?? null,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
        expires_at: payload.expires_at,
        source_callback_url: storedSession.source_callback_url,
        source_callback_registered_at:
          storedSession.source_callback_registered_at,
      });
      return storedSession as never;
    },
    getAuthoringDraftById: async () => storedSession as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = applyUpdate(
        storedSession,
        patch as Record<string, unknown>,
      );
      return storedSession as never;
    },
    compileManagedAuthoringDraftOutcome: async ({
      intent,
      uploadedArtifacts,
    }) =>
      createReadyCompileOutcome({
        intent: intent as ReturnType<typeof createSubmitIntent>,
        uploadedArtifacts,
      }),
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
    deliverAuthoringDraftLifecycleEvent: async () => {
      throw new Error("callback unavailable");
    },
  });

  const response = await router.request(
    new Request("http://localhost/external/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify(createSubmitBody()),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(storedSession.state, "ready");
});

test("authoring source draft publish uses the internal sponsor path and returns challenge refs", async () => {
  const intent = createSubmitIntent();
  const readyOutcome = createReadyCompileOutcome({
    intent,
    uploadedArtifacts: createSession().uploaded_artifacts_json,
  });
  let storedSession = createSession({
    state: "ready",
    intent_json: intent,
    authoring_ir_json: buildManagedAuthoringIr({
      intent,
      uploadedArtifacts: createSession().uploaded_artifacts_json,
      runtimeFamily: "tabular_regression",
      metric: "r2",
      routingMode: "managed_supported",
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
    getAuthoringDraftById: async () => storedSession as never,
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
      storedSession = createSession({
        ...storedSession,
        state: "published",
        poster_address: "0x1111111111111111111111111111111111111111",
        published_challenge_id: "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
        published_spec_cid: specCid,
        published_spec_json: readyOutcome.compilation.challenge_spec,
      });
      return {
        draft: storedSession,
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
      `http://localhost/external/drafts/${storedSession.id}/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer beach-secret",
        },
        body: JSON.stringify({
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

test("authoring source draft webhook registration persists callback metadata", async () => {
  let storedSession = createSession();
  const quotaCalls: string[] = [];

  const router = createTestRouter({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftById: async () => storedSession as never,
    updateAuthoringDraft: async (_db, payload) => {
      storedSession = applyUpdate(storedSession, {
        source_callback_url: payload.source_callback_url,
        source_callback_registered_at: payload.source_callback_registered_at,
      });
      return storedSession as never;
    },
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
  });

  const response = await router.request(
    new Request(
      `http://localhost/external/drafts/${storedSession.id}/webhook`,
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
    storedSession.source_callback_url,
    "https://hooks.beach.science/agora",
  );
  assert.equal(typeof storedSession.source_callback_registered_at, "string");

  const payload = (await response.json()) as {
    data: { card: { callback_registered: boolean } };
  };
  assert.equal(payload.data.card.callback_registered, true);
});

test("authoring callback sweep requires the internal operator token", async () => {
  const router = createTestRouter({
    readAuthoringOperatorRuntimeConfig: () => ({
      token: "operator-token",
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
    "AUTHORING_OPERATOR_UNAUTHORIZED",
  );
});

test("authoring callback sweep returns the durable delivery summary", async () => {
  const router = createTestRouter({
    readAuthoringOperatorRuntimeConfig: () => ({
      token: "operator-token",
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
        "x-agora-operator-token": "operator-token",
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
