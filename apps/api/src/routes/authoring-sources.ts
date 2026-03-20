import {
  AgoraError,
  type AuthoringArtifactOutput,
  type AuthoringPartnerProviderOutput,
  canonicalizeChallengeSpec,
  clarifyAuthoringDraftRequestSchema,
  compileAuthoringDraftRequestSchema,
  createAuthoringSourceDraftRequestSchema,
  publishExternalAuthoringDraftRequestSchema,
  readAuthoringPartnerRuntimeConfig,
  readAuthoringReviewRuntimeConfig,
  readAuthoringSponsorRuntimeConfig,
  registerAuthoringDraftWebhookRequestSchema,
  validateChallengeScoreability,
} from "@agora/common";
import {
  type AuthoringDraftViewRow,
  AuthoringDraftWriteConflictError,
  createAuthoringDraft,
  createSupabaseClient,
  getAuthoringDraftViewById,
  getAuthoringSourceLink,
  getPublishedChallengeLinkByDraftId,
  updateAuthoringDraft,
  upsertAuthoringCallbackTarget,
  upsertAuthoringSourceLink,
} from "@agora/db";
import { pinJSON } from "@agora/ipfs";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { jsonError, toApiErrorResponse } from "../lib/api-error.js";
import { normalizeExternalArtifactsForDraft } from "../lib/authoring-artifacts.js";
import {
  EXTERNAL_DRAFT_EXPIRY_MS,
  isAuthoringDraftExpired,
} from "../lib/authoring-draft-payloads.js";
import {
  completeDraftCompilation,
  failDraft,
  markDraftCompiling,
  refreshDraftIr,
  registerDraftCallback,
} from "../lib/authoring-draft-transitions.js";
import {
  buildAuthoringDraftCard,
  buildAuthoringDraftResponse,
  buildDraftNotFoundError,
  buildDraftUpdatedState,
  buildExpiredDraftError,
  deliverAuthoringDraftLifecycleEvent,
  deliverChallengeLifecycleEvent,
  draftBelongsToProvider,
  resolveAuthoringDraftReturnUrl,
  sweepPendingAuthoringDraftLifecycleEvents,
} from "../lib/authoring-drafts.js";
import {
  getAuthoringDraftSourceAttribution,
  withAuthoringDraftSourceAttribution,
} from "../lib/authoring-source-attribution.js";
import { resolveProviderFromBearerToken } from "../lib/authoring-source-auth.js";
import { createExternalAuthoringDraft } from "../lib/authoring-source-import.js";
import { sponsorAndPublishAuthoringDraft } from "../lib/authoring-sponsored-publish.js";
import { buildManagedAuthoringIr } from "../lib/managed-authoring-ir.js";
import { compileManagedAuthoringDraftOutcome } from "../lib/managed-authoring.js";
import { getRequestLogger } from "../lib/observability.js";
import { consumeWriteQuota } from "../lib/rate-limit.js";
import type { ApiEnv } from "../types.js";
const REVIEW_HEADER_NAME = "x-agora-review-token";

function mergeExternalMessages(
  existing: NonNullable<
    AuthoringDraftViewRow["authoring_ir_json"]
  >["source"]["poster_messages"],
  added: NonNullable<
    ReturnType<typeof clarifyAuthoringDraftRequestSchema.parse>
  >["messages"],
) {
  const merged = [...existing];
  for (const message of added) {
    const nextMessage = {
      id: message.id,
      role: message.role,
      content: message.content,
      created_at: message.created_at ?? new Date().toISOString(),
    };
    const existingMessage = merged.find(
      (candidate) => candidate.id === message.id,
    );
    if (!existingMessage) {
      merged.push(nextMessage);
      continue;
    }

    const sameMessage =
      existingMessage.role === nextMessage.role &&
      existingMessage.content === nextMessage.content;
    if (!sameMessage) {
      throw new Error(
        `Authoring source message id "${message.id}" conflicts with an existing draft message. Next step: resend the clarification with a unique message id and retry.`,
      );
    }
  }

  return merged;
}

