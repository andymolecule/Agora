import { readAuthoringPartnerRuntimeConfig } from "@agora/common";
import {
  createAuthoringDraft,
  createSupabaseClient,
  getAuthoringDraftViewById,
} from "@agora/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { jsonError, toApiErrorResponse } from "../lib/api-error.js";
import { normalizeExternalArtifactsForDraft } from "../lib/authoring-artifacts.js";
import { buildAuthoringDraftResponse } from "../lib/authoring-drafts.js";
import { resolveProviderFromBearerToken } from "../lib/authoring-source-auth.js";
import { createExternalAuthoringDraft } from "../lib/authoring-source-import.js";
import { getRequestLogger } from "../lib/observability.js";
import { consumeWriteQuota } from "../lib/rate-limit.js";
import {
  beachDraftImportRequestSchema,
  normalizeBeachDraftImportRequest,
} from "../lib/source-adapters/beach-science.js";
import type { ApiEnv } from "../types.js";

function providerMismatchError() {
  return {
    status: 403 as const,
    code: "AUTHORING_SOURCE_PROVIDER_MISMATCH",
    message:
      "Beach draft import requires a beach_science partner key. Next step: use the Beach integration credentials and retry.",
  };
}

export function createBeachIntegrationsRouter(dependencies?: {
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthoringDraft?: typeof createAuthoringDraft;
  getAuthoringDraftViewById?: typeof getAuthoringDraftViewById;
  normalizeExternalArtifactsForDraft?: typeof normalizeExternalArtifactsForDraft;
  readAuthoringPartnerRuntimeConfig?: typeof readAuthoringPartnerRuntimeConfig;
  consumeWriteQuota?: typeof consumeWriteQuota;
}) {
  const router = new Hono<ApiEnv>();
  const createSupabaseClientImpl =
    dependencies?.createSupabaseClient ?? createSupabaseClient;
  const createAuthoringDraftImpl =
    dependencies?.createAuthoringDraft ?? createAuthoringDraft;
  const getAuthoringDraftViewByIdImpl =
    dependencies?.getAuthoringDraftViewById ?? getAuthoringDraftViewById;
  const normalizeExternalArtifactsForDraftImpl =
    dependencies?.normalizeExternalArtifactsForDraft ??
    normalizeExternalArtifactsForDraft;
  const readAuthoringPartnerRuntimeConfigImpl =
    dependencies?.readAuthoringPartnerRuntimeConfig ??
    readAuthoringPartnerRuntimeConfig;
  const consumeWriteQuotaImpl =
    dependencies?.consumeWriteQuota ?? consumeWriteQuota;

  router.post(
    "/drafts/import",
    zValidator("json", beachDraftImportRequestSchema, (result, c) => {
      if (!result.success) {
        return jsonError(c, {
          status: 400,
          code: "VALIDATION_ERROR",
          message:
            "Invalid Beach draft import payload. Next step: provide the thread context in the documented shape and retry.",
          extras: { issues: result.error.issues },
        });
      }
    }),
    async (c) => {
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
      if (authResult.provider !== "beach_science") {
        return jsonError(c, providerMismatchError());
      }

      const quota = consumeWriteQuotaImpl(
        "partner:beach_science",
        "/api/integrations/beach/drafts/import",
      );
      if (!quota.allowed) {
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

      const body = c.req.valid("json");
      try {
        const session = await createExternalAuthoringDraft({
          provider: "beach_science",
          body: normalizeBeachDraftImportRequest(body),
          createSupabaseClientImpl,
          createAuthoringDraftImpl,
          getAuthoringDraftViewByIdImpl,
          normalizeExternalArtifactsForDraftImpl,
          logger: getRequestLogger(c),
        });

        return c.json({
          data: {
            thread: {
              id: body.thread.id,
              url: body.thread.url,
              title: body.thread.title ?? null,
              poster_agent_handle: body.thread.poster_agent_handle ?? null,
            },
            ...buildAuthoringDraftResponse(session),
          },
        });
      } catch (error) {
        const apiError = toApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
      }
    },
  );

  return router;
}

export default createBeachIntegrationsRouter();
