import { Hono } from "hono";
import type { ApiEnv } from "../types.js";
import challengeRoutes from "./challenges.js";

const router = new Hono<ApiEnv>();

// Legacy paid compatibility alias. The canonical remote surface is /api/challenges.
router.route("/", challengeRoutes);

export default router;
