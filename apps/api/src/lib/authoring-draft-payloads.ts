import { postingSessionSchema } from "@agora/common";
import type { AuthoringDraftViewRow } from "@agora/db";
import { deriveAuthoringDraftReviewSummary } from "./authoring-draft-review-summary.js";
import { buildClarificationQuestionsFromAuthoringIr } from "./managed-authoring-ir.js";

export const EXTERNAL_DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function buildExpiry(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function isAuthoringDraftExpired(
  draft: Pick<AuthoringDraftViewRow, "expires_at">,
  nowMs = Date.now(),
) {
  const expiresAtMs = new Date(draft.expires_at).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }
  return expiresAtMs <= nowMs;
}

export function toAuthoringDraftPayload(draft: AuthoringDraftViewRow | null) {
  if (!draft) {
    return null;
  }

  const clarificationQuestions = getAuthoringDraftClarificationQuestions(draft);
  const reviewSummary = getAuthoringDraftReviewSummary(draft);
  const approvedConfirmation = getAuthoringDraftApprovedConfirmation(draft);

  return postingSessionSchema.parse({
    id: draft.id,
    poster_address: draft.poster_address ?? null,
    state: draft.state,
    intent: draft.intent_json ?? null,
    authoring_ir: draft.authoring_ir_json ?? null,
    uploaded_artifacts: draft.uploaded_artifacts_json ?? [],
    compilation: draft.compilation_json ?? null,
    clarification_questions: clarificationQuestions,
    review_summary: reviewSummary,
    approved_confirmation: approvedConfirmation,
    published_spec_cid: draft.published_spec_cid ?? null,
    published_spec: draft.published_spec_json ?? null,
    failure_message: draft.failure_message ?? null,
    expires_at: draft.expires_at,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
  });
}

export function getAuthoringDraftClarificationQuestions(
  draft: Pick<AuthoringDraftViewRow, "authoring_ir_json">,
) {
  if (draft.authoring_ir_json) {
    return buildClarificationQuestionsFromAuthoringIr(draft.authoring_ir_json);
  }
  return [];
}

export function getAuthoringDraftReviewSummary(
  draft: Pick<
    AuthoringDraftViewRow,
    "state" | "authoring_ir_json" | "compilation_json"
  >,
) {
  return deriveAuthoringDraftReviewSummary(draft);
}

export function getAuthoringDraftApprovedConfirmation(
  draft: Pick<AuthoringDraftViewRow, "compilation_json">,
) {
  return draft.compilation_json?.confirmation_contract ?? null;
}
