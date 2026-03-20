import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createCsvTableSubmissionContract,
  lookupManagedRuntimeFamily,
} from "@agora/common";
import type { AuthoringDraftRow } from "@agora/db";
import { buildManagedAuthoringIr } from "../src/lib/managed-authoring-ir.js";
import { createBeachIntegrationsRouter } from "../src/routes/integrations-beach.js";

function allowPartnerQuota(calls?: string[]) {
  return (key: string, routeKey: string) => {
    calls?.push(`${key}|${routeKey}`);
    return { allowed: true } as const;
  };
}

function buildStubArtifactFromSourceUrl(sourceUrl: string) {
  const digest = createHash("sha256").update(sourceUrl).digest("hex");
  return {
    id: `external-${digest.slice(0, 12)}`,
    uri: `ipfs://${digest.slice(0, 24)}`,
    file_name: new URL(sourceUrl).pathname.split("/").pop() ?? "artifact",
    mime_type: "text/csv",
    size_bytes: 1024,
  };
}

function createIntent() {
  return {
    title: "Beach prediction bounty",
    description: "Predict held-out values from the provided benchmark.",
    payout_condition: "Highest R2 wins.",
    reward_total: "10",
    distribution: "winner_take_all" as const,
    deadline: "2026-03-25T00:00:00.000Z",
    domain: "other" as const,
    tags: [],
    timezone: "UTC",
  };
}

