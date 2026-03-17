import { z } from "zod";
import { DEFAULT_CHAIN_ID, DEFAULT_X402_NETWORK } from "./constants.js";
import { parseBooleanLike } from "./env.js";
import { scorerExecutorBackendSchema } from "./schemas/scorer-executor.js";

const RUNTIME_VERSION_PLATFORM_ENV_KEYS = [
  "VERCEL_GIT_COMMIT_SHA",
  "RAILWAY_GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "RENDER_GIT_COMMIT",
  "CI_COMMIT_SHA",
  "SOURCE_VERSION",
  "COMMIT_SHA",
  "GIT_COMMIT_SHA",
] as const;
const COMMIT_SHA_PATTERN = /^[a-fA-F0-9]{7,64}$/;

const configSchema = z.object({
  AGORA_RPC_URL: z.string().url(),
  NODE_ENV: z.string().default("development"),
  AGORA_CHAIN_ID: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .default(DEFAULT_CHAIN_ID),
  AGORA_FACTORY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address")
    .transform((value) => value.toLowerCase() as `0x${string}`),
  AGORA_USDC_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address")
    .transform((value) => value.toLowerCase() as `0x${string}`),
  AGORA_TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address")
    .transform((value) => value.toLowerCase() as `0x${string}`)
    .optional(),
  AGORA_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32-byte hex private key")
    .transform((value) => value as `0x${string}`)
    .optional(),
  AGORA_ORACLE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32-byte hex private key")
    .transform((value) => value as `0x${string}`)
    .optional(),
  AGORA_PINATA_JWT: z.string().min(1).optional(),
  AGORA_IPFS_GATEWAY: z.string().url().optional(),
  AGORA_SUBMISSION_SEAL_KEY_ID: z.string().min(1).optional(),
  AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM: z.string().min(1).optional(),
  AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM: z.string().min(1).optional(),
  AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON: z.string().min(1).optional(),
  AGORA_SUPABASE_URL: z.string().url().optional(),
  AGORA_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  AGORA_SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
  AGORA_API_URL: z.string().url().optional(),
  AGORA_API_PORT: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .optional(),
  AGORA_MANAGED_AUTHORING_COMPILER_BACKEND: z
    .enum(["heuristic", "openai_compatible"])
    .default("heuristic"),
  AGORA_MANAGED_AUTHORING_MODEL: z.string().min(1).optional(),
  AGORA_MANAGED_AUTHORING_BASE_URL: z
    .string()
    .url()
    .default("https://api.openai.com/v1"),
  AGORA_MANAGED_AUTHORING_API_KEY: z.string().min(1).optional(),
  AGORA_POSTING_REVIEW_TOKEN: z.string().min(1).optional(),
  AGORA_MANAGED_AUTHORING_DRY_RUN_TIMEOUT_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(180_000),
  AGORA_WORKER_RUNTIME_ID: z.string().min(1).optional(),
  AGORA_RUNTIME_VERSION: z.string().min(1).optional(),
  AGORA_SCORER_EXECUTOR_BACKEND:
    scorerExecutorBackendSchema.default("local_docker"),
  AGORA_SCORER_EXECUTOR_URL: z.string().url().optional(),
  AGORA_SCORER_EXECUTOR_TOKEN: z.string().min(1).optional(),
  AGORA_EXECUTOR_PORT: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .optional(),
  AGORA_EXECUTOR_AUTH_TOKEN: z.string().min(1).optional(),
  AGORA_CORS_ORIGINS: z.string().optional(),
  AGORA_MCP_PORT: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .optional(),
  AGORA_LOG_LEVEL: z.string().min(1).optional(),
  AGORA_SENTRY_DSN: z.string().url().optional(),
  AGORA_SENTRY_ENVIRONMENT: z.string().min(1).optional(),
  AGORA_SENTRY_TRACES_SAMPLE_RATE: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().min(0).max(1),
    )
    .default(0),
  AGORA_INDEXER_START_BLOCK: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().nonnegative(),
    )
    .optional(),
  AGORA_INDEXER_CONFIRMATION_DEPTH: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().nonnegative(),
    )
    .default(3),
  AGORA_INDEXER_LAG_WARN_BLOCKS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().nonnegative(),
    )
    .default(20),
  AGORA_INDEXER_LAG_CRITICAL_BLOCKS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().nonnegative(),
    )
    .default(120),
  AGORA_INDEXER_ACTIVE_CURSOR_WINDOW_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(15 * 60 * 1000),
  AGORA_INDEXER_RETRY_MAX_ATTEMPTS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(8),
  AGORA_INDEXER_RETRY_BASE_DELAY_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(30_000),
  AGORA_INDEXER_REPLAY_WINDOW_BLOCKS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().nonnegative(),
    )
    .default(2_000),
  AGORA_WORKER_POLL_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(15_000),
  AGORA_WORKER_FINALIZE_SWEEP_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(60_000),
  AGORA_WORKER_POST_TX_RETRY_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(30_000),
  AGORA_WORKER_INFRA_RETRY_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(5 * 60 * 1000),
  AGORA_WORKER_JOB_LEASE_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(60 * 60 * 1000),
  AGORA_WORKER_HEARTBEAT_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(30_000),
  AGORA_WORKER_HEARTBEAT_STALE_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .optional(),
  AGORA_ENABLE_NON_CORE_FEATURES: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  AGORA_REQUIRE_PINNED_PRESET_DIGESTS: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(true),
  AGORA_MCP_ALLOW_REMOTE_PRIVATE_KEYS: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  AGORA_X402_ENABLED: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  AGORA_X402_REPORT_ONLY: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  AGORA_X402_FACILITATOR_URL: z
    .string()
    .url()
    .default("https://x402.org/facilitator"),
  AGORA_X402_NETWORK: z.string().min(1).default(DEFAULT_X402_NETWORK),
});

