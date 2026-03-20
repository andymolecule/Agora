import type { ChallengeSpecOutput, ExternalSourceProviderOutput } from "@agora/common";
import type { AuthoringDraftViewRow } from "@agora/db";

export interface AuthoringDraftSourceAttribution {
  provider: Exclude<ExternalSourceProviderOutput, "direct">;
  externalId: string | null;
  externalUrl: string | null;
  agentHandle: string | null;
}

function firstStringValue(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
) {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function getAuthoringDraftSourceAttribution(
  draft: Pick<AuthoringDraftViewRow, "authoring_ir_json">,
): AuthoringDraftSourceAttribution | null {
  const origin = draft.authoring_ir_json?.origin;
  if (!origin || origin.provider === "direct") {
    return null;
  }

  const rawContext = origin.raw_context ?? null;
  return {
    provider: origin.provider,
    externalId: origin.external_id ?? null,
    externalUrl: origin.external_url ?? null,
    // Prefer the normalized Agora field first, then older provider-specific aliases.
    agentHandle: firstStringValue(rawContext, [
      "source_agent_handle",
      "agent_handle",
      "poster_agent_handle",
      "beach_poster_agent_handle",
    ]),
  };
}

export function withAuthoringDraftSourceAttribution(
  spec: ChallengeSpecOutput,
  attribution: AuthoringDraftSourceAttribution | null,
): ChallengeSpecOutput {
  if (!attribution) {
    return spec;
  }

  return {
    ...spec,
    source: {
      provider: attribution.provider,
      external_id: attribution.externalId,
      external_url: attribution.externalUrl,
      agent_handle: attribution.agentHandle,
    },
  };
}
