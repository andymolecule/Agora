import { getPublicClient } from "@agora/chain";
import {
  canonicalizeChallengeSpec,
  compileManagedAuthoringDraftRequestSchema,
  computeSpecHash,
  createAuthoringDraftRequestSchema,
  getPinSpecAuthorizationTypedData,
  publishManagedAuthoringDraftRequestSchema,
  readApiServerRuntimeConfig,
  readAuthoringReviewRuntimeConfig,
  reviewManagedAuthoringDraftDecisionRequestSchema,
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
import { compileManagedAuthoringDraftOutcome } from "../lib/managed-authoring.js";
import { getRequestLogger } from "../lib/observability.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";
import {
  AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS,
  buildAuthoringDraftHealthResponse,
} from "./authoring-draft-health-shared.js";
import {
  getAuthoringDraftOwnershipError,
  normalizePosterAddress,
  resolveAuthoringDraftPosterAddress,
} from "./authoring-draft-ownership.js";

const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const READY_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLISHED_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const REVIEW_HEADER_NAME = "x-agora-review-token";

function formatScoreabilityMessage(errors: string[]) {
  return errors.join(" ");
}

function expiredAuthoringDraftError(c: Context<ApiEnv>) {
  return jsonError(c, {
    status: 410,
    code: "AUTHORING_DRAFT_EXPIRED",
    message:
      "Authoring draft expired. Next step: start a new draft or use the published challenge spec if this draft was already posted.",
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
  readAuthoringReviewRuntimeConfig?: typeof readAuthoringReviewRuntimeConfig;
  canonicalizeChallengeSpec?: typeof canonicalizeChallengeSpec;
  compileManagedAuthoringDraftOutcome?: typeof compileManagedAuthoringDraftOutcome;
  requireWriteQuota?: typeof requireWriteQuota;
  buildManagedAuthoringIr?: typeof buildManagedAuthoringIr;
  getRequestLogger?: typeof getRequestLogger;
  resolveAuthoringDraftReturnUrl?: typeof resolveAuthoringDraftReturnUrl;
};

export function createAuthoringDraftRoutes(
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
    readAuthoringReviewRuntimeConfig: readAuthoringReviewRuntimeConfigImpl,
    canonicalizeChallengeSpec: canonicalizeChallengeSpecImpl,
    compileManagedAuthoringDraftOutcome:
      compileManagedAuthoringDraftOutcomeImpl,
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
    readAuthoringReviewRuntimeConfig,
    canonicalizeChallengeSpec,
    compileManagedAuthoringDraftOutcome,
    requireWriteQuota,
    buildManagedAuthoringIr,
    getRequestLogger,
    resolveAuthoringDraftReturnUrl,
    ...dependencies,
  };

  function requireAuthoringReviewAccessWithDeps(c: Context<ApiEnv>) {
    const runtime = readAuthoringReviewRuntimeConfigImpl();
    if (!runtime.token) {
      return jsonError(c, {
        status: 503,
        code: "AUTHORING_REVIEW_DISABLED",
        message:
          "Authoring review access is not configured. Next step: set AGORA_AUTHORING_REVIEW_TOKEN on the API and web services, then retry.",
      });
    }

    const providedToken = c.req.header(REVIEW_HEADER_NAME);
    if (providedToken !== runtime.token) {
      return jsonError(c, {
        status: 401,
        code: "AUTHORING_REVIEW_UNAUTHORIZED",
        message:
          "Authoring review access denied. Next step: open the internal review surface or provide a valid review token.",
      });
    }

    return null;
  }

  router.get("/health", async (c) => {
    const db = createSupabaseClientImpl(true);
    const checkedAt = new Date().toISOString();
    const snapshot = await readAuthoringDraftHealthSnapshotImpl(db, {
      nowIso: checkedAt,
      staleCompilingAfterMs: AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS,
    });
    const counts = {
      draft: snapshot.counts.draft ?? 0,
      compiling: snapshot.counts.compiling ?? 0,
      ready: snapshot.counts.ready ?? 0,
      needs_clarification: snapshot.counts.needs_clarification ?? 0,
      needs_review: snapshot.counts.needs_review ?? 0,
      published: snapshot.counts.published ?? 0,
      failed: snapshot.counts.failed ?? 0,
    };

    return c.json({
      data: buildAuthoringDraftHealthResponse({
        checkedAt,
        ...snapshot,
        counts,
      }),
    });
  });

  router.post(
    "/drafts",
    requireWriteQuotaImpl("/api/authoring/drafts"),
    zValidator("json", createAuthoringDraftRequestSchema),
    async (c) => {
      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const draft = await createDraft({
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
          draft: toAuthoringDraftPayload(draft),
        },
      });
    },
  );

  router.post(
    "/drafts/:id/compile",
    requireWriteQuotaImpl("/api/authoring/drafts/compile"),
    zValidator("json", compileManagedAuthoringDraftRequestSchema),
    async (c) => {
      const draftId = c.req.param("id");
      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const existingDraft = await getAuthoringDraftViewByIdImpl(db, draftId);

      if (!existingDraft) {
        return jsonError(c, {
          status: 404,
          code: "AUTHORING_DRAFT_NOT_FOUND",
          message:
            "Authoring draft not found. Next step: start a new draft and retry.",
        });
      }
      if (isAuthoringDraftExpired(existingDraft)) {
        return expiredAuthoringDraftError(c);
      }

      const requesterAddress = normalizePosterAddress(body.poster_address);
      const ownershipError = getAuthoringDraftOwnershipError({
        draftPosterAddress: existingDraft.poster_address,
        requesterAddress,
        action: "compile",
      });
      if (ownershipError) {
        return jsonError(c, ownershipError);
      }

      const intent = body.intent ?? existingDraft.intent_json;
      if (!intent) {
        return jsonError(c, {
          status: 400,
          code: "AUTHORING_INTENT_REQUIRED",
          message:
            "Managed authoring requires a title, description, payout condition, reward, and deadline. Next step: fill in the draft and retry.",
        });
      }

      const uploadedArtifacts =
        body.uploaded_artifacts ?? existingDraft.uploaded_artifacts_json ?? [];
      const resolvedPosterAddress = resolveAuthoringDraftPosterAddress({
        draftPosterAddress: existingDraft.poster_address,
        requesterAddress,
      });
      const compilingAuthoringIr = buildManagedAuthoringIrImpl({
        intent,
        uploadedArtifacts,
      });

      const compilingDraft = await markDraftCompiling({
        db,
        session: existingDraft,
        posterAddress: resolvedPosterAddress,
        intentJson: intent,
        authoringIrJson: compilingAuthoringIr,
        expiresInMs: DRAFT_EXPIRY_MS,
        updateAuthoringDraftImpl,
        getAuthoringDraftViewByIdImpl,
      });

      try {
        const outcome = await compileManagedAuthoringDraftOutcomeImpl({
          intent,
          uploadedArtifacts,
        });

        const updatedDraft = await completeDraftCompilation({
          db,
          session: compilingDraft,
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
            draft: toAuthoringDraftPayload(updatedDraft),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failDraft({
          db,
          session: compilingDraft,
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
          code: "AUTHORING_COMPILE_FAILED",
          message,
        });
      }
    },
  );

  router.post(
    "/drafts/:id/publish",
    requireWriteQuotaImpl("/api/authoring/drafts/publish"),
    zValidator("json", publishManagedAuthoringDraftRequestSchema),
    async (c) => {
      const draftId = c.req.param("id");
      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const draft = await getAuthoringDraftViewByIdImpl(db, draftId);

      if (!draft) {
        return jsonError(c, {
          status: 404,
          code: "AUTHORING_DRAFT_NOT_FOUND",
          message:
            "Authoring draft not found. Next step: start a new draft and retry.",
        });
      }
      if (isAuthoringDraftExpired(draft)) {
        return expiredAuthoringDraftError(c);
      }

      const signerAddress = normalizePosterAddress(body.auth.address);
      const ownershipError = getAuthoringDraftOwnershipError({
        draftPosterAddress: draft.poster_address,
        requesterAddress: signerAddress,
        action: "publish",
      });
      if (ownershipError) {
        return jsonError(c, ownershipError);
      }

      const returnTo = resolveAuthoringDraftReturnUrlImpl({
        session: draft,
        requestedReturnTo: body.return_to,
      });
      if (!returnTo.ok) {
        return jsonError(c, returnTo.error);
      }

      if (draft.state === "published" && draft.published_spec_cid) {
        const publishedLink = await getPublishedChallengeLinkByDraftIdImpl(
          db,
          draft.id,
        );
        return c.json({
          data: {
            draft: toAuthoringDraftPayload(draft),
            specCid: draft.published_spec_cid,
            spec:
              draft.published_spec_json ??
              draft.compilation_json?.challenge_spec,
            returnTo: publishedLink?.return_to ?? returnTo.returnTo,
            returnToSource: resolvePublishedDraftReturnSource({
              publishedLink,
              originExternalUrl:
                draft.authoring_ir_json?.origin.external_url ?? null,
            }),
          },
        });
      }

      if (draft.state !== "ready" || !draft.compilation_json) {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_DRAFT_NOT_READY",
          message:
            "Authoring draft is not ready to publish. Next step: compile the draft successfully before publishing.",
        });
      }

      const runtimeConfig = readApiServerRuntimeConfigImpl();
      const canonicalSpec = await canonicalizeChallengeSpecImpl(
        draft.compilation_json.challenge_spec,
        {
          resolveOfficialPresetDigests: true,
        },
      );
      const scoreability = validateChallengeScoreability(canonicalSpec);
      if (!scoreability.ok) {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_DRAFT_NOT_SCOREABLE",
          message: `Authoring draft cannot publish because the challenge spec is not scoreable yet. ${formatScoreabilityMessage(scoreability.errors)} Next step: return this draft to review or switch to Expert Mode.`,
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

      const specCid = await pinJSONImpl(`challenge-${draft.id}`, canonicalSpec);
      const updatedDraft = await publishDraft({
        db,
        session: draft,
        posterAddress: signerAddress,
        compilationJson: {
          ...draft.compilation_json,
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
        session: updatedDraft,
        logger: getRequestLoggerImpl(c),
      });

      return c.json({
        data: {
          draft: toAuthoringDraftPayload(updatedDraft),
          specCid,
          spec: canonicalSpec,
          returnTo: returnTo.returnTo,
          returnToSource: returnTo.source,
        },
      });
    },
  );

  router.get("/review/drafts", async (c) => {
    const denied = requireAuthoringReviewAccessWithDeps(c);
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
    const drafts = await listAuthoringDraftViewsByStateImpl(db, {
      states: [...states],
      limit:
        Number.isFinite(limit) && limit > 0
          ? Math.min(Math.floor(limit), 100)
          : 25,
    });

    return c.json({
      data: {
        drafts: drafts.map((draft) => toAuthoringDraftPayload(draft)),
      },
    });
  });

  router.post("/review/sweep-expired", async (c) => {
    const denied = requireAuthoringReviewAccessWithDeps(c);
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
    "/review/drafts/:id/decision",
    zValidator("json", reviewManagedAuthoringDraftDecisionRequestSchema),
    async (c) => {
      const denied = requireAuthoringReviewAccessWithDeps(c);
      if (denied) {
        return denied;
      }

      const db = createSupabaseClientImpl(true);
      const draft = await getAuthoringDraftViewByIdImpl(db, c.req.param("id"));
      if (!draft) {
        return jsonError(c, {
          status: 404,
          code: "AUTHORING_DRAFT_NOT_FOUND",
          message:
            "Authoring draft not found. Next step: refresh the review queue and retry.",
        });
      }
      if (isAuthoringDraftExpired(draft)) {
        return expiredAuthoringDraftError(c);
      }

      const body = c.req.valid("json");

      if (body.action === "approve") {
        if (draft.state === "ready") {
          return c.json({
            data: {
              draft: toAuthoringDraftPayload(draft),
            },
          });
        }
        if (draft.state !== "needs_review" || !draft.compilation_json) {
          return jsonError(c, {
            status: 409,
            code: "AUTHORING_REVIEW_NOT_APPROVABLE",
            message:
              "Only review-queued drafts with a compiled contract can be approved. Next step: refresh the queue and inspect the latest draft state.",
          });
        }

        const canonicalSpec = await canonicalizeChallengeSpecImpl(
          draft.compilation_json.challenge_spec,
          {
            resolveOfficialPresetDigests: true,
          },
        );
        const scoreability = validateChallengeScoreability(canonicalSpec);
        if (!scoreability.ok) {
          return jsonError(c, {
            status: 409,
            code: "AUTHORING_REVIEW_NOT_SCOREABLE",
            message: `Review approval cannot mark this draft ready because the compiled spec is not scoreable yet. ${formatScoreabilityMessage(scoreability.errors)} Next step: keep it in review or send it to Expert Mode.`,
          });
        }

        const updatedDraft = await approveDraftForPublish({
          db,
          session: draft,
          compilationJson: {
            ...draft.compilation_json,
            challenge_spec: canonicalSpec,
          },
          expiresInMs: READY_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
        });
        return c.json({
          data: {
            draft: toAuthoringDraftPayload(updatedDraft),
          },
        });
      }

      if (body.action === "send_to_expert_mode") {
        const updatedDraft = await failDraft({
          db,
          session: draft,
          message:
            "Managed authoring cannot safely publish this draft as-is. Next step: switch to Expert Mode and post the scorer contract from the CLI.",
          expiresInMs: DRAFT_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
        });
        return c.json({
          data: {
            draft: toAuthoringDraftPayload(updatedDraft),
          },
        });
      }

      const updatedDraft = await failDraft({
        db,
        session: draft,
        message: body.message,
        expiresInMs: DRAFT_EXPIRY_MS,
        updateAuthoringDraftImpl,
        getAuthoringDraftViewByIdImpl,
      });

      return c.json({
        data: {
          draft: toAuthoringDraftPayload(updatedDraft),
        },
      });
    },
  );

  return router;
}

export default createAuthoringDraftRoutes();
