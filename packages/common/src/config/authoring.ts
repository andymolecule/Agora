import {
  AUTHORING_PARTNER_PROVIDER_VALUES,
  type AuthoringPartnerProviderOutput,
} from "../schemas/authoring-source.js";
import {
  configSchema,
  parseConfigSection,
  unsetBlankStringValues,
} from "./base.js";

const managedAuthoringRuntimeConfigSchema = configSchema.pick({
  AGORA_MANAGED_AUTHORING_COMPILER_BACKEND: true,
  AGORA_MANAGED_AUTHORING_MODEL: true,
  AGORA_MANAGED_AUTHORING_BASE_URL: true,
  AGORA_MANAGED_AUTHORING_API_KEY: true,
  AGORA_MANAGED_AUTHORING_DRY_RUN_TIMEOUT_MS: true,
});

const authoringReviewRuntimeConfigSchema = configSchema.pick({
  AGORA_API_URL: true,
  AGORA_AUTHORING_REVIEW_TOKEN: true,
});

const authoringPartnerRuntimeConfigSchema = configSchema.pick({
  AGORA_AUTHORING_PARTNER_KEYS: true,
  AGORA_AUTHORING_PARTNER_CALLBACK_SECRETS: true,
  AGORA_AUTHORING_PARTNER_RETURN_ORIGINS: true,
});

const authoringSponsorRuntimeConfigSchema = configSchema.pick({
  AGORA_AUTHORING_SPONSOR_PRIVATE_KEY: true,
  AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS: true,
});

export interface AgoraManagedAuthoringRuntimeConfig {
  compilerBackend: "heuristic" | "openai_compatible";
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  dryRunTimeoutMs: number;
}

export interface AgoraAuthoringReviewRuntimeConfig {
  apiUrl?: string;
  token?: string;
}

export interface AgoraAuthoringPartnerRuntimeConfig {
  partnerKeys: Partial<Record<AuthoringPartnerProviderOutput, string>>;
  callbackSecrets: Partial<Record<AuthoringPartnerProviderOutput, string>>;
  returnOrigins: Partial<Record<AuthoringPartnerProviderOutput, string[]>>;
}

export interface AgoraAuthoringSponsorRuntimeConfig {
  privateKey?: `0x${string}`;
  monthlyBudgetsUsdc: Partial<Record<AuthoringPartnerProviderOutput, number>>;
}

function parseAuthoringPartnerKeys(
  raw?: string,
): Partial<Record<AuthoringPartnerProviderOutput, string>> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const partnerKeys: Partial<Record<AuthoringPartnerProviderOutput, string>> =
    {};

  for (const entry of entries) {
    const delimiterIndex = entry.indexOf(":");
    if (delimiterIndex <= 0 || delimiterIndex === entry.length - 1) {
      throw new Error(
        "Invalid AGORA_AUTHORING_PARTNER_KEYS entry. Next step: use provider:key pairs such as beach_science:secret-key.",
      );
    }

    const provider = entry.slice(0, delimiterIndex).trim();
    const key = entry.slice(delimiterIndex + 1).trim();
    if (!AUTHORING_PARTNER_PROVIDER_VALUES.includes(provider as never)) {
      throw new Error(
        `Invalid AGORA_AUTHORING_PARTNER_KEYS provider "${provider}". Next step: use one of ${AUTHORING_PARTNER_PROVIDER_VALUES.join(", ")}.`,
      );
    }
    if (key.length === 0) {
      throw new Error(
        `Invalid AGORA_AUTHORING_PARTNER_KEYS key for ${provider}. Next step: provide a non-empty bearer key.`,
      );
    }
    if (partnerKeys[provider as AuthoringPartnerProviderOutput]) {
      throw new Error(
        `Duplicate AGORA_AUTHORING_PARTNER_KEYS provider "${provider}". Next step: keep only one key per partner.`,
      );
    }
    partnerKeys[provider as AuthoringPartnerProviderOutput] = key;
  }

  return partnerKeys;
}

