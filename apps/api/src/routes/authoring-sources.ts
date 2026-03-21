import {
  type AuthoringPartnerProviderOutput,
  publishExternalAuthoringDraftRequestSchema,
  readAuthoringOperatorRuntimeConfig,
  readAuthoringPartnerRuntimeConfig,
  registerAuthoringDraftWebhookRequestSchema,
  submitAuthoringSourceDraftRequestSchema,
} from "@agora/common";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { jsonError, toApiErrorResponse } from "../lib/api-error.js";
import {
  buildAuthoringDraftCard,
  buildAuthoringDraftResponse,
} from "../lib/authoring-drafts.js";
import {
  type AuthoringExternalWorkflowDependencies,
  createAuthoringExternalWorkflow,
} from "../lib/authoring-external-workflow.js";
import { resolveProviderFromBearerToken } from "../lib/authoring-source-auth.js";
import { getRequestLogger } from "../lib/observability.js";
import { consumeWriteQuota } from "../lib/rate-limit.js";
import type { ApiEnv } from "../types.js";

const OPERATOR_HEADER_NAME = "x-agora-operator-token";

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

type AuthoringSourcesRouteDependencies =
  AuthoringExternalWorkflowDependencies & {
    readAuthoringPartnerRuntimeConfig?: typeof readAuthoringPartnerRuntimeConfig;
    readAuthoringOperatorRuntimeConfig?: typeof readAuthoringOperatorRuntimeConfig;
    consumeWriteQuota?: typeof consumeWriteQuota;
  };

export function createAuthoringSourcesRouter(
  dependencies: AuthoringSourcesRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const readAuthoringPartnerRuntimeConfigImpl =
    dependencies.readAuthoringPartnerRuntimeConfig ??
    readAuthoringPartnerRuntimeConfig;
  const readAuthoringOperatorRuntimeConfigImpl =
    dependencies.readAuthoringOperatorRuntimeConfig ??
    readAuthoringOperatorRuntimeConfig;
  const consumeWriteQuotaImpl =
    dependencies.consumeWriteQuota ?? consumeWriteQuota;
  const workflow = createAuthoringExternalWorkflow(dependencies);

  function requireAuthoringOperatorAccess(c: Context<ApiEnv>) {
    const runtime = readAuthoringOperatorRuntimeConfigImpl();
    if (!runtime.token) {
      return jsonError(c, {
        status: 503,
        code: "AUTHORING_OPERATOR_DISABLED",
        message:
          "Authoring operator access is not configured. Next step: set AGORA_AUTHORING_OPERATOR_TOKEN on the API and internal caller, then retry.",
      });
    }

    const providedToken = c.req.header(OPERATOR_HEADER_NAME);
    if (providedToken !== runtime.token) {
      return jsonError(c, {
        status: 401,
        code: "AUTHORING_OPERATOR_UNAUTHORIZED",
        message:
          "Authoring operator access denied. Next step: provide a valid operator token and retry.",
      });
    }

    return null;
  }

  router.post("/callbacks/sweep", async (c) => {
    const denied = requireAuthoringOperatorAccess(c);
    if (denied) {
      return denied;
    }

    const requestedLimit = Number(c.req.query("limit") ?? "25");
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 100)
        : 25;
    const summary = await workflow.sweepCallbacks({
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
    "/external/drafts/submit",
    zValidator("json", submitAuthoringSourceDraftRequestSchema),
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
        "/api/authoring/external/drafts/submit",
        consumeWriteQuotaImpl,
      );
      if (rateLimitError) {
        return rateLimitError;
      }

      try {
        const body = submitAuthoringSourceDraftRequestSchema.parse(
          c.req.valid("json"),
        );
        const draft = await workflow.submitDraft({
          provider,
          body,
          logger: getRequestLogger(c),
        });
        return c.json({
          data: buildAuthoringDraftResponse(draft),
        });
      } catch (error) {
        const apiError = toApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
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

    try {
      const draft = await workflow.readDraft({
        id: c.req.param("id"),
        provider,
      });
      return c.json({
        data: buildAuthoringDraftResponse(draft),
      });
    } catch (error) {
      const apiError = toApiErrorResponse(error);
      return c.json(apiError.body, apiError.status);
    }
  });

  router.get("/external/drafts/:id/card", async (c) => {
    const provider = c.get("authoringSourceProvider");
    if (!provider) {
      throw new Error(
        "Authoring source provider missing from request context. Next step: retry the request after re-authenticating the integration partner.",
      );
    }

    try {
      const draft = await workflow.readDraft({
        id: c.req.param("id"),
        provider,
      });
      return c.json({
        data: {
          card: buildAuthoringDraftCard(draft),
        },
      });
    } catch (error) {
      const apiError = toApiErrorResponse(error);
      return c.json(apiError.body, apiError.status);
    }
  });

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

      try {
        const published = await workflow.publishDraft({
          id: c.req.param("id"),
          provider,
          body: c.req.valid("json"),
          logger: getRequestLogger(c),
        });
        return c.json({
          data: {
            ...buildAuthoringDraftResponse({
              ...published.draft,
              published_challenge_id:
                published.challenge?.challengeId ??
                published.draft.published_challenge_id,
            }),
            specCid: published.specCid,
            spec: published.spec,
            returnTo: published.returnTo,
            returnToSource: published.returnToSource,
            txHash: published.txHash,
            sponsorAddress: published.sponsorAddress,
            challenge: published.challenge,
          },
        });
      } catch (error) {
        const apiError = toApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
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

      try {
        const draft = await workflow.registerWebhook({
          id: c.req.param("id"),
          provider,
          callbackUrl: c.req.valid("json").callback_url,
        });
        return c.json({
          data: buildAuthoringDraftResponse(draft),
        });
      } catch (error) {
        const apiError = toApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
      }
    },
  );

  return router;
}

export default createAuthoringSourcesRouter();