function createSession(
  overrides: Partial<AuthoringDraftRow> = {},
): AuthoringDraftRow {
  const uploadedArtifacts = overrides.uploaded_artifacts_json ?? [
    buildStubArtifactFromSourceUrl(
      "https://cdn.beach.science/uploads/train.csv",
    ),
  ];
  const authoringIr =
    overrides.authoring_ir_json ??
    buildManagedAuthoringIr({
      intent: overrides.intent_json ?? createIntent(),
      uploadedArtifacts,
      runtimeFamily: "tabular_regression",
      metric: "r2",
      routingMode: "managed_supported",
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
    state: overrides.state ?? "ready",
    intent_json: overrides.intent_json ?? createIntent(),
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

function partnerConfig() {
  return {
    partnerKeys: {
      beach_science: "beach-secret",
    },
    callbackSecrets: {
      beach_science: "beach-callback-secret",
    },
    returnOrigins: {
      beach_science: ["https://beach.science"],
    },
  };
}

function createReadyCompileOutcome(session: AuthoringDraftRow) {
  if (!session.authoring_ir_json) {
    throw new Error("missing authoring IR fixture");
  }
  const runtimeFamily = lookupManagedRuntimeFamily("tabular_regression");
  if (!runtimeFamily) {
    throw new Error("missing runtime family fixture");
  }
  const submissionContract = createCsvTableSubmissionContract({
    requiredColumns: ["id", "prediction"],
    idColumn: "id",
    valueColumn: "prediction",
  });
  return {
    state: "ready",
    authoringIr: session.authoring_ir_json,
    compilation: {
      challenge_type: "prediction",
      runtime_family: "tabular_regression",
      metric: "r2",
      resolved_artifacts: [
        {
          role: "training_data",
          visibility: "public",
          uri: session.uploaded_artifacts_json[0]?.uri ?? "ipfs://train",
        },
      ],
      submission_contract: submissionContract,
      dry_run: {
        status: "validated",
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
        schema_version: 3,
        id: "draft-1",
        title: session.intent_json?.title ?? "Beach prediction bounty",
        description:
          session.intent_json?.description ??
          "Predict held-out values from the provided benchmark.",
        domain: session.intent_json?.domain ?? "other",
        type: "prediction",
        evaluation: {
          runtime_family: "tabular_regression",
          metric: "r2",
          scorer_image: runtimeFamily.scorerImage,
          evaluation_bundle: "ipfs://bundle",
        },
        artifacts: [
          {
            role: "training_data",
            visibility: "public",
            uri: session.uploaded_artifacts_json[0]?.uri ?? "ipfs://train",
          },
        ],
        submission_contract: submissionContract,
        reward: {
          total: session.intent_json?.reward_total ?? "10",
          distribution: session.intent_json?.distribution ?? "winner_take_all",
        },
        deadline: session.intent_json?.deadline ?? "2026-03-25T00:00:00.000Z",
        tags: [],
      },
    },
    message: "ready",
  };
}

test("beach integration submits a thread into a beach-owned compiled draft", async () => {
  const quotaCalls: string[] = [];
  let storedSession = createSession({ state: "draft", intent_json: null });

  const router = createBeachIntegrationsRouter({
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
    normalizeExternalArtifactsForDraft: async ({ artifacts }) =>
      artifacts.map((artifact) =>
        buildStubArtifactFromSourceUrl(artifact.source_url),
      ),
    updateAuthoringDraft: async (_db, patch) => {
      storedSession = {
        ...storedSession,
        ...patch,
        updated_at: "2026-03-18T01:00:00.000Z",
      } as AuthoringDraftRow;
      return storedSession as never;
    },
    compileManagedAuthoringDraftOutcome: async () =>
      createReadyCompileOutcome(createSession()) as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        thread: {
          id: "thread-42",
          url: "https://beach.science/thread/42",
          title: "Find a good challenge framing",
          poster_agent_handle: "lab-alpha",
        },
        intent: createIntent(),
        raw_context: {
          revision: "rev-7",
        },
        messages: [
          {
            id: "msg-1",
            body: "We have a hidden benchmark and want the best predictions.",
            author_handle: "lab-alpha",
            kind: "post",
          },
          {
            id: "msg-2",
            body: "Solvers should submit a CSV with id and prediction.",
            author_handle: "agent-beta",
            kind: "reply",
          },
        ],
        artifacts: [
          {
            url: "https://cdn.beach.science/uploads/train.csv",
            mime_type: "text/csv",
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(quotaCalls, [
    "partner:beach_science|/api/integrations/beach/drafts/submit",
  ]);

  const payload = (await response.json()) as {
    data: {
      thread: { id: string; url: string; poster_agent_handle: string | null };
      card: { provider: string; state: string };
      draft: {
        authoring_ir?: {
          origin?: {
            provider?: string;
            external_id?: string | null;
            raw_context?: Record<string, unknown> | null;
          };
        };
      };
      assessment: {
        publishable: boolean;
        runtime_family: string | null;
        metric: string | null;
      };
    };
  };
  assert.equal(payload.data.thread.id, "thread-42");
  assert.equal(payload.data.thread.url, "https://beach.science/thread/42");
  assert.equal(payload.data.thread.poster_agent_handle, "lab-alpha");
  assert.equal(payload.data.card.provider, "beach_science");
  assert.equal(payload.data.card.state, "ready");
  assert.equal(
    payload.data.draft.authoring_ir?.origin?.provider,
    "beach_science",
  );
  assert.equal(
    payload.data.draft.authoring_ir?.origin?.external_id,
    "thread-42",
  );
  assert.equal(
    payload.data.draft.authoring_ir?.origin?.raw_context?.revision,
    "rev-7",
  );
  assert.equal(payload.data.assessment.publishable, true);
  assert.equal(payload.data.assessment.runtime_family, "tabular_regression");
  assert.equal(payload.data.assessment.metric, "r2");
});

test("beach integration rejects unknown partner keys", async () => {
  const router = createBeachIntegrationsRouter({
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-secret",
      },
      body: JSON.stringify({
        thread: {
          id: "thread-42",
          url: "https://beach.science/thread/42",
        },
        intent: createIntent(),
        messages: [
          {
            id: "msg-1",
            body: "We want a challenge.",
            authored_by_poster: true,
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_SOURCE_INVALID_TOKEN",
  );
});

test("beach integration validates that a poster-authored message is present", async () => {
  const router = createBeachIntegrationsRouter({
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        thread: {
          id: "thread-42",
          url: "https://beach.science/thread/42",
          poster_agent_handle: "lab-alpha",
        },
        intent: createIntent(),
        messages: [
          {
            id: "msg-1",
            body: "A participant asked a question.",
            author_handle: "agent-beta",
            kind: "reply",
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "VALIDATION_ERROR",
  );
});

test("beach integration returns rate-limit errors for repeated submit traffic", async () => {
  const router = createBeachIntegrationsRouter({
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: () =>
      ({
        allowed: false,
        message: "Rate limit exceeded",
        retryAfterSec: 60,
      }) as const,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer beach-secret",
      },
      body: JSON.stringify({
        thread: {
          id: "thread-42",
          url: "https://beach.science/thread/42",
        },
        intent: createIntent(),
        messages: [
          {
            id: "msg-1",
            body: "We want a challenge.",
            authored_by_poster: true,
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "RATE_LIMITED",
  );
});
