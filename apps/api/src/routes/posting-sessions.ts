import { getPublicClient } from "@agora/chain";
import {
  canonicalizeChallengeSpec,
  compilePostingSessionRequestSchema,
  computeSpecHash,
  createPostingSessionRequestSchema,
  getPinSpecAuthorizationTypedData,
  publishPostingSessionRequestSchema,
  readApiServerRuntimeConfig,
  readPostingReviewRuntimeConfig,
  reviewPostingSessionDecisionRequestSchema,
  validateChallengeScoreability,
} from "@agora/common";
import {
  createAuthoringDraft,
  createSupabaseClient,
  getAuthoringDraftViewById,
  getPublishedChallengeLinkByDraftId,
  listAuthoringDraftViewsByState,
  purgeExpiredAuthoringDrafts,
  readAuthoringDraftHealthSnapshot,
  updateAuthoringDraft,
  upsertPublishedChallengeLink,
} from "@agora/db";
import { pinJSON } from "@agora/ipfs";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { jsonError } from "../lib/api-error.js";
import { consumeNonce } from "../lib/auth-store.js";
import {
  isAuthoringDraftExpired,
  toAuthoringDraftPayload,
} from "../lib/authoring-draft-payloads.js";
import {
  approveDraftForPublish,
  completeDraftCompilation,
  createDraft,
  failDraft,
  markDraftCompiling,
  publishDraft,
  resolvePublishedDraftReturnSource,
} from "../lib/authoring-draft-transitions.js";
import {
  deliverAuthoringDraftLifecycleEvent,
  resolveAuthoringDraftReturnUrl,
} from "../lib/authoring-drafts.js";
import { buildManagedAuthoringIr } from "../lib/managed-authoring-ir.js";
import { compileManagedAuthoringPostingSession } from "../lib/managed-authoring.js";
import { getRequestLogger } from "../lib/observability.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";
import {
  getAuthoringDraftOwnershipError,
  normalizePosterAddress,
  resolveAuthoringDraftPosterAddress,
} from "./authoring-draft-ownership.js";
import {
  POSTING_STALE_COMPILING_THRESHOLD_MS,
  buildPostingHealthResponse,
} from "./posting-health-shared.js";

const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const READY_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLISHED_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const REVIEW_HEADER_NAME = "x-agora-review-token";

function formatScoreabilityMessage(errors: string[]) {
  return errors.join(" ");
}

function expiredPostingSessionError(c: Context<ApiEnv>) {
  return jsonError(c, {
    status: 410,
    code: "POSTING_SESSION_EXPIRED",
    message:
      "Posting session expired. Next step: start a new draft or use the published challenge spec if this draft was already posted.",
  });
}
type AuthoringDraftRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthoringDraft?: typeof createAuthoringDraft;
  getAuthoringDraftViewById?: typeof getAuthoringDraftViewById;
  getPublishedChallengeLinkByDraftId?: typeof getPublishedChallengeLinkByDraftId;
  listAuthoringDraftViewsByState?: typeof listAuthoringDraftViewsByState;
  purgeExpiredAuthoringDrafts?: typeof purgeExpiredAuthoringDrafts;
  readAuthoringDraftHealthSnapshot?: typeof readAuthoringDraftHealthSnapshot;
  updateAuthoringDraft?: typeof updateAuthoringDraft;
  upsertPublishedChallengeLink?: typeof upsertPublishedChallengeLink;
  pinJSON?: typeof pinJSON;
  getPublicClient?: typeof getPublicClient;
  consumeNonce?: typeof consumeNonce;
  deliverAuthoringDraftLifecycleEvent?: typeof deliverAuthoringDraftLifecycleEvent;
  readApiServerRuntimeConfig?: typeof readApiServerRuntimeConfig;
  readPostingReviewRuntimeConfig?: typeof readPostingReviewRuntimeConfig;
  canonicalizeChallengeSpec?: typeof canonicalizeChallengeSpec;
  compileManagedAuthoringPostingSession?: typeof compileManagedAuthoringPostingSession;
  requireWriteQuota?: typeof requireWriteQuota;
  buildManagedAuthoringIr?: typeof buildManagedAuthoringIr;
  getRequestLogger?: typeof getRequestLogger;
  resolveAuthoringDraftReturnUrl?: typeof resolveAuthoringDraftReturnUrl;
};

