import {
  HOSTED_SOURCE_PROVIDER_VALUES,
  type HostedSourceProviderOutput,
} from "../schemas/authoring-source.js";
import {
  configSchema,
  parseConfigSection,
  unsetBlankStringValues,
} from "./base.js";

const managedAuthoringRuntimeConfigSchema = configSchema.pick({
  AGORA_MANAGED_AUTHORING_MODEL: true,
  AGORA_MANAGED_AUTHORING_BASE_URL: true,
  AGORA_MANAGED_AUTHORING_API_KEY: true,
  AGORA_MANAGED_AUTHORING_TIMEOUT_MS: true,
  AGORA_MANAGED_AUTHORING_DRY_RUN_TIMEOUT_MS: true,
});

const authoringOperatorRuntimeConfigSchema = configSchema.pick({
  AGORA_API_URL: true,
  AGORA_AUTHORING_OPERATOR_TOKEN: true,
});

const authoringSponsorRuntimeConfigSchema = configSchema.pick({
  AGORA_AUTHORING_SPONSOR_PRIVATE_KEY: true,
  AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS: true,
});

export interface AgoraManagedAuthoringRuntimeConfig {
  model: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  dryRunTimeoutMs: number;
}

export interface AgoraAuthoringOperatorRuntimeConfig {
  apiUrl?: string;
  token?: string;
}

export interface AgoraAuthoringSponsorRuntimeConfig {
  privateKey?: `0x${string}`;
  monthlyBudgetsUsdc: Partial<Record<HostedSourceProviderOutput, number>>;
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

  return {
    model: parsed.AGORA_MANAGED_AUTHORING_MODEL,
    baseUrl: parsed.AGORA_MANAGED_AUTHORING_BASE_URL,
    apiKey: parsed.AGORA_MANAGED_AUTHORING_API_KEY,
    timeoutMs: parsed.AGORA_MANAGED_AUTHORING_TIMEOUT_MS,
    dryRunTimeoutMs: parsed.AGORA_MANAGED_AUTHORING_DRY_RUN_TIMEOUT_MS,
  };
}

export function readAuthoringOperatorRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraAuthoringOperatorRuntimeConfig {
  const parsed = parseConfigSection(
    authoringOperatorRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_API_URL",
      "AGORA_AUTHORING_OPERATOR_TOKEN",
    ]),
  );

  return {
    apiUrl: parsed.AGORA_API_URL,
    token: parsed.AGORA_AUTHORING_OPERATOR_TOKEN,
  };
}

export function readAuthoringSponsorRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraAuthoringSponsorRuntimeConfig {
  function parseMonthlyBudgets(
    raw?: string,
  ): Partial<Record<HostedSourceProviderOutput, number>> {
    if (!raw || raw.trim().length === 0) {
      return {};
    }

    const budgets: Partial<Record<HostedSourceProviderOutput, number>> = {};
    for (const entry of raw.split(",")) {
      const trimmed = entry.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const delimiterIndex = trimmed.indexOf(":");
      if (delimiterIndex <= 0 || delimiterIndex === trimmed.length - 1) {
        throw new Error(
          "Invalid AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS entry. Next step: use source_provider:amount pairs such as beach_science:500.",
        );
      }
      const provider = trimmed.slice(0, delimiterIndex).trim();
      const rawAmount = trimmed.slice(delimiterIndex + 1).trim();
      if (!HOSTED_SOURCE_PROVIDER_VALUES.includes(provider as never)) {
        throw new Error(
          `Invalid AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS source provider "${provider}". Next step: use one of ${HOSTED_SOURCE_PROVIDER_VALUES.join(", ")}.`,
        );
      }
      const amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(
          `Invalid AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS amount "${rawAmount}" for ${provider}. Next step: provide a positive USDC budget such as 500.`,
        );
      }
      budgets[provider as HostedSourceProviderOutput] = amount;
    }
    return budgets;
  }

  const parsed = parseConfigSection(
    authoringSponsorRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_AUTHORING_SPONSOR_PRIVATE_KEY",
      "AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS",
    ]),
  );

  return {
    privateKey: parsed.AGORA_AUTHORING_SPONSOR_PRIVATE_KEY,
    monthlyBudgetsUsdc: parseMonthlyBudgets(
      parsed.AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS,
    ),
  };
}
