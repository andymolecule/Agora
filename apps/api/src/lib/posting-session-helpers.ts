import { postingSessionSchema } from "@agora/common";
import type { PostingSessionRow } from "@agora/db";
import { buildClarificationQuestionsFromAuthoringIr } from "./managed-authoring-ir.js";
import { derivePostingSessionReviewSummary } from "./posting-review-summary.js";

export const EXTERNAL_DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function buildExpiry(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function isPostingSessionExpired(
  session: Pick<PostingSessionRow, "expires_at">,
  nowMs = Date.now(),
) {
  const expiresAtMs = new Date(session.expires_at).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }
  return expiresAtMs <= nowMs;
}

export function toPostingSessionPayload(row: PostingSessionRow | null) {
  if (!row) {
    return null;
  }

  const clarificationQuestions = getPostingSessionClarificationQuestions(row);
  const reviewSummary = getPostingSessionReviewSummary(row);
  const approvedConfirmation = getPostingSessionApprovedConfirmation(row);

  return postingSessionSchema.parse({
    id: row.id,
    poster_address: row.poster_address ?? null,
    state: row.state,
    intent: row.intent_json ?? null,
    authoring_ir: row.authoring_ir_json ?? null,
    uploaded_artifacts: row.uploaded_artifacts_json ?? [],
    compilation: row.compilation_json ?? null,
    clarification_questions: clarificationQuestions,
    review_summary: reviewSummary,
    approved_confirmation: approvedConfirmation,
    published_spec_cid: row.published_spec_cid ?? null,
    published_spec: row.published_spec_json ?? null,
    failure_message: row.failure_message ?? null,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export function getPostingSessionClarificationQuestions(
  row: Pick<PostingSessionRow, "authoring_ir_json">,
) {
  if (row.authoring_ir_json) {
    return buildClarificationQuestionsFromAuthoringIr(row.authoring_ir_json);
  }
  return [];
}

export function getPostingSessionReviewSummary(
  row: Pick<
    PostingSessionRow,
    "state" | "authoring_ir_json" | "compilation_json"
  >,
) {
  return derivePostingSessionReviewSummary(row);
}

export function getPostingSessionApprovedConfirmation(
  row: Pick<PostingSessionRow, "compilation_json">,
) {
  return row.compilation_json?.confirmation_contract ?? null;
}