export function createPostingSessionRoutes(
  dependencies: AuthoringDraftRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const {
    createSupabaseClient: createSupabaseClientImpl,
    createAuthoringDraft: createAuthoringDraftImpl,
    getAuthoringDraftViewById: getAuthoringDraftViewByIdImpl,
    getPublishedChallengeLinkByDraftId: getPublishedChallengeLinkByDraftIdImpl,
    listAuthoringDraftViewsByState: listAuthoringDraftViewsByStateImpl,
    purgeExpiredAuthoringDrafts: purgeExpiredAuthoringDraftsImpl,
    readAuthoringDraftHealthSnapshot: readAuthoringDraftHealthSnapshotImpl,
    updateAuthoringDraft: updateAuthoringDraftImpl,
    upsertPublishedChallengeLink: upsertPublishedChallengeLinkImpl,
    pinJSON: pinJSONImpl,
    getPublicClient: getPublicClientImpl,
    consumeNonce: consumeNonceImpl,
    deliverAuthoringDraftLifecycleEvent:
      deliverAuthoringDraftLifecycleEventImpl,
    readApiServerRuntimeConfig: readApiServerRuntimeConfigImpl,
    readPostingReviewRuntimeConfig: readPostingReviewRuntimeConfigImpl,
    canonicalizeChallengeSpec: canonicalizeChallengeSpecImpl,
    compileManagedAuthoringPostingSession:
      compileManagedAuthoringPostingSessionImpl,
    requireWriteQuota: requireWriteQuotaImpl,
    buildManagedAuthoringIr: buildManagedAuthoringIrImpl,
    getRequestLogger: getRequestLoggerImpl,
    resolveAuthoringDraftReturnUrl: resolveAuthoringDraftReturnUrlImpl,
  } = {
    createSupabaseClient,
    createAuthoringDraft,
    getAuthoringDraftViewById,
    getPublishedChallengeLinkByDraftId,
    listAuthoringDraftViewsByState,
    purgeExpiredAuthoringDrafts,
    readAuthoringDraftHealthSnapshot,
    updateAuthoringDraft,
    upsertPublishedChallengeLink,
    pinJSON,
    getPublicClient,
    consumeNonce,
    deliverAuthoringDraftLifecycleEvent,
    readApiServerRuntimeConfig,
    readPostingReviewRuntimeConfig,
    canonicalizeChallengeSpec,
    compileManagedAuthoringPostingSession,
    requireWriteQuota,
    buildManagedAuthoringIr,
    getRequestLogger,
    resolveAuthoringDraftReturnUrl,
    ...dependencies,
  };

  function requirePostingReviewAccessWithDeps(c: Context<ApiEnv>) {
    const runtime = readPostingReviewRuntimeConfigImpl();
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

  router.get("/health", async (c) => {
    const db = createSupabaseClientImpl(true);
    const checkedAt = new Date().toISOString();
    const snapshot = await readAuthoringDraftHealthSnapshotImpl(db, {
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
    requireWriteQuotaImpl("/api/posting/sessions"),
    zValidator("json", createPostingSessionRequestSchema),
    async (c) => {
      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const session = await createDraft({
        db,
        posterAddress: normalizePosterAddress(body.poster_address),
        state: "draft",
        intentJson: body.intent ?? null,
        authoringIrJson: buildManagedAuthoringIrImpl({
          intent: body.intent ?? null,
          uploadedArtifacts: body.uploaded_artifacts ?? [],
        }),
        uploadedArtifactsJson: body.uploaded_artifacts ?? [],
        expiresInMs: DRAFT_EXPIRY_MS,
        createAuthoringDraftImpl,
        getAuthoringDraftViewByIdImpl,
      });

      return c.json({
        data: {
          session: toAuthoringDraftPayload(session),
        },
      });
    },
  );

  router.get("/sessions/:id", async (c) => {
    const db = createSupabaseClientImpl(true);
    const session = await getAuthoringDraftViewByIdImpl(db, c.req.param("id"));
    if (!session) {
      return jsonError(c, {
        status: 404,
        code: "POSTING_SESSION_NOT_FOUND",
        message:
          "Posting session not found. Next step: start a new draft and retry.",
      });
    }
    if (isAuthoringDraftExpired(session)) {
      return expiredPostingSessionError(c);
    }

    return c.json({
      data: {
        session: toAuthoringDraftPayload(session),
      },
    });
  });

  router.post(
    "/sessions/:id/compile",
    requireWriteQuotaImpl("/api/posting/sessions/compile"),
    zValidator("json", compilePostingSessionRequestSchema),
    async (c) => {
      const sessionId = c.req.param("id");
      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const existingSession = await getAuthoringDraftViewByIdImpl(
        db,
        sessionId,
      );

      if (!existingSession) {
        return jsonError(c, {
          status: 404,
          code: "POSTING_SESSION_NOT_FOUND",
          message:
            "Posting session not found. Next step: start a new draft and retry.",
        });
      }
      if (isAuthoringDraftExpired(existingSession)) {
        return expiredPostingSessionError(c);
      }

      const requesterAddress = normalizePosterAddress(body.poster_address);
      const ownershipError = getAuthoringDraftOwnershipError({
        draftPosterAddress: existingSession.poster_address,
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
        body.uploaded_artifacts ??
        existingSession.uploaded_artifacts_json ??
        [];
      const resolvedPosterAddress = resolveAuthoringDraftPosterAddress({
        draftPosterAddress: existingSession.poster_address,
        requesterAddress,
      });
      const compilingAuthoringIr = buildManagedAuthoringIrImpl({
        intent,
        uploadedArtifacts,
      });

      const compilingSession = await markDraftCompiling({
        db,
        session: existingSession,
        posterAddress: resolvedPosterAddress,
        intentJson: intent,
        authoringIrJson: compilingAuthoringIr,
        expiresInMs: DRAFT_EXPIRY_MS,
        updateAuthoringDraftImpl,
        getAuthoringDraftViewByIdImpl,
      });

      try {
        const outcome = await compileManagedAuthoringPostingSessionImpl({
          intent,
          uploadedArtifacts,
        });

        const updatedSession = await completeDraftCompilation({
          db,
          session: compilingSession,
          state: outcome.state,
          posterAddress: resolvedPosterAddress,
          intentJson: intent,
          authoringIrJson: outcome.authoringIr,
          uploadedArtifactsJson: uploadedArtifacts,
          compilationJson: outcome.compilation ?? null,
          expiresInMs:
            outcome.state === "ready" || outcome.state === "needs_review"
              ? READY_EXPIRY_MS
              : DRAFT_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
        });

        return c.json({
          data: {
            session: toAuthoringDraftPayload(updatedSession),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failDraft({
          db,
          session: compilingSession,
          posterAddress: resolvedPosterAddress,
          intentJson: intent,
          authoringIrJson: compilingAuthoringIr,
          uploadedArtifactsJson: uploadedArtifacts,
          compilationJson: null,
          message,
          expiresInMs: DRAFT_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
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
    requireWriteQuotaImpl("/api/posting/sessions/publish"),
    zValidator("json", publishPostingSessionRequestSchema),
    async (c) => {
      const sessionId = c.req.param("id");
      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const session = await getAuthoringDraftViewByIdImpl(db, sessionId);

      if (!session) {
        return jsonError(c, {
          status: 404,
          code: "POSTING_SESSION_NOT_FOUND",
          message:
            "Posting session not found. Next step: start a new draft and retry.",
        });
      }
      if (isAuthoringDraftExpired(session)) {
        return expiredPostingSessionError(c);
      }

      const signerAddress = normalizePosterAddress(body.auth.address);
      const ownershipError = getAuthoringDraftOwnershipError({
        draftPosterAddress: session.poster_address,
        requesterAddress: signerAddress,
        action: "publish",
      });
      if (ownershipError) {
        return jsonError(c, ownershipError);
      }

      const returnTo = resolveAuthoringDraftReturnUrlImpl({
        session,
        requestedReturnTo: body.return_to,
      });
      if (!returnTo.ok) {
        return jsonError(c, returnTo.error);
      }

      if (session.state === "published" && session.published_spec_cid) {
        const publishedLink = await getPublishedChallengeLinkByDraftIdImpl(
          db,
          session.id,
        );
        return c.json({
          data: {
            session: toAuthoringDraftPayload(session),
            specCid: session.published_spec_cid,
            spec:
              session.published_spec_json ??
              session.compilation_json?.challenge_spec,
            returnTo: publishedLink?.return_to ?? returnTo.returnTo,
            returnToSource: resolvePublishedDraftReturnSource({
              publishedLink,
              originExternalUrl:
                session.authoring_ir_json?.origin.external_url ?? null,
            }),
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

      const runtimeConfig = readApiServerRuntimeConfigImpl();
      const canonicalSpec = await canonicalizeChallengeSpecImpl(
        session.compilation_json.challenge_spec,
        {
          resolveOfficialPresetDigests: true,
        },
      );
      const scoreability = validateChallengeScoreability(canonicalSpec);
      if (!scoreability.ok) {
        return jsonError(c, {
          status: 409,
          code: "POSTING_SESSION_NOT_SCOREABLE",
          message: `Posting session cannot publish because the challenge spec is not scoreable yet. ${formatScoreabilityMessage(scoreability.errors)} Next step: return this draft to review or switch to Expert Mode.`,
        });
      }
      const expectedSpecHash = computeSpecHash(canonicalSpec);
      if (body.auth.specHash !== expectedSpecHash) {
        return jsonError(c, {
          status: 401,
          code: "SPEC_HASH_MISMATCH",
          message:
            "Pinned challenge spec hash mismatch. Next step: re-sign the publish request and retry.",
        });
      }

      const publicClient = getPublicClientImpl();
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

      const nonceAccepted = await consumeNonceImpl(
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

      const specCid = await pinJSONImpl(
        `challenge-${session.id}`,
        canonicalSpec,
      );
      const updatedSession = await publishDraft({
        db,
        session,
        posterAddress: signerAddress,
        compilationJson: {
          ...session.compilation_json,
          challenge_spec: canonicalSpec,
        },
        publishedSpecJson: canonicalSpec,
        publishedSpecCid: specCid,
        returnTo: returnTo.returnTo,
        expiresInMs: PUBLISHED_EXPIRY_MS,
        updateAuthoringDraftImpl,
        upsertPublishedChallengeLinkImpl,
        getAuthoringDraftViewByIdImpl,
      });

      await deliverAuthoringDraftLifecycleEventImpl({
        event: "draft_published",
        session: updatedSession,
        logger: getRequestLoggerImpl(c),
      });

      return c.json({
        data: {
          session: toAuthoringDraftPayload(updatedSession),
          specCid,
          spec: canonicalSpec,
          returnTo: returnTo.returnTo,
          returnToSource: returnTo.source,
        },
      });
    },
  );

  router.get("/review/sessions", async (c) => {
    const denied = requirePostingReviewAccessWithDeps(c);
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

    const db = createSupabaseClientImpl(true);
    const sessions = await listAuthoringDraftViewsByStateImpl(db, {
      states: [...states],
      limit:
        Number.isFinite(limit) && limit > 0
          ? Math.min(Math.floor(limit), 100)
          : 25,
    });

    return c.json({
      data: {
        sessions: sessions.map((session) => toAuthoringDraftPayload(session)),
      },
    });
  });

  router.post("/review/sweep-expired", async (c) => {
    const denied = requirePostingReviewAccessWithDeps(c);
    if (denied) {
      return denied;
    }

    const db = createSupabaseClientImpl(true);
    const result = await purgeExpiredAuthoringDraftsImpl(db);

    return c.json({
      data: result,
    });
  });

  router.post(
    "/review/sessions/:id/decision",
    zValidator("json", reviewPostingSessionDecisionRequestSchema),
    async (c) => {
      const denied = requirePostingReviewAccessWithDeps(c);
      if (denied) {
        return denied;
      }

      const db = createSupabaseClientImpl(true);
      const session = await getAuthoringDraftViewByIdImpl(
        db,
        c.req.param("id"),
      );
      if (!session) {
        return jsonError(c, {
          status: 404,
          code: "POSTING_SESSION_NOT_FOUND",
          message:
            "Posting session not found. Next step: refresh the review queue and retry.",
        });
      }
      if (isAuthoringDraftExpired(session)) {
        return expiredPostingSessionError(c);
      }

      const body = c.req.valid("json");

      if (body.action === "approve") {
        if (session.state === "ready") {
          return c.json({
            data: {
              session: toAuthoringDraftPayload(session),
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

        const canonicalSpec = await canonicalizeChallengeSpecImpl(
          session.compilation_json.challenge_spec,
          {
            resolveOfficialPresetDigests: true,
          },
        );
        const scoreability = validateChallengeScoreability(canonicalSpec);
        if (!scoreability.ok) {
          return jsonError(c, {
            status: 409,
            code: "POSTING_REVIEW_NOT_SCOREABLE",
            message: `Review approval cannot mark this draft ready because the compiled spec is not scoreable yet. ${formatScoreabilityMessage(scoreability.errors)} Next step: keep it in review or send it to Expert Mode.`,
          });
        }

        const updated = await approveDraftForPublish({
          db,
          session,
          compilationJson: {
            ...session.compilation_json,
            challenge_spec: canonicalSpec,
          },
          expiresInMs: READY_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
        });
        return c.json({
          data: {
            session: toAuthoringDraftPayload(updated),
          },
        });
      }

      if (body.action === "send_to_expert_mode") {
        const updated = await failDraft({
          db,
          session,
          message:
            "Managed authoring cannot safely publish this draft as-is. Next step: switch to Expert Mode and post the scorer contract from the CLI.",
          expiresInMs: DRAFT_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
        });
        return c.json({
          data: {
            session: toAuthoringDraftPayload(updated),
          },
        });
      }

      const updated = await failDraft({
        db,
        session,
        message: body.message,
        expiresInMs: DRAFT_EXPIRY_MS,
        updateAuthoringDraftImpl,
        getAuthoringDraftViewByIdImpl,
      });

      return c.json({
        data: {
          session: toAuthoringDraftPayload(updated),
        },
      });
    },
  );

  return router;
}

export default createPostingSessionRoutes();
