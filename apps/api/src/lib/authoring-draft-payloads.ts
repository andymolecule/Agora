import {
  authoringDraftAssessmentSchema,
  authoringDraftSchema,
} from "@agora/common";
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

export function toAuthoringDraftPayload(
  authoringDraft: AuthoringDraftViewRow | null,
) {
  if (!authoringDraft) {
    return null;
  }

  const clarificationQuestions =
    getAuthoringDraftClarificationQuestions(authoringDraft);
  const reviewSummary = getAuthoringDraftReviewSummary(authoringDraft);
  const approvedConfirmation =
    getAuthoringDraftApprovedConfirmation(authoringDraft);

  return authoringDraftSchema.parse({
    id: authoringDraft.id,
    poster_address: authoringDraft.poster_address ?? null,
    state: authoringDraft.state,
    intent: authoringDraft.intent_json ?? null,
    authoring_ir: authoringDraft.authoring_ir_json ?? null,
    uploaded_artifacts: authoringDraft.uploaded_artifacts_json ?? [],
    compilation: authoringDraft.compilation_json ?? null,
    clarification_questions: clarificationQuestions,
    review_summary: reviewSummary,
    approved_confirmation: approvedConfirmation,
    published_challenge_id: authoringDraft.published_challenge_id ?? null,
    published_spec_cid: authoringDraft.published_spec_cid ?? null,
    published_spec: authoringDraft.published_spec_json ?? null,
    failure_message: authoringDraft.failure_message ?? null,
    expires_at: authoringDraft.expires_at,
    created_at: authoringDraft.created_at,
    updated_at: authoringDraft.updated_at,
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

function toConfidenceBucket(score: number) {
  if (score >= 0.8) {
    return "high" as const;
  }
  if (score >= 0.55) {
    return "medium" as const;
  }
  return "low" as const;
}

export function buildAuthoringDraftAssessment(
  draft: Pick<
    AuthoringDraftViewRow,
    | "state"
    | "intent_json"
    | "authoring_ir_json"
    | "compilation_json"
    | "failure_message"
  >,
) {
  const clarificationQuestions = getAuthoringDraftClarificationQuestions(draft);
  const reviewSummary = getAuthoringDraftReviewSummary(draft);
  const confidenceScore =
    draft.compilation_json?.confidence_score ??
    draft.authoring_ir_json?.routing.confidence_score ??
    0;
  const runtimeFamily =
    draft.compilation_json?.runtime_family ??
    draft.authoring_ir_json?.evaluation.runtime_family ??
    null;
  const metric =
    draft.compilation_json?.metric ??
    draft.authoring_ir_json?.evaluation.metric ??
    null;
  const evaluatorArchetype =
    draft.compilation_json?.challenge_spec.evaluation.evaluator_contract
      ?.archetype ??
    draft.authoring_ir_json?.evaluation.semi_custom_contract?.archetype ??
    null;
  const reasonCodes = [
    ...(draft.compilation_json?.reason_codes ?? []),
    ...(reviewSummary?.reason_codes ?? []),
  ];

  const missing =
    draft.state === "needs_clarification"
      ? clarificationQuestions.map((question) => question.prompt)
      : draft.state === "needs_review"
        ? ["operator_review_required"]
        : draft.state === "failed"
          ? [draft.failure_message ?? "compile_failed"]
          : (draft.authoring_ir_json?.routing.blocking_reasons ?? []);

  const suggestions = [
    ...clarificationQuestions
      .map((question) => question.next_step)
      .filter((value): value is string => typeof value === "string"),
    ...(draft.compilation_json?.warnings ?? []),
    ...(draft.authoring_ir_json?.routing.recommended_next_action
      ? [draft.authoring_ir_json.routing.recommended_next_action]
      : []),
  ];

  return authoringDraftAssessmentSchema.parse({
    feasible: draft.state === "ready" || draft.state === "needs_review",
    publishable: draft.state === "ready",
    requires_review: draft.state === "needs_review",
    confidence: toConfidenceBucket(confidenceScore),
    confidence_score: confidenceScore,
    runtime_family: runtimeFamily,
    metric,
    evaluator_archetype: evaluatorArchetype,
    reason_codes: [...new Set(reasonCodes)],
    missing: [...new Set(missing)],
    suggestions: [...new Set(suggestions)],
    proposed_reward:
      draft.intent_json?.reward_total ??
      draft.compilation_json?.challenge_spec.reward.total ??
      null,
    proposed_deadline:
      draft.intent_json?.deadline ??
      draft.compilation_json?.challenge_spec.deadline ??
      null,
  });
}