function mergeExternalArtifacts(
  existing: AuthoringDraftViewRow["uploaded_artifacts_json"],
  added: AuthoringArtifactOutput[],
) {
  const merged = [...existing];
  const seenUris = new Set(existing.map((artifact) => artifact.uri));
  for (const artifact of added) {
    if (seenUris.has(artifact.uri)) {
      continue;
    }
    merged.push(artifact);
    seenUris.add(artifact.uri);
  }
  return merged;
}

function draftBusyError() {
  return {
    status: 409 as const,
    code: "AUTHORING_DRAFT_BUSY",
    message:
      "Authoring draft is already compiling. Next step: wait for the current compile to finish or reload the latest draft state and retry.",
  };
}

function draftConflictError() {
  return {
    status: 409 as const,
    code: "AUTHORING_DRAFT_CONFLICT",
    message:
      "Authoring draft changed during the update. Next step: reload the latest draft state from Agora and retry your change.",
  };
}

function draftLookupErrorResponse(
  c: Context<ApiEnv>,
  error:
    | ReturnType<typeof buildDraftNotFoundError>
    | ReturnType<typeof buildExpiredDraftError>
    | null,
) {
  if (!error) {
    throw new Error(
      "Missing authoring draft lookup error. Next step: retry the request and inspect the draft access path.",
    );
  }
  return jsonError(c, error);
}

function artifactNormalizationErrorResponse(
  c: Context<ApiEnv>,
  error: unknown,
) {
  const apiError = toApiErrorResponse(
    error instanceof AgoraError
      ? error
      : new AgoraError(
          "External artifact normalization failed. Next step: verify the source artifacts and retry.",
          {
            code: "AUTHORING_SOURCE_ARTIFACT_NORMALIZATION_FAILED",
            status: 500,
            retriable: false,
            cause: error,
          },
        ),
  );
  return c.json(apiError.body, apiError.status);
}

function partnerWriteRateLimitError(
  c: Context<ApiEnv>,
  provider: AuthoringPartnerProviderOutput,
  routeKey: string,
  consumeWriteQuotaImpl: typeof consumeWriteQuota,
) {
  const quota = consumeWriteQuotaImpl(`partner:${provider}`, routeKey);
  if (quota.allowed) {
    return null;
  }
  if ("retryAfterSec" in quota) {
    c.header("Retry-After", String(quota.retryAfterSec));
  }
  return jsonError(c, {
    status: 429,
    code: "RATE_LIMITED",
    message: quota.message,
    retriable: true,
  });
}

async function readPartnerDraft(input: {
  id: string;
  provider: AuthoringPartnerProviderOutput;
  getAuthoringDraftViewByIdImpl: typeof getAuthoringDraftViewById;
  createSupabaseClientImpl: typeof createSupabaseClient;
}) {
  const db = input.createSupabaseClientImpl(true);
  const draft = await input.getAuthoringDraftViewByIdImpl(db, input.id);
  if (!draft || !draftBelongsToProvider(draft, input.provider)) {
    return { draft: null, error: buildDraftNotFoundError() };
  }
  if (isAuthoringDraftExpired(draft)) {
    return { draft: null, error: buildExpiredDraftError() };
  }
  return { draft, error: null };
}

async function safelyDeliverDraftLifecycleEvent(
  input: Parameters<typeof deliverAuthoringDraftLifecycleEvent>[0],
  deliverImpl: typeof deliverAuthoringDraftLifecycleEvent = deliverAuthoringDraftLifecycleEvent,
) {
  try {
    return await deliverImpl(input);
  } catch (error) {
    input.logger?.warn(
      {
        event: "authoring.callback.delivery_failed",
        draftId: input.draft.id,
        provider: input.draft.authoring_ir_json?.origin.provider ?? "direct",
        eventType: input.event,
        message: error instanceof Error ? error.message : String(error),
      },
      "Authoring draft lifecycle delivery threw unexpectedly",
    );
    return false;
  }
}

