import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { jsonError } from "../lib/api-error.js";
import { getSession } from "../lib/auth-store.js";
import type { ApiEnv } from "../types.js";

export async function requireSiweSession(c: Context<ApiEnv>, next: Next) {
  const token = getCookie(c, "agora_session");
  const session = await getSession(token);
  if (!session) {
    return jsonError(c, {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized.",
    });
  }

  c.set("sessionAddress", session.address);
  await next();
}
