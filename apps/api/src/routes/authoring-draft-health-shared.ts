import type { AuthoringDraftStateCountsOutput } from "@agora/common";

type AuthoringDraftHealthStatus = "ok" | "warning" | "critical";

interface AuthoringDraftHealthResponse {
  status: AuthoringDraftHealthStatus;
  checked_at: string;
  message: string;
  drafts: {
    counts: AuthoringDraftStateCountsOutput;
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

export const AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS = 5 * 60 * 1000;
export const AUTHORING_DRAFT_REVIEW_WARNING_MS = 60 * 60 * 1000;
export const AUTHORING_DRAFT_REVIEW_CRITICAL_MS = 24 * 60 * 60 * 1000;
export const AUTHORING_DRAFT_REVIEW_QUEUE_WARNING_COUNT = 10;

interface AuthoringDraftHealthInput {
  checkedAt: string;
  counts: AuthoringDraftStateCountsOutput;
  expired: number;
  staleCompiling: number;
  oldestNeedsReviewAt: string | null;
  oldestNeedsReviewAgeMs: number | null;
}

export function deriveAuthoringDraftHealthStatus(
  input: Pick<
    AuthoringDraftHealthInput,
    "counts" | "expired" | "staleCompiling" | "oldestNeedsReviewAgeMs"
  >,
): AuthoringDraftHealthStatus {
  if (
    (input.oldestNeedsReviewAgeMs ?? 0) >= AUTHORING_DRAFT_REVIEW_CRITICAL_MS
  ) {
    return "critical";
  }

  if (
    input.expired > 0 ||
    input.staleCompiling > 0 ||
    input.counts.needs_review >= AUTHORING_DRAFT_REVIEW_QUEUE_WARNING_COUNT ||
    (input.oldestNeedsReviewAgeMs ?? 0) >= AUTHORING_DRAFT_REVIEW_WARNING_MS
  ) {
    return "warning";
  }

  return "ok";
}

function buildAuthoringDraftHealthMessage(
  status: AuthoringDraftHealthStatus,
  input: Pick<
    AuthoringDraftHealthInput,
    "counts" | "expired" | "staleCompiling" | "oldestNeedsReviewAgeMs"
  >,
) {
  if (status === "critical") {
    return "Authoring review backlog breached the critical SLA. Next step: review queued drafts immediately and sweep expired drafts.";
  }

  if (status === "warning") {
    if (input.staleCompiling > 0) {
      return "Managed authoring has stale compile drafts. Next step: inspect failed requests, then sweep or retry the affected drafts.";
    }
    if (input.expired > 0) {
      return "Managed authoring has expired drafts waiting for cleanup. Next step: run the expired-draft sweep.";
    }
    if (
      (input.oldestNeedsReviewAgeMs ?? 0) >= AUTHORING_DRAFT_REVIEW_WARNING_MS
    ) {
      return "Authoring review backlog is aging past the warning threshold. Next step: review the queued drafts before the SLA slips further.";
    }
    return "Authoring review backlog is growing. Next step: review queued drafts or send them to Expert Mode.";
  }

  return "Managed authoring drafts are within the current operational thresholds.";
}

export function buildAuthoringDraftHealthResponse(
  input: AuthoringDraftHealthInput,
): AuthoringDraftHealthResponse {
  const status = deriveAuthoringDraftHealthStatus(input);
  return {
    status,
    checked_at: input.checkedAt,
    message: buildAuthoringDraftHealthMessage(status, input),
    drafts: {
      counts: input.counts,
      expired: input.expired,
      stale_compiling: input.staleCompiling,
      oldest_needs_review_at: input.oldestNeedsReviewAt,
      oldest_needs_review_age_ms: input.oldestNeedsReviewAgeMs,
    },
    thresholds: {
      stale_compiling_ms: AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS,
      review_warning_ms: AUTHORING_DRAFT_REVIEW_WARNING_MS,
      review_critical_ms: AUTHORING_DRAFT_REVIEW_CRITICAL_MS,
      review_queue_warning_count: AUTHORING_DRAFT_REVIEW_QUEUE_WARNING_COUNT,
    },
  };
}