async function safelyDeliverChallengeLifecycleEvent(
  input: Parameters<typeof deliverChallengeLifecycleEvent>[0],
  deliverImpl: typeof deliverChallengeLifecycleEvent = deliverChallengeLifecycleEvent,
) {
  try {
    return await deliverImpl(input);
  } catch (error) {
    input.logger?.warn(
      {
        event: "authoring.callback.delivery_failed",
        draftId: input.draft.id,
        provider: input.draft.authoring_ir_json?.origin.provider ?? "direct",
        eventType: input.event,
        message: error instanceof Error ? error.message : String(error),
      },
      "Challenge lifecycle delivery threw unexpectedly",
    );
    return false;
  }
}

type AuthoringSourcesRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthoringDraft?: typeof createAuthoringDraft;
  getAuthoringDraftViewById?: typeof getAuthoringDraftViewById;
  getAuthoringSourceLink?: typeof getAuthoringSourceLink;
  getPublishedChallengeLinkByDraftId?: typeof getPublishedChallengeLinkByDraftId;
  updateAuthoringDraft?: typeof updateAuthoringDraft;
  upsertAuthoringSourceLink?: typeof upsertAuthoringSourceLink;
  compileManagedAuthoringDraftOutcome?: typeof compileManagedAuthoringDraftOutcome;
  normalizeExternalArtifactsForDraft?: typeof normalizeExternalArtifactsForDraft;
  pinJSON?: typeof pinJSON;
  canonicalizeChallengeSpec?: typeof canonicalizeChallengeSpec;
  readAuthoringPartnerRuntimeConfig?: typeof readAuthoringPartnerRuntimeConfig;
  readAuthoringReviewRuntimeConfig?: typeof readAuthoringReviewRuntimeConfig;
  readAuthoringSponsorRuntimeConfig?: typeof readAuthoringSponsorRuntimeConfig;
  consumeWriteQuota?: typeof consumeWriteQuota;
  upsertAuthoringCallbackTarget?: typeof upsertAuthoringCallbackTarget;
  deliverAuthoringDraftLifecycleEvent?: typeof deliverAuthoringDraftLifecycleEvent;
  sweepPendingAuthoringDraftLifecycleEvents?: typeof sweepPendingAuthoringDraftLifecycleEvents;
  sponsorAndPublishAuthoringDraft?: typeof sponsorAndPublishAuthoringDraft;
  deliverChallengeLifecycleEvent?: typeof deliverChallengeLifecycleEvent;
};

