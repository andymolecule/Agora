import type { Context, Next } from "hono";
import { jsonError } from "../lib/api-error.js";
import { consumeWriteQuota } from "../lib/rate-limit.js";
import type { ApiEnv } from "../types.js";

function getRequesterKey(c: Context<ApiEnv>) {
  const agentId = c.get("agentId");
  if (typeof agentId === "string" && agentId.length > 0) {
    return `agent:${agentId}`;
  }

  const sessionAddress = c.get("sessionAddress");
  if (typeof sessionAddress === "string" && sessionAddress.length > 0) {
    return `session:${sessionAddress.toLowerCase()}`;
  }

  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim();
    if (ip) return `ip:${ip}`;
  }

  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return `ip:${cfIp}`;

  return "anonymous";
}

export function requireWriteQuota(routeKey: string) {
  return async (c: Context<ApiEnv>, next: Next) => {
    const requesterKey = getRequesterKey(c);
    const quota = consumeWriteQuota(requesterKey, routeKey);
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

    await next();
  };
}
