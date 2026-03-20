import { readAuthoringPartnerRuntimeConfig } from "@agora/common";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { jsonError, toApiErrorResponse } from "../lib/api-error.js";
import { buildAuthoringDraftResponse } from "../lib/authoring-drafts.js";
import {
  type AuthoringExternalWorkflowDependencies,
  createAuthoringExternalWorkflow,
} from "../lib/authoring-external-workflow.js";
import { resolveProviderFromBearerToken } from "../lib/authoring-source-auth.js";
import { getRequestLogger } from "../lib/observability.js";
import { consumeWriteQuota } from "../lib/rate-limit.js";
import {
  beachDraftSubmitRequestSchema,
  normalizeBeachDraftSubmitRequest,
} from "../lib/source-adapters/beach-science.js";
import type { ApiEnv } from "../types.js";

function providerMismatchError() {
  return {
    status: 403 as const,
    code: "AUTHORING_SOURCE_PROVIDER_MISMATCH",
    message:
      "Beach draft submit requires a beach_science partner key. Next step: use the Beach integration credentials and retry.",
  };
}

export function createBeachIntegrationsRouter(
  dependencies: AuthoringExternalWorkflowDependencies & {
    readAuthoringPartnerRuntimeConfig?: typeof readAuthoringPartnerRuntimeConfig;
    consumeWriteQuota?: typeof consumeWriteQuota;
  } = {},
) {
  const router = new Hono<ApiEnv>();
  const readAuthoringPartnerRuntimeConfigImpl =
    dependencies.readAuthoringPartnerRuntimeConfig ??
    readAuthoringPartnerRuntimeConfig;
  const consumeWriteQuotaImpl =
    dependencies.consumeWriteQuota ?? consumeWriteQuota;
  const workflow = createAuthoringExternalWorkflow(dependencies);

  router.post(
    "/drafts/submit",
    zValidator("json", beachDraftSubmitRequestSchema, (result, c) => {
      if (!result.success) {
        return jsonError(c, {
          status: 400,
          code: "VALIDATION_ERROR",
          message:
            "Invalid Beach draft submit payload. Next step: provide the thread context, artifacts, and full intent in the documented shape and retry.",
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
        "/api/integrations/beach/drafts/submit",
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

      const body = beachDraftSubmitRequestSchema.parse(c.req.valid("json"));
      try {
        const session = await workflow.submitDraft({
          provider: "beach_science",
          body: normalizeBeachDraftSubmitRequest(body),
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
