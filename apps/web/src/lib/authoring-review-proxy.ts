import { readAuthoringReviewRuntimeConfig } from "@agora/common";
import { resolveApiProxyBase } from "./api-proxy";

export const AUTHORING_REVIEW_HEADER_NAME = "x-agora-review-token";
export const AUTHORING_REVIEW_DRAFTS_PATH = "api/authoring/review/drafts";

function normalizeProxyBase(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/`;
}

export function buildAuthoringReviewUpstreamUrl(input: {
  baseUrl: string;
  requestUrl: string;
  draftId?: string;
}) {
  const url = new URL(input.requestUrl);
  const relativePath = input.draftId
    ? `${AUTHORING_REVIEW_DRAFTS_PATH}/${input.draftId}/decision`
    : AUTHORING_REVIEW_DRAFTS_PATH;
  return new URL(
    `${relativePath}${url.search}`,
    normalizeProxyBase(input.baseUrl),
  );
}

export function resolveAuthoringReviewProxy(requestUrl: string) {
  const runtime = readAuthoringReviewRuntimeConfig();
  const resolved = resolveApiProxyBase({
    requestUrl,
    serverApiUrl: runtime.apiUrl,
    publicApiUrl: process.env.NEXT_PUBLIC_AGORA_API_URL,
  });
  if (!resolved.ok) {
    return resolved;
  }

  return {
    ok: true as const,
    baseUrl: resolved.baseUrl,
  };
}
