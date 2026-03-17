import { readPostingReviewRuntimeConfig } from "@agora/common";
import { resolveApiProxyBase } from "./api-proxy";

export const POSTING_REVIEW_HEADER_NAME = "x-agora-review-token";
export const POSTING_REVIEW_SESSIONS_PATH = "api/posting/review/sessions";

function normalizeProxyBase(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/`;
}

export function buildPostingReviewUpstreamUrl(input: {
  baseUrl: string;
  requestUrl: string;
  sessionId?: string;
}) {
  const url = new URL(input.requestUrl);
  const relativePath = input.sessionId
    ? `${POSTING_REVIEW_SESSIONS_PATH}/${input.sessionId}/decision`
    : POSTING_REVIEW_SESSIONS_PATH;
  return new URL(
    `${relativePath}${url.search}`,
    normalizeProxyBase(input.baseUrl),
  );
}

export function resolvePostingReviewProxy(requestUrl: string) {
  const runtime = readPostingReviewRuntimeConfig();
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