export type AgoraConfig = z.infer<typeof configSchema>;
const submissionSealPrivateKeyringSchema = z.record(
  z.string().min(1),
  z.string().min(1),
);

function normalizePem(value: string) {
  return value.trim();
}

function parseSubmissionOpenPrivateKeysJson(
  raw?: string,
): Record<string, string> {
  if (!raw) return {};
  try {
    return submissionSealPrivateKeyringSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error(
      "Invalid AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON. Next step: provide a JSON object that maps each key id to a PKCS#8 PEM private key, or remove the env var.",
    );
  }
}

function resolveSubmissionOpenPrivateKeysFromConfig(
  config: AgoraConfig,
  parsedKeyring = parseSubmissionOpenPrivateKeysJson(
    config.AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON,
  ),
): Record<string, string> {
  const privateKeys = Object.fromEntries(
    Object.entries(parsedKeyring).map(([kid, pem]) => [kid, normalizePem(pem)]),
  );

  if (
    config.AGORA_SUBMISSION_SEAL_KEY_ID &&
    config.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM
  ) {
    const activeKid = config.AGORA_SUBMISSION_SEAL_KEY_ID;
    const activePem = normalizePem(
      config.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM,
    );
    const existingPem = privateKeys[activeKid];
    if (existingPem && existingPem !== activePem) {
      throw new Error(
        `Conflicting submission sealing private keys configured for active kid ${activeKid}. Next step: make AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM match AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON or remove one source.`,
      );
    }
    privateKeys[activeKid] = activePem;
  }

  return privateKeys;
}

export function resolveSubmissionOpenPrivateKeys(
  config: AgoraConfig = loadConfig(),
) {
  return resolveSubmissionOpenPrivateKeysFromConfig(config);
}

export function resolveSubmissionOpenPrivateKeyPem(
  kid: string,
  config: AgoraConfig = loadConfig(),
) {
  return resolveSubmissionOpenPrivateKeysFromConfig(config)[kid];
}

export function listSubmissionOpenPrivateKeyIds(
  config: AgoraConfig = loadConfig(),
) {
  return Object.keys(resolveSubmissionOpenPrivateKeysFromConfig(config)).sort();
}

const ipfsConfigSchema = configSchema.pick({
  AGORA_PINATA_JWT: true,
  AGORA_IPFS_GATEWAY: true,
});
export type AgoraIpfsConfig = z.infer<typeof ipfsConfigSchema>;

