import { DEFAULT_X402_NETWORK } from "./constants.js";
import { readFeaturePolicy } from "./feature-policy.js";

export type X402RuntimeConfig = {
  enabled: boolean;
  reportOnly: boolean;
  facilitatorUrl: string;
  network: string;
  payTo: string;
};

export function readX402RuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): X402RuntimeConfig {
  const policy = readFeaturePolicy(env);
  return {
    enabled: policy.x402Enabled,
    reportOnly: policy.x402ReportOnly,
    facilitatorUrl:
      env.HERMES_X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    network: env.HERMES_X402_NETWORK ?? DEFAULT_X402_NETWORK,
    payTo:
      env.HERMES_TREASURY_ADDRESS ??
      env.HERMES_USDC_ADDRESS ??
      "0x0000000000000000000000000000000000000000",
  };
}
