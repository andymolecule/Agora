import { z } from "zod";

const runtimeSchema = z.object({
  AGORA_MANAGED_AUTHORING_COMPILER_BACKEND: z
    .enum(["heuristic", "openai_compatible"])
    .default("heuristic"),
  AGORA_MANAGED_AUTHORING_MODEL: z.string().trim().min(1).optional(),
  AGORA_MANAGED_AUTHORING_BASE_URL: z
    .string()
    .url()
    .default("https://api.openai.com/v1"),
  AGORA_MANAGED_AUTHORING_API_KEY: z.string().trim().min(1).optional(),
  AGORA_MANAGED_AUTHORING_DRY_RUN_TIMEOUT_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(180_000),
});

export interface ManagedAuthoringRuntimeConfig {
  compilerBackend: "heuristic" | "openai_compatible";
  model?: string;
  baseUrl: string;
  apiKey?: string;
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

  if (parsed.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND === "openai_compatible") {
    if (!parsed.AGORA_MANAGED_AUTHORING_MODEL) {
      throw new Error(
        "Managed authoring with openai_compatible backend requires AGORA_MANAGED_AUTHORING_MODEL. Next step: set the model id or switch AGORA_MANAGED_AUTHORING_COMPILER_BACKEND back to heuristic.",
      );
    }
    if (!parsed.AGORA_MANAGED_AUTHORING_API_KEY) {
      throw new Error(
        "Managed authoring with openai_compatible backend requires AGORA_MANAGED_AUTHORING_API_KEY. Next step: set the API key or switch AGORA_MANAGED_AUTHORING_COMPILER_BACKEND back to heuristic.",
      );
    }
  }

  return {
    compilerBackend: parsed.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND,
    model: parsed.AGORA_MANAGED_AUTHORING_MODEL,
    baseUrl: parsed.AGORA_MANAGED_AUTHORING_BASE_URL,
    apiKey: parsed.AGORA_MANAGED_AUTHORING_API_KEY,
    dryRunTimeoutMs: parsed.AGORA_MANAGED_AUTHORING_DRY_RUN_TIMEOUT_MS,
  };
}
