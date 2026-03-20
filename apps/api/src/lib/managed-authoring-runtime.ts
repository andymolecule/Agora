import { z } from "zod";

const runtimeSchema = z.object({
  AGORA_MANAGED_AUTHORING_MODEL: z
    .string()
    .trim()
    .min(1)
    .default("claude-sonnet-4-5"),
  AGORA_MANAGED_AUTHORING_BASE_URL: z
    .string()
    .url()
    .default("https://api.anthropic.com/v1"),
  AGORA_MANAGED_AUTHORING_API_KEY: z.string().trim().min(1).optional(),
  AGORA_MANAGED_AUTHORING_TIMEOUT_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(30_000),
  AGORA_MANAGED_AUTHORING_DRY_RUN_TIMEOUT_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(180_000),
});

export interface ManagedAuthoringRuntimeConfig {
  model: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  dryRunTimeoutMs: number;
}

export function readManagedAuthoringRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): ManagedAuthoringRuntimeConfig {
  const normalizedEnv = {
    ...env,
    AGORA_MANAGED_AUTHORING_MODEL:
      env.AGORA_MANAGED_AUTHORING_MODEL?.trim() || undefined,
    AGORA_MANAGED_AUTHORING_BASE_URL:
      env.AGORA_MANAGED_AUTHORING_BASE_URL?.trim() || undefined,
    AGORA_MANAGED_AUTHORING_API_KEY:
      env.AGORA_MANAGED_AUTHORING_API_KEY?.trim() || undefined,
  };

  const parsed = runtimeSchema.parse(normalizedEnv);

  return {
    model: parsed.AGORA_MANAGED_AUTHORING_MODEL,
    baseUrl: parsed.AGORA_MANAGED_AUTHORING_BASE_URL,
    apiKey: parsed.AGORA_MANAGED_AUTHORING_API_KEY,
    timeoutMs: parsed.AGORA_MANAGED_AUTHORING_TIMEOUT_MS,
    dryRunTimeoutMs: parsed.AGORA_MANAGED_AUTHORING_DRY_RUN_TIMEOUT_MS,
  };
}