const apiServerRuntimeConfigSchema = configSchema.pick({
  NODE_ENV: true,
  AGORA_API_URL: true,
  AGORA_API_PORT: true,
  AGORA_CORS_ORIGINS: true,
  AGORA_CHAIN_ID: true,
});
const apiClientRuntimeConfigSchema = configSchema.pick({
  AGORA_API_URL: true,
});
const managedAuthoringRuntimeConfigSchema = configSchema.pick({
  AGORA_MANAGED_AUTHORING_COMPILER_BACKEND: true,
  AGORA_MANAGED_AUTHORING_MODEL: true,
  AGORA_MANAGED_AUTHORING_BASE_URL: true,
  AGORA_MANAGED_AUTHORING_API_KEY: true,
  AGORA_MANAGED_AUTHORING_DRY_RUN_TIMEOUT_MS: true,
});
const postingReviewRuntimeConfigSchema = configSchema.pick({
  AGORA_API_URL: true,
  AGORA_POSTING_REVIEW_TOKEN: true,
});
const cliRuntimeConfigSchema = configSchema
  .pick({
    AGORA_RPC_URL: true,
    AGORA_API_URL: true,
    AGORA_PINATA_JWT: true,
    AGORA_PRIVATE_KEY: true,
    AGORA_FACTORY_ADDRESS: true,
    AGORA_USDC_ADDRESS: true,
    AGORA_CHAIN_ID: true,
    AGORA_SUPABASE_URL: true,
    AGORA_SUPABASE_ANON_KEY: true,
    AGORA_SUPABASE_SERVICE_KEY: true,
  })
  .partial();

const indexerHealthRuntimeConfigSchema = configSchema.pick({
  AGORA_INDEXER_CONFIRMATION_DEPTH: true,
  AGORA_INDEXER_LAG_WARN_BLOCKS: true,
  AGORA_INDEXER_LAG_CRITICAL_BLOCKS: true,
  AGORA_INDEXER_ACTIVE_CURSOR_WINDOW_MS: true,
});

const workerTimingConfigSchema = configSchema.pick({
  AGORA_WORKER_POLL_MS: true,
  AGORA_WORKER_FINALIZE_SWEEP_MS: true,
  AGORA_WORKER_POST_TX_RETRY_MS: true,
  AGORA_WORKER_INFRA_RETRY_MS: true,
  AGORA_WORKER_JOB_LEASE_MS: true,
  AGORA_WORKER_HEARTBEAT_MS: true,
  AGORA_WORKER_HEARTBEAT_STALE_MS: true,
});

const scorerExecutorRuntimeConfigSchema = configSchema.pick({
  AGORA_SCORER_EXECUTOR_BACKEND: true,
  AGORA_SCORER_EXECUTOR_URL: true,
  AGORA_SCORER_EXECUTOR_TOKEN: true,
});

const executorServerRuntimeConfigSchema = configSchema.pick({
  NODE_ENV: true,
  AGORA_EXECUTOR_PORT: true,
  AGORA_EXECUTOR_AUTH_TOKEN: true,
});

const observabilityRuntimeConfigSchema = configSchema.pick({
  NODE_ENV: true,
  AGORA_LOG_LEVEL: true,
  AGORA_SENTRY_DSN: true,
  AGORA_SENTRY_ENVIRONMENT: true,
  AGORA_SENTRY_TRACES_SAMPLE_RATE: true,
  AGORA_RUNTIME_VERSION: true,
});

export interface AgoraApiServerRuntimeConfig {
  nodeEnv: string;
  apiUrl?: string;
  apiPort: number;
  chainId: number;
  corsOrigins: string[];
}

export interface AgoraApiClientRuntimeConfig {
  apiUrl?: string;
}

export interface AgoraManagedAuthoringRuntimeConfig {
  compilerBackend: "heuristic" | "openai_compatible";
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  dryRunTimeoutMs: number;
}

export interface AgoraPostingReviewRuntimeConfig {
  apiUrl?: string;
  token?: string;
}

export type AgoraCliRuntimeConfig = z.infer<typeof cliRuntimeConfigSchema>;

export interface AgoraIndexerHealthRuntimeConfig {
  confirmationDepth: number;
  warningLagBlocks: number;
  criticalLagBlocks: number;
  activeCursorWindowMs: number;
}

export interface AgoraWorkerTimingConfig {
  pollIntervalMs: number;
  finalizeSweepIntervalMs: number;
  postTxRetryDelayMs: number;
  infraRetryDelayMs: number;
  jobLeaseMs: number;
  heartbeatIntervalMs: number;
  heartbeatStaleMs: number;
}

