import type {
  AuthoringReviewSummaryOutput,
  ChallengeAuthoringIrOutput,
  CompilationResultOutput,
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
}): AuthoringReviewSummaryOutput {
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

export function buildDefinitionBackedReviewSummary(input: {
  authoringIr: ChallengeAuthoringIrOutput;
  executable: boolean;
  triggerMessage?: string | null;
}): AuthoringReviewSummaryOutput {
  const definitionId =
    input.authoringIr.evaluation.definition_id ?? "definition_backed";
  const evaluatorArchetype =
    input.authoringIr.evaluation.evaluator_definition?.archetype ??
    definitionId;
  const ambiguitySummary =
    input.authoringIr.ambiguity.classes.length > 0
      ? ` Ambiguities still tracked: ${input.authoringIr.ambiguity.classes.join(", ")}.`
      : "";
  const triggerSummary =
    input.triggerMessage && input.triggerMessage.trim().length > 0
      ? ` ${input.triggerMessage.trim()}`
      : "";

  return {
    summary: `Agora could not map this draft cleanly to a current managed preset, but the challenge appears deterministic enough for a definition-backed evaluator path.${triggerSummary} Current evaluator definition candidate: ${evaluatorArchetype}.${ambiguitySummary}${input.executable ? " This definition already maps to a supported execution backend and can proceed through review." : " Next step: configure a supported execution backend or continue in Expert Mode."}`,
    reason_codes: ["definition_backed_candidate"],
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
): AuthoringReviewSummaryOutput | null {
  if (row.state !== "needs_review") {
    return null;
  }

  if (!row.compilation_json) {
    return null;
  }

  const authoringIr = row.authoring_ir_json;
  const isDefinitionBacked =
    row.compilation_json.authoring_path === "definition_backed" ||
    authoringIr?.routing.mode === "definition_backed";
  if (isDefinitionBacked && authoringIr) {
    return buildDefinitionBackedReviewSummary({
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
