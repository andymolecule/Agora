import {
  AgoraError,
  type AuthoringArtifactOutput,
  type AuthoringPartnerProviderOutput,
  clarifyAuthoringDraftRequestSchema,
  compileAuthoringDraftRequestSchema,
  createAuthoringSourceDraftRequestSchema,
  readAuthoringPartnerRuntimeConfig,
  readAuthoringReviewRuntimeConfig,
  registerAuthoringDraftWebhookRequestSchema,
} from "@agora/common";
import {
  type AuthoringDraftViewRow,
  AuthoringDraftWriteConflictError,
  createAuthoringDraft,
  createSupabaseClient,
  getAuthoringDraftViewById,
  updateAuthoringDraft,
  upsertAuthoringCallbackTarget,
} from "@agora/db";
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
  draftBelongsToProvider,
  sweepPendingAuthoringDraftLifecycleEvents,
} from "../lib/authoring-drafts.js";
import { resolveProviderFromBearerToken } from "../lib/authoring-source-auth.js";
import { createExternalAuthoringDraft } from "../lib/authoring-source-import.js";
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
  const session = await input.getAuthoringDraftViewByIdImpl(db, input.id);
  if (!session || !draftBelongsToProvider(session, input.provider)) {
    return { session: null, error: buildDraftNotFoundError() };
  }
  if (isAuthoringDraftExpired(session)) {
    return { session: null, error: buildExpiredDraftError() };
  }
  return { session, error: null };
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
        draftId: input.session.id,
        provider: input.session.authoring_ir_json?.origin.provider ?? "direct",
        eventType: input.event,
        message: error instanceof Error ? error.message : String(error),
      },
      "Authoring draft lifecycle delivery threw unexpectedly",
    );
    return false;
  }
}

type AuthoringSourcesRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthoringDraft?: typeof createAuthoringDraft;
  getAuthoringDraftViewById?: typeof getAuthoringDraftViewById;
  updateAuthoringDraft?: typeof updateAuthoringDraft;
  compileManagedAuthoringDraftOutcome?: typeof compileManagedAuthoringDraftOutcome;
  normalizeExternalArtifactsForDraft?: typeof normalizeExternalArtifactsForDraft;
  readAuthoringPartnerRuntimeConfig?: typeof readAuthoringPartnerRuntimeConfig;
  readAuthoringReviewRuntimeConfig?: typeof readAuthoringReviewRuntimeConfig;
  consumeWriteQuota?: typeof consumeWriteQuota;
  upsertAuthoringCallbackTarget?: typeof upsertAuthoringCallbackTarget;
  deliverAuthoringDraftLifecycleEvent?: typeof deliverAuthoringDraftLifecycleEvent;
  sweepPendingAuthoringDraftLifecycleEvents?: typeof sweepPendingAuthoringDraftLifecycleEvents;
};