export interface AgoraRuntimeIdentity {
  chainId: number;
  factoryAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  rpcUrl: string;
}

export interface AgoraScorerExecutorRuntimeConfig {
  backend: "local_docker" | "remote_http";
  url?: string;
  token?: string;
}

export interface AgoraExecutorServerRuntimeConfig {
  nodeEnv: string;
  port: number;
  authToken?: string;
}

export interface AgoraObservabilityRuntimeConfig {
  nodeEnv: string;
  logLevel: string;
  runtimeVersion: string;
  sentryDsn?: string;
  sentryEnvironment: string;
  sentryTracesSampleRate: number;
}

export function hasSubmissionSealPublicConfig(config: AgoraConfig): boolean {
  return Boolean(
    config.AGORA_SUBMISSION_SEAL_KEY_ID &&
      config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
  );
}

export function hasSubmissionSealWorkerConfig(config: AgoraConfig): boolean {
  if (!hasSubmissionSealPublicConfig(config)) {
    return false;
  }
  const activeKid = config.AGORA_SUBMISSION_SEAL_KEY_ID as string;
  return Boolean(resolveSubmissionOpenPrivateKeyPem(activeKid, config));
}

function formatZodError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    return `${path}: ${issue.message}`;
  });
  return `Invalid Agora configuration. Fix the following:\n- ${lines.join("\n- ")}`;
}

function normalizeRuntimeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (COMMIT_SHA_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase().slice(0, 12);
  }
  return trimmed;
}

export function resolveAgoraRuntimeVersionFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicitRuntimeVersion = normalizeRuntimeVersion(
    env.AGORA_RUNTIME_VERSION,
  );
  const explicitPlaceholder =
    explicitRuntimeVersion?.toLowerCase() === "dev"
      ? explicitRuntimeVersion
      : null;
  if (explicitRuntimeVersion && explicitPlaceholder === null) {
    return explicitRuntimeVersion;
  }

  for (const key of RUNTIME_VERSION_PLATFORM_ENV_KEYS) {
    const resolved = normalizeRuntimeVersion(env[key]);
    if (resolved) {
      return resolved;
    }
  }

  return explicitPlaceholder;
}

function withResolvedRuntimeVersion(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    AGORA_RUNTIME_VERSION: resolveAgoraRuntimeVersionFromEnv(env) ?? "dev",
  };
}

function parseConfigSection<Schema extends z.ZodTypeAny>(
  schema: Schema,
  env: Record<string, string | undefined>,
): z.infer<Schema> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }
  return result.data;
}

function unsetBlankStringValues(
  env: Record<string, string | undefined>,
  keys: string[],
) {
  const normalized: Record<string, string | undefined> = { ...env };
  for (const key of keys) {
    if (normalized[key] === "") {
      normalized[key] = undefined;
    }
  }
  return normalized;
}

let cachedConfig: AgoraConfig | null = null;
let cachedIpfsConfig: AgoraIpfsConfig | null = null;

