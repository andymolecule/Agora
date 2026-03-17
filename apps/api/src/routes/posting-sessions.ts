import { getPublicClient } from "@agora/chain";
import {
  canonicalizeChallengeSpec,
  compilePostingSessionRequestSchema,
  computeSpecHash,
  createPostingSessionRequestSchema,
  getPinSpecAuthorizationTypedData,
  postingSessionSchema,
  publishPostingSessionRequestSchema,
  readPostingReviewRuntimeConfig,
  readApiServerRuntimeConfig,
  reviewPostingSessionDecisionRequestSchema,
} from "@agora/common";
import {
  createPostingSession,
  createSupabaseClient,
  getPostingSessionById,
  listPostingSessionsByState,
  purgeExpiredPostingSessions,
  readPostingSessionHealthSnapshot,
  updatePostingSession,
} from "@agora/db";
import { pinJSON } from "@agora/ipfs";
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { jsonError } from "../lib/api-error.js";
import { consumeNonce } from "../lib/auth-store.js";
import { compileManagedAuthoringPostingSession } from "../lib/managed-authoring.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import {
  POSTING_STALE_COMPILING_THRESHOLD_MS,
  buildPostingHealthResponse,
} from "./posting-health-shared.js";
import {
  getPostingSessionOwnershipError,
  normalizePosterAddress,
  resolvePostingSessionPosterAddress,
} from "./posting-session-ownership.js";
import type { ApiEnv } from "../types.js";

const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const READY_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLISHED_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const REVIEW_HEADER_NAME = "x-agora-review-token";

const router = new Hono<ApiEnv>();

function buildExpiry(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function isPostingSessionExpired(
  session: { expires_at: string },
  nowMs = Date.now(),
) {
  const expiresAtMs = new Date(session.expires_at).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }
  return expiresAtMs <= nowMs;
}

