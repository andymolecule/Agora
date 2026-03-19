import { configSchema, parseConfigSection } from "./base.js";

const indexerHealthRuntimeConfigSchema = configSchema.pick({
  AGORA_INDEXER_CONFIRMATION_DEPTH: true,
  AGORA_INDEXER_LAG_WARN_BLOCKS: true,
  AGORA_INDEXER_LAG_CRITICAL_BLOCKS: true,
  AGORA_INDEXER_ACTIVE_CURSOR_WINDOW_MS: true,
});

export interface AgoraIndexerHealthRuntimeConfig {
  confirmationDepth: number;
  warningLagBlocks: number;
  criticalLagBlocks: number;
  activeCursorWindowMs: number;
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