export function createAuthoringSourcesRouter(
  dependencies: AuthoringSourcesRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const {
    createSupabaseClient: createSupabaseClientImpl,
    createAuthoringDraft: createAuthoringDraftImpl,
    getAuthoringDraftViewById: getAuthoringDraftViewByIdImpl,
    getAuthoringSourceLink: getAuthoringSourceLinkImpl,
    getPublishedChallengeLinkByDraftId: getPublishedChallengeLinkByDraftIdImpl,
    updateAuthoringDraft: updateAuthoringDraftImpl,
    upsertAuthoringSourceLink: upsertAuthoringSourceLinkImpl,
    compileManagedAuthoringDraftOutcome:
      compileManagedAuthoringDraftOutcomeImpl,
    normalizeExternalArtifactsForDraft: normalizeExternalArtifactsForDraftImpl,
    pinJSON: pinJSONImpl,
    canonicalizeChallengeSpec: canonicalizeChallengeSpecImpl,
    readAuthoringPartnerRuntimeConfig: readAuthoringPartnerRuntimeConfigImpl,
    readAuthoringReviewRuntimeConfig: readAuthoringReviewRuntimeConfigImpl,
    readAuthoringSponsorRuntimeConfig: readAuthoringSponsorRuntimeConfigImpl,
    consumeWriteQuota: consumeWriteQuotaImpl,
    upsertAuthoringCallbackTarget: upsertAuthoringCallbackTargetImpl,
    deliverAuthoringDraftLifecycleEvent:
      deliverAuthoringDraftLifecycleEventImpl,
    sweepPendingAuthoringDraftLifecycleEvents:
      sweepPendingAuthoringDraftLifecycleEventsImpl,
    sponsorAndPublishAuthoringDraft: sponsorAndPublishAuthoringDraftImpl,
    deliverChallengeLifecycleEvent: deliverChallengeLifecycleEventImpl,
  } = {
    createSupabaseClient,
    createAuthoringDraft,
    getAuthoringDraftViewById,
    getAuthoringSourceLink,
    getPublishedChallengeLinkByDraftId,
    updateAuthoringDraft,
    upsertAuthoringSourceLink,
    compileManagedAuthoringDraftOutcome,
    normalizeExternalArtifactsForDraft,
    pinJSON,
    canonicalizeChallengeSpec,
    readAuthoringPartnerRuntimeConfig,
    readAuthoringReviewRuntimeConfig,
    readAuthoringSponsorRuntimeConfig,
    consumeWriteQuota,
    upsertAuthoringCallbackTarget,
    deliverAuthoringDraftLifecycleEvent,
    sweepPendingAuthoringDraftLifecycleEvents,
    sponsorAndPublishAuthoringDraft,
    deliverChallengeLifecycleEvent,
    ...dependencies,
  };

  function requireAuthoringReviewAccess(c: Context<ApiEnv>) {
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

  router.post("/callbacks/sweep", async (c) => {
    const denied = requireAuthoringReviewAccess(c);
    if (denied) {
      return denied;
    }

    const requestedLimit = Number(c.req.query("limit") ?? "25");
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 100)
        : 25;
    const summary = await sweepPendingAuthoringDraftLifecycleEventsImpl({
      limit,
      logger: getRequestLogger(c),
    });

    return c.json({
      data: summary,
    });
  });

  router.use("/external/*", async (c, next) => {
    const authResult = resolveProviderFromBearerToken(
      c.req.header("authorization"),
      readAuthoringPartnerRuntimeConfigImpl().partnerKeys,
    );
    if (!authResult.ok) {
      return jsonError(c, {
        status: 401,
        code: authResult.code,
        message: authResult.message,
      });
    }

    c.set("authoringSourceProvider", authResult.provider);
    await next();
  });

  router.post(
    "/external/sources",
    zValidator("json", createAuthoringSourceDraftRequestSchema),
    async (c) => {
      const provider = c.get("authoringSourceProvider");
      if (!provider) {
        throw new Error(
          "Authoring source provider missing from request context. Next step: retry the request after re-authenticating the integration partner.",
        );
      }

      const rateLimitError = partnerWriteRateLimitError(
        c,
        provider,
        "/api/authoring/external/sources",
        consumeWriteQuotaImpl,
      );
      if (rateLimitError) {
        return rateLimitError;
      }

      const body = c.req.valid("json");
      try {
        const draft = await createExternalAuthoringDraft({
          provider,
          body,
          createSupabaseClientImpl,
          createAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
          getAuthoringSourceLinkImpl,
          updateAuthoringDraftImpl,
          upsertAuthoringSourceLinkImpl,
          normalizeExternalArtifactsForDraftImpl,
          logger: getRequestLogger(c),
        });
        return c.json({
          data: buildAuthoringDraftResponse(draft),
        });
      } catch (error) {
        return artifactNormalizationErrorResponse(c, error);
      }
    },
  );

  router.get("/external/drafts/:id", async (c) => {
    const provider = c.get("authoringSourceProvider");
    if (!provider) {
      throw new Error(
        "Authoring source provider missing from request context. Next step: retry the request after re-authenticating the integration partner.",
      );
    }

    const result = await readPartnerDraft({
      id: c.req.param("id"),
      provider,
      getAuthoringDraftViewByIdImpl,
      createSupabaseClientImpl,
    });
    if (!result.draft) {
      return draftLookupErrorResponse(c, result.error);
    }

    return c.json({
      data: buildAuthoringDraftResponse(result.draft),
    });
  });

  router.get("/external/drafts/:id/card", async (c) => {
    const provider = c.get("authoringSourceProvider");
    if (!provider) {
      throw new Error(
        "Authoring source provider missing from request context. Next step: retry the request after re-authenticating the integration partner.",
      );
    }

    const result = await readPartnerDraft({
      id: c.req.param("id"),
      provider,
      getAuthoringDraftViewByIdImpl,
      createSupabaseClientImpl,
    });
    if (!result.draft) {
      return draftLookupErrorResponse(c, result.error);
    }

    return c.json({
      data: {
        card: buildAuthoringDraftCard(result.draft),
      },
    });
  });

  router.post(
    "/external/drafts/:id/clarify",
    zValidator("json", clarifyAuthoringDraftRequestSchema),
    async (c) => {
      const provider = c.get("authoringSourceProvider");
      if (!provider) {
        throw new Error(
          "Authoring source provider missing from request context. Next step: retry the request after re-authenticating the integration partner.",
        );
      }

      const rateLimitError = partnerWriteRateLimitError(
        c,
        provider,
        "/api/authoring/external/drafts/clarify",
        consumeWriteQuotaImpl,
      );
      if (rateLimitError) {
        return rateLimitError;
      }

      const result = await readPartnerDraft({
        id: c.req.param("id"),
        provider,
        getAuthoringDraftViewByIdImpl,
        createSupabaseClientImpl,
      });
      if (!result.draft) {
        return draftLookupErrorResponse(c, result.error);
      }
      if (result.draft.state === "published") {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_DRAFT_PUBLISHED",
          message:
            "Authoring draft is already published and can no longer be changed. Next step: create a new draft from the updated host thread and retry.",
        });
      }
      if (result.draft.state === "compiling") {
        return jsonError(c, draftBusyError());
      }

      const body = c.req.valid("json");
      let mergedMessages: NonNullable<
        AuthoringDraftViewRow["authoring_ir_json"]
      >["source"]["poster_messages"];
      try {
        mergedMessages = mergeExternalMessages(
          result.draft.authoring_ir_json?.source.poster_messages ?? [],
          body.messages,
        );
      } catch (error) {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_SOURCE_MESSAGE_CONFLICT",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      let normalizedArtifacts: AuthoringArtifactOutput[];
      try {
        normalizedArtifacts = await normalizeExternalArtifactsForDraftImpl({
          artifacts: body.artifacts,
          logger: getRequestLogger(c),
          draftId: result.draft.id,
          provider,
        });
      } catch (error) {
        return artifactNormalizationErrorResponse(c, error);
      }
      const mergedArtifacts = mergeExternalArtifacts(
        result.draft.uploaded_artifacts_json ?? [],
        normalizedArtifacts,
      );
      const authoringIr = buildManagedAuthoringIr({
        intent: result.draft.intent_json,
        uploadedArtifacts: mergedArtifacts,
        sourceMessages: mergedMessages,
        origin: {
          provider,
          external_id:
            result.draft.authoring_ir_json?.origin.external_id ?? null,
          external_url:
            result.draft.authoring_ir_json?.origin.external_url ?? null,
          ingested_at: result.draft.authoring_ir_json?.origin.ingested_at,
          raw_context:
            body.raw_context ??
            result.draft.authoring_ir_json?.origin.raw_context ??
            null,
        },
      });
      const db = createSupabaseClientImpl(true);
      let updatedDraft: AuthoringDraftViewRow;
      try {
        updatedDraft = await refreshDraftIr({
          db,
          draft: result.draft,
          state: buildDraftUpdatedState(result.draft.state),
          intentJson: result.draft.intent_json,
          authoringIrJson: authoringIr,
          uploadedArtifactsJson: mergedArtifacts,
          expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
          logger: getRequestLogger(c),
        });
      } catch (error) {
        if (error instanceof AuthoringDraftWriteConflictError) {
          return jsonError(c, draftConflictError());
        }
        throw error;
      }

      await safelyDeliverDraftLifecycleEvent(
        {
          event: "draft_updated",
          draft: updatedDraft,
          logger: getRequestLogger(c),
        },
        deliverAuthoringDraftLifecycleEventImpl,
      );

      return c.json({
        data: buildAuthoringDraftResponse(updatedDraft),
      });
    },
  );

  router.post(
    "/external/drafts/:id/compile",
    zValidator("json", compileAuthoringDraftRequestSchema),
    async (c) => {
      const provider = c.get("authoringSourceProvider");
      if (!provider) {
        throw new Error(
          "Authoring source provider missing from request context. Next step: retry the request after re-authenticating the integration partner.",
        );
      }

      const rateLimitError = partnerWriteRateLimitError(
        c,
        provider,
        "/api/authoring/external/drafts/compile",
        consumeWriteQuotaImpl,
      );
      if (rateLimitError) {
        return rateLimitError;
      }

      const result = await readPartnerDraft({
        id: c.req.param("id"),
        provider,
        getAuthoringDraftViewByIdImpl,
        createSupabaseClientImpl,
      });
      if (!result.draft) {
        return draftLookupErrorResponse(c, result.error);
      }
      if (result.draft.state === "compiling") {
        return jsonError(c, draftBusyError());
      }
      if (result.draft.state === "published") {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_DRAFT_PUBLISHED",
          message:
            "Authoring draft is already published and can no longer be recompiled. Next step: create a new draft from the updated host thread and retry.",
        });
      }

      const body = c.req.valid("json");
      const intent = body.intent ?? result.draft.intent_json;
      if (!intent) {
        return jsonError(c, {
          status: 400,
          code: "AUTHORING_INTENT_REQUIRED",
          message:
            "Compiling an external authoring draft requires a full objective, payout, and deadline. Next step: provide the structured challenge intent and retry.",
        });
      }

      const db = createSupabaseClientImpl(true);
      const compilingAuthoringIr = buildManagedAuthoringIr({
        intent,
        uploadedArtifacts: result.draft.uploaded_artifacts_json ?? [],
        sourceMessages:
          result.draft.authoring_ir_json?.source.poster_messages ?? [],
        origin: result.draft.authoring_ir_json?.origin ?? { provider },
      });
      let compilingDraft: AuthoringDraftViewRow;
      try {
        compilingDraft = await markDraftCompiling({
          db,
          draft: result.draft,
          intentJson: intent,
          authoringIrJson: compilingAuthoringIr,
          expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
          logger: getRequestLogger(c),
        });
      } catch (error) {
        if (error instanceof AuthoringDraftWriteConflictError) {
          return jsonError(c, draftConflictError());
        }
        throw error;
      }

      try {
        const outcome = await compileManagedAuthoringDraftOutcomeImpl({
          intent,
          uploadedArtifacts: result.draft.uploaded_artifacts_json ?? [],
          draftId: result.draft.id,
          logger: getRequestLogger(c),
        });
        let updatedDraft: AuthoringDraftViewRow;
        const updatedAuthoringIr = {
          ...outcome.authoringIr,
          origin: result.draft.authoring_ir_json?.origin ?? {
            provider,
            ingested_at: new Date().toISOString(),
            raw_context: null,
          },
          source: {
            poster_messages:
              result.draft.authoring_ir_json?.source.poster_messages ?? [],
            uploaded_artifact_ids: (
              result.draft.uploaded_artifacts_json ?? []
            ).map((artifact) => artifact.id ?? artifact.uri),
          },
        };
        try {
          updatedDraft = await completeDraftCompilation({
            db,
            draft: compilingDraft,
            state: outcome.state,
            intentJson: intent,
            authoringIrJson: updatedAuthoringIr,
            uploadedArtifactsJson: result.draft.uploaded_artifacts_json ?? [],
            compilationJson: outcome.compilation ?? null,
            expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
            updateAuthoringDraftImpl,
            getAuthoringDraftViewByIdImpl,
            logger: getRequestLogger(c),
          });
        } catch (error) {
          if (error instanceof AuthoringDraftWriteConflictError) {
            return jsonError(c, draftConflictError());
          }
          throw error;
        }

        await safelyDeliverDraftLifecycleEvent(
          {
            event: "draft_compiled",
            draft: updatedDraft,
            logger: getRequestLogger(c),
          },
          deliverAuthoringDraftLifecycleEventImpl,
        );

        return c.json({
          data: buildAuthoringDraftResponse(updatedDraft),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let failedDraft: AuthoringDraftViewRow;
        try {
          failedDraft = await failDraft({
            db,
            draft: compilingDraft,
            intentJson: intent,
            authoringIrJson: compilingAuthoringIr,
            uploadedArtifactsJson: result.draft.uploaded_artifacts_json ?? [],
            compilationJson: null,
            message,
            expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
            updateAuthoringDraftImpl,
            getAuthoringDraftViewByIdImpl,
            logger: getRequestLogger(c),
          });
        } catch (conflictError) {
          if (conflictError instanceof AuthoringDraftWriteConflictError) {
            return jsonError(c, draftConflictError());
          }
          throw conflictError;
        }

        await safelyDeliverDraftLifecycleEvent(
          {
            event: "draft_compile_failed",
            draft: failedDraft,
            logger: getRequestLogger(c),
          },
          deliverAuthoringDraftLifecycleEventImpl,
        );

        return jsonError(c, {
          status: 422,
          code: "AUTHORING_DRAFT_COMPILE_FAILED",
          message,
        });
      }
    },
  );

  router.post(
    "/external/drafts/:id/publish",
    zValidator("json", publishExternalAuthoringDraftRequestSchema),
    async (c) => {
      const provider = c.get("authoringSourceProvider");
      if (!provider) {
        throw new Error(
          "Authoring source provider missing from request context. Next step: retry the request after re-authenticating the integration partner.",
        );
      }

      const rateLimitError = partnerWriteRateLimitError(
        c,
        provider,
        "/api/authoring/external/drafts/publish",
        consumeWriteQuotaImpl,
      );
      if (rateLimitError) {
        return rateLimitError;
      }

      const db = createSupabaseClientImpl(true);
      const result = await readPartnerDraft({
        id: c.req.param("id"),
        provider,
        getAuthoringDraftViewByIdImpl,
        createSupabaseClientImpl,
      });
      if (!result.draft) {
        return draftLookupErrorResponse(c, result.error);
      }

      const body = c.req.valid("json");
      if (body.funding === "poster") {
        return jsonError(c, {
          status: 501,
          code: "AUTHORING_EXTERNAL_POSTER_FUNDING_NOT_ENABLED",
          message:
            "Poster-funded external publishing is not enabled yet. Next step: omit funding or set funding to \"sponsor\" and retry.",
        });
      }
      const returnTo = resolveAuthoringDraftReturnUrl({
        draft: result.draft,
        requestedReturnTo: body.return_to,
        runtimeConfig: readAuthoringPartnerRuntimeConfigImpl(),
      });
      if (!returnTo.ok) {
        return jsonError(c, returnTo.error);
      }

      if (
        result.draft.state === "published" &&
        result.draft.published_spec_cid
      ) {
        const publishedLink = await getPublishedChallengeLinkByDraftIdImpl(
          db,
          result.draft.id,
        );
        return c.json({
          data: {
            ...buildAuthoringDraftResponse({
              ...result.draft,
              published_challenge_id: publishedLink?.challenge_id ?? null,
            }),
            specCid: result.draft.published_spec_cid,
            spec:
              result.draft.published_spec_json ??
              result.draft.compilation_json?.challenge_spec,
            returnTo: publishedLink?.return_to ?? returnTo.returnTo,
            challenge:
              publishedLink?.challenge_id == null
                ? null
                : { challengeId: publishedLink.challenge_id },
          },
        });
      }

      if (
        result.draft.state !== "ready" ||
        !result.draft.compilation_json
      ) {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_DRAFT_NOT_READY",
          message:
            "Authoring draft is not ready to publish. Next step: compile the draft successfully before publishing.",
        });
      }

      const sponsorRuntime = readAuthoringSponsorRuntimeConfigImpl();
      if (!sponsorRuntime.privateKey) {
        return jsonError(c, {
          status: 503,
          code: "AUTHORING_SPONSOR_DISABLED",
          message:
            "Sponsored external publishing is not configured. Next step: set AGORA_AUTHORING_SPONSOR_PRIVATE_KEY on the API and retry.",
        });
      }

      const canonicalSpec = withAuthoringDraftSourceAttribution(
        await canonicalizeChallengeSpecImpl(
          result.draft.compilation_json.challenge_spec,
          {
            resolveOfficialPresetDigests: true,
          },
        ),
        getAuthoringDraftSourceAttribution(result.draft),
      );
      const scoreability = validateChallengeScoreability(canonicalSpec);
      if (!scoreability.ok) {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_DRAFT_NOT_SCOREABLE",
          message: `Authoring draft cannot publish because the compiled challenge spec is not scoreable yet. ${scoreability.errors.join(" ")} Next step: keep it in review or switch to Expert Mode.`,
        });
      }

      const specCid = await pinJSONImpl(
        `challenge-${result.draft.id}`,
        canonicalSpec,
      );
      const published = await sponsorAndPublishAuthoringDraftImpl({
        db,
        draft: result.draft,
        spec: canonicalSpec,
        specCid,
        sponsorPrivateKey: sponsorRuntime.privateKey,
        sponsorMonthlyBudgetUsdc:
          sponsorRuntime.monthlyBudgetsUsdc?.[provider] ?? null,
        returnTo: returnTo.returnTo,
        expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
        updateAuthoringDraftImpl,
        getAuthoringDraftViewByIdImpl,
        logger: getRequestLogger(c),
      });

      // Hosts must treat publish callbacks as best-effort, unordered signals.
      await safelyDeliverDraftLifecycleEvent(
        {
          event: "draft_published",
          draft: published.draft,
          logger: getRequestLogger(c),
        },
        deliverAuthoringDraftLifecycleEventImpl,
      );
      await safelyDeliverChallengeLifecycleEvent(
        {
          event: "challenge_created",
          draft: published.draft,
          challenge: {
            challenge_id: published.challenge.challengeId,
            contract_address: published.challenge.challengeAddress,
            factory_challenge_id: published.challenge.factoryChallengeId,
            status: "open",
            deadline: canonicalSpec.deadline,
            reward_total: canonicalSpec.reward.total,
            tx_hash: published.txHash,
            winner_solver_address: null,
          },
          logger: getRequestLogger(c),
        },
        deliverChallengeLifecycleEventImpl,
      );

      return c.json({
        data: {
          ...buildAuthoringDraftResponse({
            ...published.draft,
            published_challenge_id: published.challenge.challengeId,
          }),
          specCid,
          spec: canonicalSpec,
          returnTo: returnTo.returnTo,
          returnToSource: returnTo.source,
          txHash: published.txHash,
          sponsorAddress: published.sponsorAddress,
          challenge: published.challenge,
        },
      });
    },
  );

  router.post(
    "/external/drafts/:id/webhook",
    zValidator("json", registerAuthoringDraftWebhookRequestSchema),
    async (c) => {
      const provider = c.get("authoringSourceProvider");
      if (!provider) {
        throw new Error(
          "Authoring source provider missing from request context. Next step: retry the request after re-authenticating the integration partner.",
        );
      }

      const rateLimitError = partnerWriteRateLimitError(
        c,
        provider,
        "/api/authoring/external/drafts/webhook",
        consumeWriteQuotaImpl,
      );
      if (rateLimitError) {
        return rateLimitError;
      }

      const result = await readPartnerDraft({
        id: c.req.param("id"),
        provider,
        getAuthoringDraftViewByIdImpl,
        createSupabaseClientImpl,
      });
      if (!result.draft) {
        return draftLookupErrorResponse(c, result.error);
      }

      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const updatedDraft = await registerDraftCallback({
        db,
        draft: result.draft,
        callbackUrl: body.callback_url,
        upsertAuthoringCallbackTargetImpl,
        getAuthoringDraftViewByIdImpl,
        logger: getRequestLogger(c),
      });

      return c.json({
        data: buildAuthoringDraftResponse(updatedDraft),
      });
    },
  );

  return router;
}

export default createAuthoringSourcesRouter();
