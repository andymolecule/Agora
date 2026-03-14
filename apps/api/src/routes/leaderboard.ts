import { createSupabaseClient, getPublicLeaderboard } from "@agora/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

type LeaderboardRouteDeps = {
  createSupabaseClient: typeof createSupabaseClient;
  getPublicLeaderboard: typeof getPublicLeaderboard;
};

const defaultDeps: LeaderboardRouteDeps = {
  createSupabaseClient,
  getPublicLeaderboard,
};

export function createLeaderboardRouter(
  deps: LeaderboardRouteDeps = defaultDeps,
) {
  const router = new Hono<ApiEnv>();

  router.get("/", async (c) => {
    const db = deps.createSupabaseClient(true);
    const data = await deps.getPublicLeaderboard(db);
    return c.json({ data });
  });

  return router;
}

export default createLeaderboardRouter();
