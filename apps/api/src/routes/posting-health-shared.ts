type PostingHealthStatus = "ok" | "warning" | "critical";

interface PostingSessionStateCounts {
  draft: number;
  compiling: number;
  ready: number;
  needs_clarification: number;
  needs_review: number;
  published: number;
  failed: number;
}

interface PostingSessionHealthResponse {
  status: PostingHealthStatus;
  checked_at: string;
  message: string;
  sessions: {
    counts: PostingSessionStateCounts;
    expired: number;
    stale_compiling: number;
    oldest_needs_review_at: string | null;
    oldest_needs_review_age_ms: number | null;
  };
  thresholds: {
    stale_compiling_ms: number;
    review_warning_ms: number;
    review_critical_ms: number;
    review_queue_warning_count: number;
  };
}

export const POSTING_STALE_COMPILING_THRESHOLD_MS = 5 * 60 * 1000;
export const POSTING_REVIEW_WARNING_MS = 60 * 60 * 1000;
export const POSTING_REVIEW_CRITICAL_MS = 24 * 60 * 60 * 1000;
export const POSTING_REVIEW_QUEUE_WARNING_COUNT = 10;

interface PostingHealthInput {
  checkedAt: string;
  counts: PostingSessionStateCounts;
  expired: number;
  staleCompiling: number;
  oldestNeedsReviewAt: string | null;
  oldestNeedsReviewAgeMs: number | null;
}

export function derivePostingHealthStatus(
  input: Pick<
    PostingHealthInput,
    "counts" | "expired" | "staleCompiling" | "oldestNeedsReviewAgeMs"
  >,
): PostingHealthStatus {
  if (
    (input.oldestNeedsReviewAgeMs ?? 0) >= POSTING_REVIEW_CRITICAL_MS
  ) {
    return "critical";
  }

  if (
    input.expired > 0 ||
    input.staleCompiling > 0 ||
    input.counts.needs_review >= POSTING_REVIEW_QUEUE_WARNING_COUNT ||
    (input.oldestNeedsReviewAgeMs ?? 0) >= POSTING_REVIEW_WARNING_MS
  ) {
    return "warning";
  }

  return "ok";
}

function buildPostingHealthMessage(
  status: PostingHealthStatus,
  input: Pick<
    PostingHealthInput,
    "counts" | "expired" | "staleCompiling" | "oldestNeedsReviewAgeMs"
  >,
) {
  if (status === "critical") {
    return "Posting review backlog breached the critical SLA. Next step: review queued drafts immediately and sweep expired sessions.";
  }

  if (status === "warning") {
    if (input.staleCompiling > 0) {
      return "Managed authoring has stale compile sessions. Next step: inspect failed requests, then sweep or retry the affected drafts.";
    }
    if (input.expired > 0) {
      return "Managed authoring has expired sessions waiting for cleanup. Next step: run the expired-session sweep.";
    }
    if ((input.oldestNeedsReviewAgeMs ?? 0) >= POSTING_REVIEW_WARNING_MS) {
      return "Posting review backlog is aging past the warning threshold. Next step: review the queued drafts before the SLA slips further.";
    }
    return "Posting review backlog is growing. Next step: review queued drafts or send them to Expert Mode.";
  }

  return "Managed authoring sessions are within the current operational thresholds.";
}

export function buildPostingHealthResponse(
  input: PostingHealthInput,
): PostingSessionHealthResponse {
  const status = derivePostingHealthStatus(input);
  return {
    status,
    checked_at: input.checkedAt,
    message: buildPostingHealthMessage(status, input),
    sessions: {
      counts: input.counts,
      expired: input.expired,
      stale_compiling: input.staleCompiling,
      oldest_needs_review_at: input.oldestNeedsReviewAt,
      oldest_needs_review_age_ms: input.oldestNeedsReviewAgeMs,
    },
    thresholds: {
      stale_compiling_ms: POSTING_STALE_COMPILING_THRESHOLD_MS,
      review_warning_ms: POSTING_REVIEW_WARNING_MS,
      review_critical_ms: POSTING_REVIEW_CRITICAL_MS,
      review_queue_warning_count: POSTING_REVIEW_QUEUE_WARNING_COUNT,
    },
  };
}
