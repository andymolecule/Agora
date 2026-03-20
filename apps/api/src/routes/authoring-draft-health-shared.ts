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
  };
  thresholds: {
    stale_compiling_ms: number;
  };
}

export const AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS = 5 * 60 * 1000;

interface AuthoringDraftHealthInput {
  checkedAt: string;
  counts: AuthoringDraftStateCountsOutput;
  expired: number;
  staleCompiling: number;
}

export function deriveAuthoringDraftHealthStatus(
  input: Pick<
    AuthoringDraftHealthInput,
    "counts" | "expired" | "staleCompiling"
  >,
): AuthoringDraftHealthStatus {
  if (input.expired > 0 || input.staleCompiling > 0) {
    return "warning";
  }

  return "ok";
}

function buildAuthoringDraftHealthMessage(
  status: AuthoringDraftHealthStatus,
  input: Pick<
    AuthoringDraftHealthInput,
    "counts" | "expired" | "staleCompiling"
  >,
) {
  if (status === "warning") {
    if (input.staleCompiling > 0) {
      return "Managed authoring has stale compile drafts. Next step: inspect failed requests, then sweep or retry the affected drafts.";
    }
    if (input.expired > 0) {
      return "Managed authoring has expired drafts waiting for cleanup. Next step: run the expired-draft sweep.";
    }
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
    },
    thresholds: {
      stale_compiling_ms: AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS,
    },
  };
}