function toPostingSessionPayload(row: Awaited<ReturnType<typeof getPostingSessionById>>) {
  if (!row) {
    return null;
  }

  return postingSessionSchema.parse({
    id: row.id,
    poster_address: row.poster_address ?? null,
    state: row.state,
    intent: row.intent_json ?? null,
    uploaded_artifacts: row.uploaded_artifacts_json ?? [],
    compilation: row.compilation_json ?? null,
    clarification_questions: row.clarification_questions_json ?? [],
    review_summary: row.review_summary_json ?? null,
    approved_confirmation: row.approved_confirmation_json ?? null,
    published_spec_cid: row.published_spec_cid ?? null,
    published_spec: row.published_spec_json ?? null,
    failure_message: row.failure_message ?? null,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function requirePostingReviewAccess(c: Context<ApiEnv>) {
  const runtime = readPostingReviewRuntimeConfig();
  if (!runtime.token) {
    return jsonError(c, {
      status: 503,
      code: "POSTING_REVIEW_DISABLED",
      message:
        "Posting review access is not configured. Next step: set AGORA_POSTING_REVIEW_TOKEN on the API and web services, then retry.",
    });
  }

  const providedToken = c.req.header(REVIEW_HEADER_NAME);
  if (providedToken !== runtime.token) {
    return jsonError(c, {
      status: 401,
      code: "POSTING_REVIEW_UNAUTHORIZED",
      message:
        "Posting review access denied. Next step: open the internal review surface or provide a valid review token.",
    });
  }

  return null;
}

function expiredPostingSessionError(c: Context<ApiEnv>) {
  return jsonError(c, {
    status: 410,
    code: "POSTING_SESSION_EXPIRED",
    message:
      "Posting session expired. Next step: start a new draft or use the published challenge spec if this draft was already posted.",
  });
}

router.get("/health", async (c) => {
  const db = createSupabaseClient(true);
  const checkedAt = new Date().toISOString();
  const snapshot = await readPostingSessionHealthSnapshot(db, {
    nowIso: checkedAt,
    staleCompilingAfterMs: POSTING_STALE_COMPILING_THRESHOLD_MS,
  });

  return c.json({
    data: buildPostingHealthResponse({
      checkedAt,
      ...snapshot,
    }),
  });
});

router.post(
  "/sessions",
  requireWriteQuota("/api/posting/sessions"),
  zValidator("json", createPostingSessionRequestSchema),
  async (c) => {
    const body = c.req.valid("json");
    const db = createSupabaseClient(true);
    const session = await createPostingSession(db, {
      poster_address: normalizePosterAddress(body.poster_address),
      state: "draft",
      intent_json: body.intent ?? null,
      uploaded_artifacts_json: body.uploaded_artifacts ?? [],
      clarification_questions_json: [],
      review_summary_json: null,
      expires_at: buildExpiry(DRAFT_EXPIRY_MS),
    });

    return c.json({
      data: {
        session: toPostingSessionPayload(session),
      },
    });
  },
);

router.get("/sessions/:id", async (c) => {
  const db = createSupabaseClient(true);
  const session = await getPostingSessionById(db, c.req.param("id"));
  if (!session) {
    return jsonError(c, {
      status: 404,
      code: "POSTING_SESSION_NOT_FOUND",
      message:
        "Posting session not found. Next step: start a new draft and retry.",
    });
  }
  if (isPostingSessionExpired(session)) {
    return expiredPostingSessionError(c);
  }

  return c.json({
    data: {
      session: toPostingSessionPayload(session),
    },
  });
});

router.post(
  "/sessions/:id/compile",
  requireWriteQuota("/api/posting/sessions/compile"),
  zValidator("json", compilePostingSessionRequestSchema),
  async (c) => {
    const sessionId = c.req.param("id");
    const body = c.req.valid("json");
    const db = createSupabaseClient(true);
    const existingSession = await getPostingSessionById(db, sessionId);

    if (!existingSession) {
      return jsonError(c, {
        status: 404,
        code: "POSTING_SESSION_NOT_FOUND",
        message:
          "Posting session not found. Next step: start a new draft and retry.",
      });
    }
    if (isPostingSessionExpired(existingSession)) {
      return expiredPostingSessionError(c);
    }

    const requesterAddress = normalizePosterAddress(body.poster_address);
    const ownershipError = getPostingSessionOwnershipError({
      sessionPosterAddress: existingSession.poster_address,
      requesterAddress,
      action: "compile",
    });
    if (ownershipError) {
      return jsonError(c, ownershipError);
    }

    const intent = body.intent ?? existingSession.intent_json;
    if (!intent) {
      return jsonError(c, {
        status: 400,
        code: "POSTING_INTENT_REQUIRED",
        message:
          "Managed authoring requires a title, description, payout condition, reward, and deadline. Next step: fill in the draft and retry.",
      });
    }

    const uploadedArtifacts =
      body.uploaded_artifacts ?? existingSession.uploaded_artifacts_json ?? [];
    const resolvedPosterAddress = resolvePostingSessionPosterAddress({
      sessionPosterAddress: existingSession.poster_address,
      requesterAddress,
    });

    await updatePostingSession(db, {
      id: sessionId,
      poster_address: resolvedPosterAddress,
      state: "compiling",
      intent_json: intent,
      uploaded_artifacts_json: uploadedArtifacts,
      compilation_json: null,
      clarification_questions_json: [],
      review_summary_json: null,
      failure_message: null,
      expires_at: buildExpiry(DRAFT_EXPIRY_MS),
    });

    try {
      const outcome = await compileManagedAuthoringPostingSession({
        intent,
        uploadedArtifacts,
      });

      const updatedSession = await updatePostingSession(db, {
        id: sessionId,
        poster_address: resolvedPosterAddress,
        state: outcome.state,
        intent_json: intent,
        uploaded_artifacts_json: uploadedArtifacts,
        compilation_json: outcome.compilation ?? null,
        clarification_questions_json: outcome.clarificationQuestions ?? [],
        review_summary_json: outcome.reviewSummary ?? null,
        failure_message: null,
        expires_at: buildExpiry(
          outcome.state === "ready" || outcome.state === "needs_review"
            ? READY_EXPIRY_MS
            : DRAFT_EXPIRY_MS,
        ),
      });

      return c.json({
        data: {
          session: toPostingSessionPayload(updatedSession),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updatePostingSession(db, {
        id: sessionId,
        poster_address: resolvedPosterAddress,
        state: "failed",
        intent_json: intent,
        uploaded_artifacts_json: uploadedArtifacts,
        compilation_json: null,
        clarification_questions_json: [],
        review_summary_json: null,
        failure_message: message,
        expires_at: buildExpiry(DRAFT_EXPIRY_MS),
      });

      return jsonError(c, {
        status: 422,
        code: "POSTING_COMPILE_FAILED",
        message,
      });
    }
  },
);

router.post(
  "/sessions/:id/publish",
  requireWriteQuota("/api/posting/sessions/publish"),
  zValidator("json", publishPostingSessionRequestSchema),
  async (c) => {
    const sessionId = c.req.param("id");
    const body = c.req.valid("json");
    const db = createSupabaseClient(true);
    const session = await getPostingSessionById(db, sessionId);

    if (!session) {
      return jsonError(c, {
        status: 404,
        code: "POSTING_SESSION_NOT_FOUND",
        message:
          "Posting session not found. Next step: start a new draft and retry.",
      });
    }
    if (isPostingSessionExpired(session)) {
      return expiredPostingSessionError(c);
    }

    const signerAddress = normalizePosterAddress(body.auth.address);
    const ownershipError = getPostingSessionOwnershipError({
      sessionPosterAddress: session.poster_address,
      requesterAddress: signerAddress,
      action: "publish",
    });
    if (ownershipError) {
      return jsonError(c, ownershipError);
    }

    if (session.state === "published" && session.published_spec_cid) {
      return c.json({
        data: {
          session: toPostingSessionPayload(session),
          specCid: session.published_spec_cid,
          spec: session.published_spec_json ?? session.compilation_json?.challenge_spec,
        },
      });
    }

    if (session.state !== "ready" || !session.compilation_json) {
      return jsonError(c, {
        status: 409,
        code: "POSTING_SESSION_NOT_READY",
        message:
          "Posting session is not ready to publish. Next step: compile the draft successfully before publishing.",
      });
    }

    const runtimeConfig = readApiServerRuntimeConfig();
    const canonicalSpec = await canonicalizeChallengeSpec(
      session.compilation_json.challenge_spec,
    );
    const expectedSpecHash = computeSpecHash(canonicalSpec);
    if (body.auth.specHash !== expectedSpecHash) {
      return jsonError(c, {
        status: 401,
        code: "SPEC_HASH_MISMATCH",
        message:
          "Pinned challenge spec hash mismatch. Next step: re-sign the publish request and retry.",
      });
    }

    const publicClient = getPublicClient();
    const typedData = getPinSpecAuthorizationTypedData({
      chainId: runtimeConfig.chainId,
      wallet: signerAddress as `0x${string}`,
      specHash: expectedSpecHash,
      nonce: body.auth.nonce,
    });
    const isValidSignature = await publicClient.verifyTypedData({
      address: signerAddress as `0x${string}`,
      ...typedData,
      signature: body.auth.signature as `0x${string}`,
    });

    if (!isValidSignature) {
      return jsonError(c, {
        status: 401,
        code: "PIN_SIGNATURE_INVALID",
        message:
          "Invalid publish signature. Next step: sign the publish request again and retry.",
      });
    }

    const nonceAccepted = await consumeNonce(
      "pin_spec",
      body.auth.nonce,
      signerAddress as `0x${string}`,
    );
    if (!nonceAccepted) {
      return jsonError(c, {
        status: 409,
        code: "PIN_AUTH_EXPIRED",
        message:
          "Publish authorization expired or was already used. Next step: request a fresh signature and retry.",
        retriable: true,
      });
    }

    const specCid = await pinJSON(`challenge-${session.id}`, canonicalSpec);
    const updatedSession = await updatePostingSession(db, {
      id: session.id,
      poster_address: signerAddress,
      state: "published",
      compilation_json: session.compilation_json,
      approved_confirmation_json:
        session.compilation_json.confirmation_contract,
      published_spec_json: canonicalSpec,
      published_spec_cid: specCid,
      failure_message: null,
      expires_at: buildExpiry(PUBLISHED_EXPIRY_MS),
    });

    return c.json({
      data: {
        session: toPostingSessionPayload(updatedSession),
        specCid,
        spec: canonicalSpec,
      },
    });
  },
);

router.get("/review/sessions", async (c) => {
  const denied = requirePostingReviewAccess(c);
  if (denied) {
    return denied;
  }

  const requestedState = c.req.query("state");
  const limit = Number(c.req.query("limit") ?? "25");
  const states =
    requestedState === "needs_clarification"
      ? (["needs_clarification"] as const)
      : requestedState === "ready"
        ? (["ready"] as const)
        : (["needs_review"] as const);

  const db = createSupabaseClient(true);
  const sessions = await listPostingSessionsByState(db, {
    states: [...states],
    limit:
      Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 25,
  });

  return c.json({
    data: {
      sessions: sessions.map((session) => toPostingSessionPayload(session)),
    },
  });
});

router.post("/review/sweep-expired", async (c) => {
  const denied = requirePostingReviewAccess(c);
  if (denied) {
    return denied;
  }

  const db = createSupabaseClient(true);
  const result = await purgeExpiredPostingSessions(db);

  return c.json({
    data: result,
  });
});

router.post(
  "/review/sessions/:id/decision",
  zValidator("json", reviewPostingSessionDecisionRequestSchema),
  async (c) => {
    const denied = requirePostingReviewAccess(c);
    if (denied) {
      return denied;
    }

    const db = createSupabaseClient(true);
    const session = await getPostingSessionById(db, c.req.param("id"));
    if (!session) {
      return jsonError(c, {
        status: 404,
        code: "POSTING_SESSION_NOT_FOUND",
        message:
          "Posting session not found. Next step: refresh the review queue and retry.",
      });
    }
    if (isPostingSessionExpired(session)) {
      return expiredPostingSessionError(c);
    }

    const body = c.req.valid("json");

    if (body.action === "approve") {
      if (session.state === "ready") {
        return c.json({
          data: {
            session: toPostingSessionPayload(session),
          },
        });
      }
      if (session.state !== "needs_review" || !session.compilation_json) {
        return jsonError(c, {
          status: 409,
          code: "POSTING_REVIEW_NOT_APPROVABLE",
          message:
            "Only review-queued drafts with a compiled contract can be approved. Next step: refresh the queue and inspect the latest session state.",
        });
      }

      const updated = await updatePostingSession(db, {
        id: session.id,
        state: "ready",
        expires_at: buildExpiry(READY_EXPIRY_MS),
      });
      return c.json({
        data: {
          session: toPostingSessionPayload(updated),
        },
      });
    }

    if (body.action === "send_to_expert_mode") {
      const updated = await updatePostingSession(db, {
        id: session.id,
        state: "failed",
        failure_message:
          "Managed authoring cannot safely publish this draft as-is. Next step: switch to Expert Mode and post the scorer contract from the CLI.",
        expires_at: buildExpiry(DRAFT_EXPIRY_MS),
      });
      return c.json({
        data: {
          session: toPostingSessionPayload(updated),
        },
      });
    }

    const updated = await updatePostingSession(db, {
      id: session.id,
      state: "failed",
      failure_message: body.message,
      expires_at: buildExpiry(DRAFT_EXPIRY_MS),
    });

    return c.json({
      data: {
        session: toPostingSessionPayload(updated),
      },
    });
  },
);

export default router;
