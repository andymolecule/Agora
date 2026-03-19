import { configSchema, parseConfigSection } from "./base.js";

const executorServerRuntimeConfigSchema = configSchema.pick({
  NODE_ENV: true,
  AGORA_EXECUTOR_PORT: true,
  AGORA_EXECUTOR_AUTH_TOKEN: true,
});

export interface AgoraExecutorServerRuntimeConfig {
  nodeEnv: string;
  port: number;
  authToken?: string;
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
