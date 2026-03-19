import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { PostingSessionRow } from "@agora/db";
import { buildClarificationQuestionsFromAuthoringIr } from "../src/lib/managed-authoring-ir.js";
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

function createSession(
  overrides: Partial<PostingSessionRow> = {},
): PostingSessionRow {
  const uploadedArtifacts = overrides.uploaded_artifacts_json ?? [
    buildStubArtifactFromSourceUrl(
      "https://cdn.beach.science/uploads/train.csv",
    ),
  ];
  const authoringIr =
    overrides.authoring_ir_json ??
    buildManagedAuthoringIr({
      intent: overrides.intent_json ?? null,
      uploadedArtifacts,
      sourceTitle: "Beach title",
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

function partnerConfig() {
  return {
    partnerKeys: {
      beach_science: "beach-secret",
      github: "github-secret",
    },
    callbackSecrets: {
      beach_science: "beach-callback-secret",
      github: "github-secret",
    },
    returnOrigins: {
      beach_science: ["https://beach.science"],
      github: ["https://github.com"],
    },
  };
}

test("beach integration imports a thread into a beach-owned authoring draft", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const quotaCalls: string[] = [];

  const router = createBeachIntegrationsRouter({
    createSupabaseClient: () => ({}) as never,
    createPostingSession: async (_db, payload) => {
      capturedPayload = payload as Record<string, unknown>;
      return createSession({
        state: payload.state,
        intent_json: payload.intent_json ?? null,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
        clarification_questions_json:
          payload.clarification_questions_json ?? [],
        expires_at: payload.expires_at,
      });
    },
    normalizeExternalArtifactsForDraft: async ({ artifacts }) =>
      artifacts.map((artifact) =>
        buildStubArtifactFromSourceUrl(artifact.source_url),
      ),
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota(quotaCalls) as never,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/import", {
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
    "partner:beach_science|/api/integrations/beach/drafts/import",
  ]);
  const authoringIr = capturedPayload?.authoring_ir_json as
    | {
        origin?: {
          provider?: string;
          external_id?: string | null;
          raw_context?: Record<string, unknown> | null;
        };
        source?: {
          poster_messages?: Array<{ role: string; author_handle?: string }>;
        };
      }
    | undefined;
  assert.equal(authoringIr?.origin?.provider, "beach_science");
  assert.equal(authoringIr?.origin?.external_id, "thread-42");
  assert.equal(authoringIr?.origin?.raw_context?.revision, "rev-7");
  assert.equal(
    authoringIr?.origin?.raw_context?.beach_poster_agent_handle,
    "lab-alpha",
  );
  assert.deepEqual(
    authoringIr?.source?.poster_messages?.map((message) => message.role),
    ["poster", "participant"],
  );

  const payload = (await response.json()) as {
    data: {
      thread: { id: string; url: string; poster_agent_handle: string | null };
      card: { provider: string };
      session: { authoring_ir?: { origin?: { provider?: string } } };
    };
  };
  assert.equal(payload.data.thread.id, "thread-42");
  assert.equal(payload.data.thread.url, "https://beach.science/thread/42");
  assert.equal(payload.data.thread.poster_agent_handle, "lab-alpha");
  assert.equal(payload.data.card.provider, "beach_science");
  assert.equal(
    payload.data.session.authoring_ir?.origin?.provider,
    "beach_science",
  );
});

test("beach integration rejects non-beach partner keys", async () => {
  const router = createBeachIntegrationsRouter({
    createSupabaseClient: () => ({}) as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer github-secret",
      },
      body: JSON.stringify({
        thread: {
          id: "thread-42",
          url: "https://beach.science/thread/42",
        },
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

  assert.equal(response.status, 403);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_SOURCE_PROVIDER_MISMATCH",
  );
});

test("beach integration validates that a poster-authored message is present", async () => {
  const router = createBeachIntegrationsRouter({
    createSupabaseClient: () => ({}) as never,
    readAuthoringPartnerRuntimeConfig: partnerConfig,
    consumeWriteQuota: allowPartnerQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/import", {
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
        messages: [
          {
            id: "msg-1",
            body: "I have a suggestion from the sidelines.",
            author_handle: "agent-beta",
            kind: "reply",
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 400);
  const payload = (await response.json()) as {
    code: string;
    issues?: Array<{ message?: string }>;
  };
  assert.equal(payload.code, "VALIDATION_ERROR");
});