export function createAuthoringSourcesRouter(
  dependencies: AuthoringSourcesRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const {
    createSupabaseClient: createSupabaseClientImpl,
    createAuthoringDraft: createAuthoringDraftImpl,
    getAuthoringDraftViewById: getAuthoringDraftViewByIdImpl,
    updateAuthoringDraft: updateAuthoringDraftImpl,
    compileManagedAuthoringDraftOutcome:
      compileManagedAuthoringDraftOutcomeImpl,
    normalizeExternalArtifactsForDraft: normalizeExternalArtifactsForDraftImpl,
    readAuthoringPartnerRuntimeConfig: readAuthoringPartnerRuntimeConfigImpl,
    readAuthoringReviewRuntimeConfig: readAuthoringReviewRuntimeConfigImpl,
    consumeWriteQuota: consumeWriteQuotaImpl,
    upsertAuthoringCallbackTarget: upsertAuthoringCallbackTargetImpl,
    deliverAuthoringDraftLifecycleEvent:
      deliverAuthoringDraftLifecycleEventImpl,
    sweepPendingAuthoringDraftLifecycleEvents:
      sweepPendingAuthoringDraftLifecycleEventsImpl,
  } = {
    createSupabaseClient,
    createAuthoringDraft,
    getAuthoringDraftViewById,
    updateAuthoringDraft,
    compileManagedAuthoringDraftOutcome,
    normalizeExternalArtifactsForDraft,
    readAuthoringPartnerRuntimeConfig,
    readAuthoringReviewRuntimeConfig,
    consumeWriteQuota,
    upsertAuthoringCallbackTarget,
    deliverAuthoringDraftLifecycleEvent,
    sweepPendingAuthoringDraftLifecycleEvents,
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
        const session = await createExternalAuthoringDraft({
          provider,
          body,
          createSupabaseClientImpl,
          createAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
          normalizeExternalArtifactsForDraftImpl,
          logger: getRequestLogger(c),
        });
        return c.json({
          data: buildAuthoringDraftResponse(session),
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
    if (!result.session) {
      return draftLookupErrorResponse(c, result.error);
    }

    return c.json({
      data: buildAuthoringDraftResponse(result.session),
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
    if (!result.session) {
      return draftLookupErrorResponse(c, result.error);
    }

    return c.json({
      data: {
        card: buildAuthoringDraftCard(result.session),
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
      if (!result.session) {
        return draftLookupErrorResponse(c, result.error);
      }
      if (result.session.state === "published") {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_DRAFT_PUBLISHED",
          message:
            "Authoring draft is already published and can no longer be changed. Next step: create a new draft from the updated host thread and retry.",
        });
      }
      if (result.session.state === "compiling") {
        return jsonError(c, draftBusyError());
      }

      const body = c.req.valid("json");
      let mergedMessages: NonNullable<
        AuthoringDraftViewRow["authoring_ir_json"]
      >["source"]["poster_messages"];
      try {
        mergedMessages = mergeExternalMessages(
          result.session.authoring_ir_json?.source.poster_messages ?? [],
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
        });
      } catch (error) {
        return artifactNormalizationErrorResponse(c, error);
      }
      const mergedArtifacts = mergeExternalArtifacts(
        result.session.uploaded_artifacts_json ?? [],
        normalizedArtifacts,
      );
      const authoringIr = buildManagedAuthoringIr({
        intent: result.session.intent_json,
        uploadedArtifacts: mergedArtifacts,
        sourceMessages: mergedMessages,
        origin: {
          provider,
          external_id:
            result.session.authoring_ir_json?.origin.external_id ?? null,
          external_url:
            result.session.authoring_ir_json?.origin.external_url ?? null,
          ingested_at: result.session.authoring_ir_json?.origin.ingested_at,
          raw_context:
            body.raw_context ??
            result.session.authoring_ir_json?.origin.raw_context ??
            null,
        },
      });
      const db = createSupabaseClientImpl(true);
      let updatedSession: AuthoringDraftViewRow;
      try {
        updatedSession = await refreshDraftIr({
          db,
          session: result.session,
          state: buildDraftUpdatedState(result.session.state),
          intentJson: result.session.intent_json,
          authoringIrJson: authoringIr,
          uploadedArtifactsJson: mergedArtifacts,
          expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
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
          session: updatedSession,
          logger: getRequestLogger(c),
        },
        deliverAuthoringDraftLifecycleEventImpl,
      );

      return c.json({
        data: buildAuthoringDraftResponse(updatedSession),
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
      if (!result.session) {
        return draftLookupErrorResponse(c, result.error);
      }
      if (result.session.state === "compiling") {
        return jsonError(c, draftBusyError());
      }
      if (result.session.state === "published") {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_DRAFT_PUBLISHED",
          message:
            "Authoring draft is already published and can no longer be recompiled. Next step: create a new draft from the updated host thread and retry.",
        });
      }

      const body = c.req.valid("json");
      const intent = body.intent ?? result.session.intent_json;
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
        uploadedArtifacts: result.session.uploaded_artifacts_json ?? [],
        sourceMessages:
          result.session.authoring_ir_json?.source.poster_messages ?? [],
        origin: result.session.authoring_ir_json?.origin ?? { provider },
      });
      let compilingSession: AuthoringDraftViewRow;
      try {
        compilingSession = await markDraftCompiling({
          db,
          session: result.session,
          intentJson: intent,
          authoringIrJson: compilingAuthoringIr,
          expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
          updateAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
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
          uploadedArtifacts: result.session.uploaded_artifacts_json ?? [],
        });
        let updatedSession: AuthoringDraftViewRow;
        const updatedAuthoringIr = {
          ...outcome.authoringIr,
          origin: result.session.authoring_ir_json?.origin ?? {
            provider,
            ingested_at: new Date().toISOString(),
            raw_context: null,
          },
          source: {
            poster_messages:
              result.session.authoring_ir_json?.source.poster_messages ?? [],
            uploaded_artifact_ids: (
              result.session.uploaded_artifacts_json ?? []
            ).map((artifact) => artifact.id ?? artifact.uri),
          },
        };
        try {
          updatedSession = await completeDraftCompilation({
            db,
            session: compilingSession,
            state: outcome.state,
            intentJson: intent,
            authoringIrJson: updatedAuthoringIr,
            uploadedArtifactsJson: result.session.uploaded_artifacts_json ?? [],
            compilationJson: outcome.compilation ?? null,
            expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
            updateAuthoringDraftImpl,
            getAuthoringDraftViewByIdImpl,
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
            session: updatedSession,
            logger: getRequestLogger(c),
          },
          deliverAuthoringDraftLifecycleEventImpl,
        );

        return c.json({
          data: buildAuthoringDraftResponse(updatedSession),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let failedSession: AuthoringDraftViewRow;
        try {
          failedSession = await failDraft({
            db,
            session: compilingSession,
            intentJson: intent,
            authoringIrJson: compilingAuthoringIr,
            uploadedArtifactsJson: result.session.uploaded_artifacts_json ?? [],
            compilationJson: null,
            message,
            expiresInMs: EXTERNAL_DRAFT_EXPIRY_MS,
            updateAuthoringDraftImpl,
            getAuthoringDraftViewByIdImpl,
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
            session: failedSession,
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
      if (!result.session) {
        return draftLookupErrorResponse(c, result.error);
      }

      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const updatedSession = await registerDraftCallback({
        db,
        session: result.session,
        callbackUrl: body.callback_url,
        upsertAuthoringCallbackTargetImpl,
        getAuthoringDraftViewByIdImpl,
      });

      return c.json({
        data: buildAuthoringDraftResponse(updatedSession),
      });
    },
  );

  return router;
}

export default createAuthoringSourcesRouter();
