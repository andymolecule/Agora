import fs from "node:fs/promises";
import path from "node:path";
import {
  readExecutorServerRuntimeConfig,
  scorerExecutorHealthResponseSchema,
  scorerExecutorPreflightRequestSchema,
  scorerExecutorPreflightResponseSchema,
  scorerExecutorRunRequestSchema,
  scorerExecutorRunResponseSchema,
  type ScorerExecutorBackend,
} from "@agora/common";
import {
  cleanupWorkspace,
  createScoringWorkspace,
  ensureDockerReady,
  ensureScorerImagePullable,
  runScorer,
  type RunScorerInput,
  type RunnerScoreResult,
} from "@agora/scorer-runtime";
import { Hono } from "hono";

type ExecutorEnv = Record<string, never>;

export interface ExecutorAppDeps {
  backend: ScorerExecutorBackend;
  authToken?: string;
  runScorer: (input: RunScorerInput) => Promise<RunnerScoreResult>;
  ensureReady: () => Promise<void>;
  preflightImages: (images: string[]) => Promise<number>;
}

function buildDefaultDeps(): ExecutorAppDeps {
  return {
    backend: "local_docker",
    authToken: readExecutorServerRuntimeConfig().authToken,
    runScorer,
    ensureReady: ensureDockerReady,
    preflightImages: async (images) => {
      for (const image of images) {
        await ensureScorerImagePullable(image, 60_000);
      }
      return images.length;
    },
  };
}

function getAuthErrorMessage() {
  return "Executor authorization failed. Next step: verify the bearer token shared with the orchestrator.";
}

async function requireExecutorAuth(
  token: string | undefined,
  request: Request,
) {
  if (!token) return null;
  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${token}`) {
    return null;
  }
  return new Response(JSON.stringify({ error: getAuthErrorMessage() }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function sanitizeUploadedFileName(fileName: string) {
  const basename = path.basename(fileName);
  if (!basename || basename === "." || basename === "..") {
    throw new Error(
      "Executor received an invalid uploaded filename. Next step: retry with a clean orchestrator request.",
    );
  }
  return basename;
}

async function stageUploadedFiles(formData: FormData, inputDir: string) {
  const files = formData.getAll("files");
  if (files.length === 0) {
    throw new Error(
      "Executor request did not include any staged input files. Next step: retry from the orchestrator.",
    );
  }

  for (const value of files) {
    if (!(value instanceof File)) {
      throw new Error(
        "Executor request contained a non-file input entry. Next step: retry from the orchestrator.",
      );
    }
    const fileName = sanitizeUploadedFileName(value.name);
    const outputPath = path.join(inputDir, fileName);
    await fs.writeFile(outputPath, Buffer.from(await value.arrayBuffer()));
  }
}

export function createApp(deps: Partial<ExecutorAppDeps> = {}) {
  const resolvedDeps = {
    ...buildDefaultDeps(),
    ...deps,
  } satisfies ExecutorAppDeps;

  const app = new Hono<{ Bindings: ExecutorEnv }>();

  app.use("*", async (c, next) => {
    const authError = await requireExecutorAuth(
      resolvedDeps.authToken,
      c.req.raw,
    );
    if (authError) {
      return authError;
    }
    await next();
  });

  app.get("/healthz", async (c) => {
    await resolvedDeps.ensureReady();
    return c.json(
      scorerExecutorHealthResponseSchema.parse({
        ok: true,
        service: "executor",
        backend: resolvedDeps.backend,
      }),
    );
  });

  app.post("/preflight", async (c) => {
    const parsed = scorerExecutorPreflightRequestSchema.parse(
      await c.req.json(),
    );
    const preflightedImages = await resolvedDeps.preflightImages(parsed.images);
    return c.json(
      scorerExecutorPreflightResponseSchema.parse({
        ok: true,
        preflightedImages,
      }),
    );
  });

  app.post("/execute", async (c) => {
    const formData = await c.req.formData();
    const requestRaw = formData.get("request");
    if (typeof requestRaw !== "string") {
      return c.json(
        {
          error:
            "Executor request is missing its JSON metadata. Next step: retry from the orchestrator.",
        },
        400,
      );
    }

    const request = scorerExecutorRunRequestSchema.parse(JSON.parse(requestRaw));
    const workspace = await createScoringWorkspace();
    try {
      await stageUploadedFiles(formData, workspace.inputDir);
      const result = await resolvedDeps.runScorer({
        image: request.image,
        inputDir: workspace.inputDir,
        env: request.env,
        timeoutMs: request.timeoutMs,
        limits: request.limits,
        strictPull: request.strictPull,
      });
      const scoreJson = await fs.readFile(result.outputPath, "utf8");
      return c.json(
        scorerExecutorRunResponseSchema.parse({
          ok: result.ok,
          score: result.score,
          error: result.error,
          details: result.details,
          log: result.log,
          scoreJson,
          containerImageDigest: result.containerImageDigest,
        }),
      );
    } finally {
      await cleanupWorkspace(workspace.root);
    }
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.onError((error, c) => {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      500,
    );
  });

  return app;
}
