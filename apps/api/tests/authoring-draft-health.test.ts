import assert from "node:assert/strict";
import test from "node:test";
import { resetConfigCache } from "@agora/common";
import { createApp } from "../src/app.js";
import {
  AUTHORING_DRAFT_REVIEW_CRITICAL_MS,
  AUTHORING_DRAFT_REVIEW_WARNING_MS,
  AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS,
  buildAuthoringDraftHealthResponse,
  deriveAuthoringDraftHealthStatus,
} from "../src/routes/authoring-draft-health-shared.js";

const emptyCounts = {
  draft: 0,
  compiling: 0,
  ready: 0,
  needs_clarification: 0,
  needs_review: 0,
  published: 0,
  failed: 0,
} as const;

test("authoring draft health stays ok when queues are clear", () => {
  const status = deriveAuthoringDraftHealthStatus({
    counts: emptyCounts,
    expired: 0,
    staleCompiling: 0,
    oldestNeedsReviewAgeMs: null,
  });

  assert.equal(status, "ok");
});

test("authoring draft health warns when expired drafts await cleanup", () => {
  const payload = buildAuthoringDraftHealthResponse({
    checkedAt: "2026-03-17T00:00:00.000Z",
    counts: emptyCounts,
    expired: 3,
    staleCompiling: 0,
    oldestNeedsReviewAt: null,
    oldestNeedsReviewAgeMs: null,
  });

  assert.equal(payload.status, "warning");
  assert.equal(payload.drafts.expired, 3);
  assert.equal(
    payload.thresholds.stale_compiling_ms,
    AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS,
  );
  assert.match(payload.message, /expired drafts/i);
});

test("authoring draft health warns when review backlog crosses the warning SLA", () => {
  const payload = buildAuthoringDraftHealthResponse({
    checkedAt: "2026-03-17T00:00:00.000Z",
    counts: {
      ...emptyCounts,
      needs_review: 2,
    },
    expired: 0,
    staleCompiling: 0,
    oldestNeedsReviewAt: "2026-03-16T22:30:00.000Z",
    oldestNeedsReviewAgeMs: AUTHORING_DRAFT_REVIEW_WARNING_MS + 1,
  });

  assert.equal(payload.status, "warning");
  assert.match(payload.message, /review backlog is aging/i);
});

test("authoring draft health turns critical when review backlog breaches the critical SLA", () => {
  const payload = buildAuthoringDraftHealthResponse({
    checkedAt: "2026-03-17T00:00:00.000Z",
    counts: {
      ...emptyCounts,
      needs_review: 1,
    },
    expired: 0,
    staleCompiling: 0,
    oldestNeedsReviewAt: "2026-03-15T23:00:00.000Z",
    oldestNeedsReviewAgeMs: AUTHORING_DRAFT_REVIEW_CRITICAL_MS + 1,
  });

  assert.equal(payload.status, "critical");
  assert.match(payload.message, /critical SLA/i);
});

test("expired draft sweep is disabled when review access is not configured", async () => {
  const originalToken = process.env.AGORA_AUTHORING_REVIEW_TOKEN;
  Reflect.deleteProperty(process.env, "AGORA_AUTHORING_REVIEW_TOKEN");
  resetConfigCache();

  try {
    const app = createApp();
    const response = await app.request(
      new Request("http://localhost/api/authoring/review/sweep-expired", {
        method: "POST",
      }),
    );

    assert.equal(response.status, 503);
  } finally {
    if (originalToken === undefined) {
      Reflect.deleteProperty(process.env, "AGORA_AUTHORING_REVIEW_TOKEN");
    } else {
      process.env.AGORA_AUTHORING_REVIEW_TOKEN = originalToken;
    }
    resetConfigCache();
  }
});

test("expired draft sweep requires the configured review token", async () => {
  const originalToken = process.env.AGORA_AUTHORING_REVIEW_TOKEN;
  process.env.AGORA_AUTHORING_REVIEW_TOKEN = "review-secret";
  resetConfigCache();

  try {
    const app = createApp();
    const response = await app.request(
      new Request("http://localhost/api/authoring/review/sweep-expired", {
        method: "POST",
      }),
    );

    assert.equal(response.status, 401);
  } finally {
    if (originalToken === undefined) {
      Reflect.deleteProperty(process.env, "AGORA_AUTHORING_REVIEW_TOKEN");
    } else {
      process.env.AGORA_AUTHORING_REVIEW_TOKEN = originalToken;
    }
    resetConfigCache();
  }
});
