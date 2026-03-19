import { timingSafeEqual } from "node:crypto";
import type { AuthoringPartnerProviderOutput } from "@agora/common";

function safeSecretEquals(configuredKey: string, token: string) {
  const configuredBuffer = Buffer.from(configuredKey, "utf8");
  const tokenBuffer = Buffer.from(token, "utf8");
  if (configuredBuffer.length !== tokenBuffer.length) {
    return false;
  }

  return timingSafeEqual(configuredBuffer, tokenBuffer);
}

export function resolveProviderFromBearerToken(
  authorizationHeader: string | undefined,
  partnerKeys: Partial<Record<AuthoringPartnerProviderOutput, string>>,
) {
  if (!authorizationHeader || authorizationHeader.trim().length === 0) {
    return {
      ok: false as const,
      code: "AUTHORING_SOURCE_MISSING_AUTH",
      message:
        "Authoring source access denied. Next step: provide an Authorization bearer token and retry.",
    };
  }

  const match = /^Bearer\s+(.+)$/.exec(authorizationHeader);
  if (!match) {
    return {
      ok: false as const,
      code: "AUTHORING_SOURCE_INVALID_AUTH_FORMAT",
      message:
        "Authoring source access denied. Next step: send Authorization as 'Bearer <partner_key>' and retry.",
    };
  }

  const token = match[1]?.trim();
  if (!token) {
    return {
      ok: false as const,
      code: "AUTHORING_SOURCE_INVALID_AUTH_FORMAT",
      message:
        "Authoring source access denied. Next step: send Authorization as 'Bearer <partner_key>' and retry.",
    };
  }

  for (const [provider, configuredKey] of Object.entries(partnerKeys)) {
    if (
      typeof configuredKey === "string" &&
      safeSecretEquals(configuredKey, token)
    ) {
      return {
        ok: true as const,
        provider: provider as AuthoringPartnerProviderOutput,
      };
    }
  }

  return {
    ok: false as const,
    code: "AUTHORING_SOURCE_INVALID_TOKEN",
    message:
      "Authoring source access denied. Next step: provide a valid partner bearer key and retry.",
  };
}
