import { z } from "zod";

export const scorerExecutorBackendSchema = z.enum([
  "local_docker",
  "remote_http",
]);

export const scorerExecutorLimitsSchema = z
  .object({
    memory: z.string().min(1).optional(),
    cpus: z.string().min(1).optional(),
    pids: z.number().int().positive().optional(),
  })
  .strict();

export const scorerExecutorRunRequestSchema = z
  .object({
    image: z.string().min(1),
    timeoutMs: z.number().int().positive().optional(),
    strictPull: z.boolean().optional(),
    env: z.record(z.string()).optional(),
    limits: scorerExecutorLimitsSchema.optional(),
  })
  .strict();

export const scorerExecutorRunResponseSchema = z
  .object({
    ok: z.boolean(),
    score: z.number(),
    error: z.string().optional(),
    details: z.record(z.unknown()).default({}),
    log: z.string(),
    scoreJson: z.string(),
    containerImageDigest: z.string().min(1),
  })
  .strict();

export const scorerExecutorPreflightRequestSchema = z
  .object({
    images: z.array(z.string().min(1)).max(50),
  })
  .strict();

export const scorerExecutorPreflightResponseSchema = z
  .object({
    ok: z.literal(true),
    preflightedImages: z.number().int().nonnegative(),
  })
  .strict();

export const scorerExecutorHealthResponseSchema = z
  .object({
    ok: z.literal(true),
    service: z.literal("executor"),
    backend: scorerExecutorBackendSchema,
  })
  .strict();

export type ScorerExecutorBackend = z.infer<
  typeof scorerExecutorBackendSchema
>;
export type ScorerExecutorRunRequest = z.infer<
  typeof scorerExecutorRunRequestSchema
>;
export type ScorerExecutorRunResponse = z.infer<
  typeof scorerExecutorRunResponseSchema
>;
export type ScorerExecutorPreflightRequest = z.infer<
  typeof scorerExecutorPreflightRequestSchema
>;
export type ScorerExecutorPreflightResponse = z.infer<
  typeof scorerExecutorPreflightResponseSchema
>;
