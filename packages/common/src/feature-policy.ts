import { parseBooleanFlag } from "./env.js";

export type AgoraFeaturePolicy = {
  enableNonCoreFeatures: boolean;
  scorePreviewEnabled: boolean;
  x402Enabled: boolean;
  x402ReportOnly: boolean;
  allowMcpRemotePrivateKeys: boolean;
};

export function readFeaturePolicy(
  env: Record<string, string | undefined> = process.env,
): AgoraFeaturePolicy {
  const enableNonCoreFeatures = parseBooleanFlag(
    env.AGORA_ENABLE_NON_CORE_FEATURES,
    false,
  );

  const x402Enabled =
    enableNonCoreFeatures && parseBooleanFlag(env.AGORA_X402_ENABLED, false);
  const x402ReportOnly =
    x402Enabled && parseBooleanFlag(env.AGORA_X402_REPORT_ONLY, false);
  const scorePreviewEnabled =
    enableNonCoreFeatures &&
    parseBooleanFlag(env.AGORA_ENABLE_SCORE_PREVIEW, false);
  const allowMcpRemotePrivateKeys =
    enableNonCoreFeatures &&
    parseBooleanFlag(env.AGORA_MCP_ALLOW_REMOTE_PRIVATE_KEYS, false);

  return {
    enableNonCoreFeatures,
    scorePreviewEnabled,
    x402Enabled,
    x402ReportOnly,
    allowMcpRemotePrivateKeys,
  };
}