function parseAuthoringPartnerReturnOrigins(
  raw?: string,
): Partial<Record<AuthoringPartnerProviderOutput, string[]>> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const returnOrigins: Partial<
    Record<AuthoringPartnerProviderOutput, string[]>
  > = {};

  for (const entry of entries) {
    const delimiterIndex = entry.indexOf(":");
    if (delimiterIndex <= 0 || delimiterIndex === entry.length - 1) {
      throw new Error(
        "Invalid AGORA_AUTHORING_PARTNER_RETURN_ORIGINS entry. Next step: use provider:url pairs such as beach_science:https://beach.science.",
      );
    }

    const provider = entry.slice(0, delimiterIndex).trim();
    const rawOrigins = entry.slice(delimiterIndex + 1).trim();
    if (!AUTHORING_PARTNER_PROVIDER_VALUES.includes(provider as never)) {
      throw new Error(
        `Invalid AGORA_AUTHORING_PARTNER_RETURN_ORIGINS provider "${provider}". Next step: use one of ${AUTHORING_PARTNER_PROVIDER_VALUES.join(", ")}.`,
      );
    }
    if (returnOrigins[provider as AuthoringPartnerProviderOutput]) {
      throw new Error(
        `Duplicate AGORA_AUTHORING_PARTNER_RETURN_ORIGINS provider "${provider}". Next step: keep only one origin list per partner.`,
      );
    }

    const normalizedOrigins = [...new Set(rawOrigins.split("|"))]
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
      .map((origin) => {
        try {
          const parsed = new URL(origin);
          if (parsed.protocol !== "https:") {
            throw new Error(
              `Invalid AGORA_AUTHORING_PARTNER_RETURN_ORIGINS URL "${origin}" for ${provider}. Next step: provide HTTPS origins such as https://beach.science.`,
            );
          }
          return parsed.origin;
        } catch {
          throw new Error(
            `Invalid AGORA_AUTHORING_PARTNER_RETURN_ORIGINS URL "${origin}" for ${provider}. Next step: provide valid HTTPS origins such as https://beach.science.`,
          );
        }
      });

    if (normalizedOrigins.length === 0) {
      throw new Error(
        `Invalid AGORA_AUTHORING_PARTNER_RETURN_ORIGINS origin list for ${provider}. Next step: provide at least one allowed return origin.`,
      );
    }

    returnOrigins[provider as AuthoringPartnerProviderOutput] =
      normalizedOrigins;
  }

  return returnOrigins;
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

export function readAuthoringReviewRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraAuthoringReviewRuntimeConfig {
  const parsed = parseConfigSection(
    authoringReviewRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_API_URL",
      "AGORA_AUTHORING_REVIEW_TOKEN",
    ]),
  );

  return {
    apiUrl: parsed.AGORA_API_URL,
    token: parsed.AGORA_AUTHORING_REVIEW_TOKEN,
  };
}

export function readAuthoringPartnerRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraAuthoringPartnerRuntimeConfig {
  const parsed = parseConfigSection(authoringPartnerRuntimeConfigSchema, env);
  const partnerKeys = parseAuthoringPartnerKeys(
    parsed.AGORA_AUTHORING_PARTNER_KEYS,
  );
  const callbackSecrets = parseAuthoringPartnerKeys(
    parsed.AGORA_AUTHORING_PARTNER_CALLBACK_SECRETS,
  );
  const returnOrigins = parseAuthoringPartnerReturnOrigins(
    parsed.AGORA_AUTHORING_PARTNER_RETURN_ORIGINS,
  );
  return {
    partnerKeys,
    callbackSecrets: {
      ...partnerKeys,
      ...callbackSecrets,
    },
    returnOrigins,
  };
}

export function readAuthoringSponsorRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraAuthoringSponsorRuntimeConfig {
  function parseMonthlyBudgets(
    raw?: string,
  ): Partial<Record<AuthoringPartnerProviderOutput, number>> {
    if (!raw || raw.trim().length === 0) {
      return {};
    }

    const budgets: Partial<Record<AuthoringPartnerProviderOutput, number>> = {};
    for (const entry of raw.split(",")) {
      const trimmed = entry.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const delimiterIndex = trimmed.indexOf(":");
      if (delimiterIndex <= 0 || delimiterIndex === trimmed.length - 1) {
        throw new Error(
          "Invalid AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS entry. Next step: use provider:amount pairs such as beach_science:500.",
        );
      }
      const provider = trimmed.slice(0, delimiterIndex).trim();
      const rawAmount = trimmed.slice(delimiterIndex + 1).trim();
      if (!AUTHORING_PARTNER_PROVIDER_VALUES.includes(provider as never)) {
        throw new Error(
          `Invalid AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS provider "${provider}". Next step: use one of ${AUTHORING_PARTNER_PROVIDER_VALUES.join(", ")}.`,
        );
      }
      const amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(
          `Invalid AGORA_AUTHORING_SPONSOR_MONTHLY_BUDGETS amount "${rawAmount}" for ${provider}. Next step: provide a positive USDC budget such as 500.`,
        );
      }
      budgets[provider as AuthoringPartnerProviderOutput] = amount;
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
