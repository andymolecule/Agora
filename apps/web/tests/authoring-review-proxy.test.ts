import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthoringReviewUpstreamUrl } from "../src/lib/authoring-review-proxy";

test("buildAuthoringReviewUpstreamUrl preserves backend path prefixes", () => {
  const url = buildAuthoringReviewUpstreamUrl({
    baseUrl: "https://api.agora.example/backend",
    requestUrl:
      "https://web.agora.example/api/authoring-review/drafts?state=needs_review",
  });

  assert.equal(
    url.toString(),
    "https://api.agora.example/backend/api/authoring/review/drafts?state=needs_review",
  );
});

test("buildAuthoringReviewUpstreamUrl targets decision routes explicitly", () => {
  const url = buildAuthoringReviewUpstreamUrl({
    baseUrl: "https://api.agora.example/backend/",
    requestUrl:
      "https://web.agora.example/api/authoring-review/drafts/session-123/decision",
    draftId: "session-123",
  });

  assert.equal(
    url.toString(),
    "https://api.agora.example/backend/api/authoring/review/drafts/session-123/decision",
  );
});
