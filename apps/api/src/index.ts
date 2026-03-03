import { serve } from "@hono/node-server";
import { loadConfig } from "@hermes/common";
import { createApp } from "./app.js";

loadConfig();

const port = Number(process.env.HERMES_API_PORT ?? 3000);
const app = createApp();

serve({ fetch: app.fetch, port });

console.log(`Hermes API listening on http://localhost:${port}`);
