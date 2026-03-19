import type {
  ChallengeAuthoringIrOutput,
  CompilationResultOutput,
  PostingReviewSummaryOutput,
} from "@agora/common";
import { validateChallengeScoreability } from "@agora/common";
import type { AuthoringDraftViewRow } from "@agora/db";

function formatReasonCode(reasonCode: string) {
  return reasonCode.replace(/_/g, " ");
}

export function buildManagedReviewSummary(input: {
  confidenceScore: number;
  reasonCodes: string[];
  warnings: string[];
}): PostingReviewSummaryOutput {
  const reasonSummary =
    input.reasonCodes.length > 0
      ? input.reasonCodes.map(formatReasonCode).join(", ")
      : "the model could not justify a high-confidence mapping";
  const warningSummary =
    input.warnings.length > 0 ? ` Warnings: ${input.warnings.join(" ")}` : "";

  return {
    summary: `Agora compiled a full managed contract, but confidence is ${Math.round(input.confidenceScore * 100)}% because ${reasonSummary}. Review the artifact mapping, metric, and confirmation contract before letting this draft publish.${warningSummary}`,
    reason_codes: input.reasonCodes,
    confidence_score: input.confidenceScore,
    recommended_action:
      input.confidenceScore >= 0.6
        ? "approve_after_review"
        : "send_to_expert_mode",
  };
}

export function buildSemiCustomReviewSummary(input: {
  authoringIr: ChallengeAuthoringIrOutput;
  executable: boolean;
  triggerMessage?: string | null;
}): PostingReviewSummaryOutput {
  const evaluatorId =
    input.authoringIr.evaluation.selected_evaluator ?? "semi_custom";
  const evaluatorArchetype =
    input.authoringIr.evaluation.semi_custom_contract?.archetype ?? evaluatorId;
  const ambiguitySummary =
    input.authoringIr.ambiguity.classes.length > 0
      ? ` Ambiguities still tracked: ${input.authoringIr.ambiguity.classes.join(", ")}.`
      : "";
  const triggerSummary =
    input.triggerMessage && input.triggerMessage.trim().length > 0
      ? ` ${input.triggerMessage.trim()}`
      : "";

  return {
    summary: `Agora could not map this draft cleanly to a current managed runtime family, but the challenge appears deterministic enough for a semi-custom evaluator path.${triggerSummary} Current evaluator archetype candidate: ${evaluatorArchetype}.${ambiguitySummary}${input.executable ? " This contract already maps to a supported semi-custom execution template and can proceed through review." : " Next step: configure a supported semi-custom evaluator or continue in Expert Mode."}`,
    reason_codes: ["semi_custom_candidate"],
    confidence_score: input.authoringIr.routing.confidence_score,
    recommended_action: input.executable
      ? "approve_after_review"
      : "send_to_expert_mode",
  };
}

export function deriveAuthoringDraftReviewSummary(
  row: Pick<
    AuthoringDraftViewRow,
    "state" | "authoring_ir_json" | "compilation_json"
  >,
): PostingReviewSummaryOutput | null {
  if (row.state !== "needs_review") {
    return null;
  }

  if (!row.compilation_json) {
    return null;
  }

  const authoringIr = row.authoring_ir_json;
  const isSemiCustom =
    row.compilation_json.runtime_family === "semi_custom" ||
    authoringIr?.routing.mode === "semi_custom";
  if (isSemiCustom && authoringIr) {
    return buildSemiCustomReviewSummary({
      authoringIr,
      executable: validateChallengeScoreability(
        row.compilation_json.challenge_spec,
      ).ok,
    });
  }

  return buildManagedReviewSummary({
    confidenceScore: row.compilation_json.confidence_score,
    reasonCodes: row.compilation_json.reason_codes,
    warnings: row.compilation_json.warnings,
  });
}

export function buildManagedReviewSummaryFromCompilation(
  compilation: Pick<
    CompilationResultOutput,
    "confidence_score" | "reason_codes" | "warnings"
  >,
) {
  return buildManagedReviewSummary({
    confidenceScore: compilation.confidence_score,
    reasonCodes: compilation.reason_codes,
    warnings: compilation.warnings,
  });
}
