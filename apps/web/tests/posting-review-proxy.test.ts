import assert from "node:assert/strict";
import test from "node:test";
import { buildPostingReviewUpstreamUrl } from "../src/lib/posting-review-proxy";

test("buildPostingReviewUpstreamUrl preserves backend path prefixes", () => {
  const url = buildPostingReviewUpstreamUrl({
    baseUrl: "https://api.agora.example/backend",
    requestUrl:
      "https://web.agora.example/api/posting-review/sessions?state=needs_review",
  });

  assert.equal(
    url.toString(),
    "https://api.agora.example/backend/api/posting/review/sessions?state=needs_review",
  );
});

test("buildPostingReviewUpstreamUrl targets decision routes explicitly", () => {
  const url = buildPostingReviewUpstreamUrl({
    baseUrl: "https://api.agora.example/backend/",
    requestUrl:
      "https://web.agora.example/api/posting-review/sessions/session-123/decision",
    sessionId: "session-123",
  });

  assert.equal(
    url.toString(),
    "https://api.agora.example/backend/api/posting/review/sessions/session-123/decision",
  );
});
