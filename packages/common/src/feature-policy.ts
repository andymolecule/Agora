import { parseBooleanFlag } from "./env.js";

export type HermesFeaturePolicy = {
  enableNonCoreFeatures: boolean;
  scorePreviewEnabled: boolean;
  x402Enabled: boolean;
  x402ReportOnly: boolean;
  allowMcpRemotePrivateKeys: boolean;
};

export function readFeaturePolicy(
  env: Record<string, string | undefined> = process.env,
): HermesFeaturePolicy {
  const enableNonCoreFeatures = parseBooleanFlag(
    env.HERMES_ENABLE_NON_CORE_FEATURES,
    false,
  );

  const x402Enabled =
    enableNonCoreFeatures && parseBooleanFlag(env.HERMES_X402_ENABLED, false);
  const x402ReportOnly =
    x402Enabled && parseBooleanFlag(env.HERMES_X402_REPORT_ONLY, false);
  const scorePreviewEnabled =
    enableNonCoreFeatures &&
    parseBooleanFlag(env.HERMES_ENABLE_SCORE_PREVIEW, false);
  const allowMcpRemotePrivateKeys =
    enableNonCoreFeatures &&
    parseBooleanFlag(env.HERMES_MCP_ALLOW_REMOTE_PRIVATE_KEYS, false);

  return {
    enableNonCoreFeatures,
    scorePreviewEnabled,
    x402Enabled,
    x402ReportOnly,
    allowMcpRemotePrivateKeys,
  };
}
