import fs from "node:fs/promises";
import path from "node:path";
import {
  readScorerExecutorRuntimeConfig,
  scorerExecutorHealthResponseSchema,
  scorerExecutorPreflightRequestSchema,
  scorerExecutorPreflightResponseSchema,
  scorerExecutorRunRequestSchema,
  scorerExecutorRunResponseSchema,
  type ScorerExecutorBackend,
} from "@agora/common";
import {
  DEFAULT_TIMEOUT_MS,
  ensureDockerReady,
  ensureScorerImagePullable,
  recreateWritableOutputDir,
  runScorer,
  type RunScorerInput,
  type RunnerScoreResult,
} from "./runner.js";

const EXECUTOR_HEALTH_PATH = "/healthz";
const EXECUTOR_PREFLIGHT_PATH = "/preflight";
const EXECUTOR_RUN_PATH = "/execute";
const EXECUTOR_REQUEST_GRACE_MS = 10_000;
const SCORE_OUTPUT_FILE_NAME = "score.json";

export interface ScorerExecutionBackendAdapter {
  backend: ScorerExecutorBackend;
  ensureReady(): Promise<void>;
  preflightOfficialImages(images: string[]): Promise<number>;
  run(input: RunScorerInput): Promise<RunnerScoreResult>;
}

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

async function getResponseErrorMessage(response: Response) {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    // Fall through to raw text.
  }
  return raw || `Request failed (${response.status}).`;
}

class LocalDockerExecutionBackend implements ScorerExecutionBackendAdapter {
  readonly backend = "local_docker" as const;

  async ensureReady() {
    await ensureDockerReady();
  }

  async preflightOfficialImages(images: string[]) {
    for (const image of images) {
      await ensureScorerImagePullable(image, 60_000);
    }
    return images.length;
  }

  async run(input: RunScorerInput) {
    return runScorer(input);
  }
}

class RemoteHttpExecutionBackend implements ScorerExecutionBackendAdapter {
  readonly backend = "remote_http" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  private buildUrl(pathname: string) {
    return `${trimTrailingSlash(this.baseUrl)}${pathname}`;
  }

  private authHeaders() {
    if (!this.token) return {};
    return {
      authorization: `Bearer ${this.token}`,
    };
  }

  async ensureReady() {
    const response = await fetch(this.buildUrl(EXECUTOR_HEALTH_PATH), {
      headers: {
        ...this.authHeaders(),
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      const message = await getResponseErrorMessage(response);
      throw new Error(
        `Remote scorer executor health check failed. Next step: verify the executor service is running and reachable. ${message}`,
      );
    }
    scorerExecutorHealthResponseSchema.parse(await response.json());
  }

  async preflightOfficialImages(images: string[]) {
    const payload = scorerExecutorPreflightRequestSchema.parse({ images });
    const response = await fetch(this.buildUrl(EXECUTOR_PREFLIGHT_PATH), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const message = await getResponseErrorMessage(response);
      throw new Error(
        `Remote scorer executor image preflight failed. Next step: verify executor Docker health and scorer image pull access. ${message}`,
      );
    }
    const parsed = scorerExecutorPreflightResponseSchema.parse(
      await response.json(),
    );
    return parsed.preflightedImages;
  }

  async run(input: RunScorerInput) {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const inputDir = path.resolve(input.inputDir);
    const outputDir = path.join(path.dirname(inputDir), "output");
    await recreateWritableOutputDir(outputDir);
    const outputPath = path.join(outputDir, SCORE_OUTPUT_FILE_NAME);

    const requestPayload = scorerExecutorRunRequestSchema.parse({
      image: input.image,
      timeoutMs,
      strictPull: input.strictPull ?? false,
      env: input.env,
      limits: input.limits,
    });

    const form = new FormData();
    form.set("request", JSON.stringify(requestPayload));
    const stagedEntries = await fs.readdir(inputDir, { withFileTypes: true });
    for (const entry of stagedEntries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(inputDir, entry.name);
      const content = await fs.readFile(filePath);
      form.append("files", new Blob([content]), entry.name);
    }

    const response = await fetch(this.buildUrl(EXECUTOR_RUN_PATH), {
      method: "POST",
      headers: {
        ...this.authHeaders(),
      },
      body: form,
      signal: AbortSignal.timeout(timeoutMs + EXECUTOR_REQUEST_GRACE_MS),
    });
    if (!response.ok) {
      const message = await getResponseErrorMessage(response);
      throw new Error(
        `Remote scorer execution failed. Next step: inspect the executor service and retry. ${message}`,
      );
    }

    const parsed = scorerExecutorRunResponseSchema.parse(await response.json());
    await fs.writeFile(outputPath, parsed.scoreJson, "utf8");

    return {
      ok: parsed.ok,
      score: parsed.score,
      error: parsed.error,
      details: parsed.details,
      log: parsed.log,
      outputPath,
      containerImageDigest: parsed.containerImageDigest,
    };
  }
}

export function createScorerExecutionBackend(): ScorerExecutionBackendAdapter {
  const runtime = readScorerExecutorRuntimeConfig();
  if (runtime.backend === "remote_http") {
    return new RemoteHttpExecutionBackend(
      runtime.url as string,
      runtime.token,
    );
  }
  return new LocalDockerExecutionBackend();
}

export async function ensureScoringBackendReady() {
  return createScorerExecutionBackend().ensureReady();
}

export async function preflightOfficialScorerImages(images: string[]) {
  return createScorerExecutionBackend().preflightOfficialImages(images);
}

export async function executeScorer(
  input: RunScorerInput,
): Promise<RunnerScoreResult> {
  return createScorerExecutionBackend().run(input);
}

export function isRemoteExecutorConfigured() {
  return readScorerExecutorRuntimeConfig().backend === "remote_http";
}
