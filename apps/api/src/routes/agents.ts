import {
  registerAgentRequestSchema,
  registerAgentResponseSchema,
  type RegisterAgentRequestInput,
  type RegisterAgentResponseOutput,
} from "@agora/common";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { jsonAuthoringSessionApiError } from "../lib/authoring-session-api-error.js";
import { registerAgent } from "../lib/auth-store.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";

interface AgentRoutesDeps {
  registerAgent?: (
    input: RegisterAgentRequestInput,
  ) => Promise<RegisterAgentResponseOutput>;
  requireWriteQuota?: typeof requireWriteQuota;
}

export function createAgentRoutes(deps: AgentRoutesDeps = {}) {
  const registerAgentImpl = deps.registerAgent ?? registerAgent;
  const requireWriteQuotaImpl = deps.requireWriteQuota ?? requireWriteQuota;
  const router = new Hono<ApiEnv>();

  router.post(
    "/register",
    requireWriteQuotaImpl("/api/agents/register"),
    zValidator("json", registerAgentRequestSchema, (result, c) => {
      if (!result.success) {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "Invalid agent registration payload.",
          nextAction: "Fix the request body and retry.",
        });
      }
    }),
    async (c) => {
      const registration = await registerAgentImpl(c.req.valid("json"));
      return c.json(registerAgentResponseSchema.parse(registration));
    },
  );

  return router;
}

export default createAgentRoutes();