export function loadConfig(): AgoraConfig {
  if (cachedConfig) return cachedConfig;
  const result = configSchema.safeParse(
    withResolvedRuntimeVersion(process.env),
  );
  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }
  const config = result.data;

  const hasSealKeyId = Boolean(config.AGORA_SUBMISSION_SEAL_KEY_ID);
  const hasSealPublicKey = Boolean(config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM);
  const hasSealPrivateKey = Boolean(
    config.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM,
  );
  const parsedSubmissionOpenPrivateKeys = parseSubmissionOpenPrivateKeysJson(
    config.AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON,
  );
  const hasSealPrivateKeyring =
    Object.keys(parsedSubmissionOpenPrivateKeys).length > 0;

  if (hasSealKeyId !== hasSealPublicKey) {
    throw new Error(
      "Submission sealing public config must include AGORA_SUBMISSION_SEAL_KEY_ID and AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM together.",
    );
  }

  if (
    (hasSealPrivateKey || hasSealPrivateKeyring) &&
    !hasSubmissionSealPublicConfig(config)
  ) {
    throw new Error(
      "Submission sealing worker config requires AGORA_SUBMISSION_SEAL_KEY_ID and AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM. Next step: set the public sealing config first, then add the worker private key config.",
    );
  }

  if (
    hasSubmissionSealPublicConfig(config) &&
    (hasSealPrivateKey || hasSealPrivateKeyring)
  ) {
    const activePrivateKeyPem = resolveSubmissionOpenPrivateKeyPem(
      config.AGORA_SUBMISSION_SEAL_KEY_ID as string,
      config,
    );
    if (!activePrivateKeyPem) {
      throw new Error(
        `Submission sealing worker config is missing a private key for active kid ${config.AGORA_SUBMISSION_SEAL_KEY_ID}. Next step: set AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM or include that kid in AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON.`,
      );
    }
  }

  const missing: string[] = [];
  if (!config.AGORA_RPC_URL) missing.push("AGORA_RPC_URL");
  if (!config.AGORA_FACTORY_ADDRESS) missing.push("AGORA_FACTORY_ADDRESS");
  if (!config.AGORA_USDC_ADDRESS) missing.push("AGORA_USDC_ADDRESS");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. See .env.example for details.`,
    );
  }

  if (
    config.AGORA_SCORER_EXECUTOR_BACKEND === "remote_http" &&
    !config.AGORA_SCORER_EXECUTOR_URL
  ) {
    throw new Error(
      "Remote scorer execution requires AGORA_SCORER_EXECUTOR_URL. Next step: set the executor base URL or switch AGORA_SCORER_EXECUTOR_BACKEND back to local_docker.",
    );
  }

  cachedConfig = config;
  return cachedConfig;
}

export function loadIpfsConfig(): AgoraIpfsConfig {
  if (cachedIpfsConfig) return cachedIpfsConfig;
  const result = ipfsConfigSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }
  cachedIpfsConfig = result.data;
  return cachedIpfsConfig;
}

export function getAgoraRuntimeIdentity(
  config: AgoraConfig = loadConfig(),
): AgoraRuntimeIdentity {
  return {
    chainId: config.AGORA_CHAIN_ID,
    factoryAddress: config.AGORA_FACTORY_ADDRESS,
    usdcAddress: config.AGORA_USDC_ADDRESS,
    rpcUrl: config.AGORA_RPC_URL,
  };
}

export function resolveRuntimePrivateKey(
  config: AgoraConfig = loadConfig(),
): `0x${string}` | undefined {
  return config.AGORA_PRIVATE_KEY ?? config.AGORA_ORACLE_KEY;
}

export function readApiServerRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraApiServerRuntimeConfig {
  const parsed = parseConfigSection(
    apiServerRuntimeConfigSchema,
    unsetBlankStringValues(env, ["AGORA_API_URL", "AGORA_CORS_ORIGINS"]),
  );
  return {
    nodeEnv: parsed.NODE_ENV,
    apiUrl: parsed.AGORA_API_URL,
    apiPort: parsed.AGORA_API_PORT ?? 3000,
    chainId: parsed.AGORA_CHAIN_ID,
    corsOrigins: parsed.AGORA_CORS_ORIGINS
      ? parsed.AGORA_CORS_ORIGINS.split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      : [],
  };
}

export function readApiClientRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraApiClientRuntimeConfig {
  const parsed = parseConfigSection(
    apiClientRuntimeConfigSchema,
    unsetBlankStringValues(env, ["AGORA_API_URL"]),
  );
  return {
    apiUrl: parsed.AGORA_API_URL,
  };
}

export function readManagedAuthoringRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraManagedAuthoringRuntimeConfig {
  const parsed = parseConfigSection(
    managedAuthoringRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_MANAGED_AUTHORING_MODEL",
      "AGORA_MANAGED_AUTHORING_BASE_URL",
      "AGORA_MANAGED_AUTHORING_API_KEY",
    ]),
  );

  if (
    parsed.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND === "openai_compatible"
  ) {
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

export function readPostingReviewRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraPostingReviewRuntimeConfig {
  const parsed = parseConfigSection(
    postingReviewRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_API_URL",
      "AGORA_POSTING_REVIEW_TOKEN",
    ]),
  );

  return {
    apiUrl: parsed.AGORA_API_URL,
    token: parsed.AGORA_POSTING_REVIEW_TOKEN,
  };
}

export function readCliRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraCliRuntimeConfig {
  return parseConfigSection(
    cliRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_RPC_URL",
      "AGORA_API_URL",
      "AGORA_PINATA_JWT",
      "AGORA_PRIVATE_KEY",
      "AGORA_FACTORY_ADDRESS",
      "AGORA_USDC_ADDRESS",
      "AGORA_SUPABASE_URL",
      "AGORA_SUPABASE_ANON_KEY",
      "AGORA_SUPABASE_SERVICE_KEY",
    ]),
  );
}

export function readIndexerHealthRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraIndexerHealthRuntimeConfig {
  const parsed = parseConfigSection(indexerHealthRuntimeConfigSchema, env);
  return {
    confirmationDepth: parsed.AGORA_INDEXER_CONFIRMATION_DEPTH,
    warningLagBlocks: parsed.AGORA_INDEXER_LAG_WARN_BLOCKS,
    criticalLagBlocks: parsed.AGORA_INDEXER_LAG_CRITICAL_BLOCKS,
    activeCursorWindowMs: parsed.AGORA_INDEXER_ACTIVE_CURSOR_WINDOW_MS,
  };
}

export function readWorkerTimingConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraWorkerTimingConfig {
  const parsed = parseConfigSection(workerTimingConfigSchema, env);
  return {
    pollIntervalMs: parsed.AGORA_WORKER_POLL_MS,
    finalizeSweepIntervalMs: parsed.AGORA_WORKER_FINALIZE_SWEEP_MS,
    postTxRetryDelayMs: parsed.AGORA_WORKER_POST_TX_RETRY_MS,
    infraRetryDelayMs: parsed.AGORA_WORKER_INFRA_RETRY_MS,
    jobLeaseMs: parsed.AGORA_WORKER_JOB_LEASE_MS,
    heartbeatIntervalMs: parsed.AGORA_WORKER_HEARTBEAT_MS,
    heartbeatStaleMs:
      parsed.AGORA_WORKER_HEARTBEAT_STALE_MS ??
      parsed.AGORA_WORKER_HEARTBEAT_MS * 3,
  };
}

export function readScorerExecutorRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraScorerExecutorRuntimeConfig {
  const parsed = parseConfigSection(scorerExecutorRuntimeConfigSchema, env);
  return {
    backend: parsed.AGORA_SCORER_EXECUTOR_BACKEND,
    url: parsed.AGORA_SCORER_EXECUTOR_URL,
    token: parsed.AGORA_SCORER_EXECUTOR_TOKEN,
  };
}

export function readExecutorServerRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraExecutorServerRuntimeConfig {
  const parsed = parseConfigSection(executorServerRuntimeConfigSchema, env);
  if (parsed.NODE_ENV === "production" && !parsed.AGORA_EXECUTOR_AUTH_TOKEN) {
    throw new Error(
      "Executor auth is required in production. Next step: set AGORA_EXECUTOR_AUTH_TOKEN before starting the executor service.",
    );
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.AGORA_EXECUTOR_PORT ?? 3200,
    authToken: parsed.AGORA_EXECUTOR_AUTH_TOKEN,
  };
}

export function readObservabilityRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraObservabilityRuntimeConfig {
  const parsed = parseConfigSection(
    observabilityRuntimeConfigSchema,
    withResolvedRuntimeVersion(env),
  );
  return {
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.AGORA_LOG_LEVEL ?? "info",
    runtimeVersion: parsed.AGORA_RUNTIME_VERSION ?? "dev",
    sentryDsn: parsed.AGORA_SENTRY_DSN,
    sentryEnvironment: parsed.AGORA_SENTRY_ENVIRONMENT ?? parsed.NODE_ENV,
    sentryTracesSampleRate: parsed.AGORA_SENTRY_TRACES_SAMPLE_RATE,
  };
}

export function isProductionRuntime(
  config:
    | Pick<AgoraConfig, "NODE_ENV">
    | Pick<AgoraApiServerRuntimeConfig, "nodeEnv"> = loadConfig(),
): boolean {
  return (
    ("NODE_ENV" in config ? config.NODE_ENV : config.nodeEnv) === "production"
  );
}

export function getAgoraRuntimeVersion(
  config?: Pick<AgoraConfig, "AGORA_RUNTIME_VERSION"> | null,
): string {
  return (
    config?.AGORA_RUNTIME_VERSION ??
    resolveAgoraRuntimeVersionFromEnv() ??
    "dev"
  );
}

export function resetConfigCache() {
  cachedConfig = null;
  cachedIpfsConfig = null;
}
