import {
  type AuthoringArtifactOutput,
  type ChallengeAuthoringIrOutput,
  type ChallengeIntentInput,
  type ClarificationQuestionOutput,
  type ExternalSourceMessageOutput,
  challengeAuthoringIrSchema,
} from "@agora/common";

type PartialIntent = Partial<ChallengeIntentInput> | null | undefined;

function trimmed(value?: string | null) {
  if (typeof value !== "string") {
    return null;
  }
  const result = value.trim();
  return result.length > 0 ? result : null;
}

function artifactId(artifact: AuthoringArtifactOutput, index: number) {
  return artifact.id?.trim() || `artifact-${index + 1}`;
}

function buildQuestion(input: {
  id: string;
  prompt: string;
  reasonCode: string;
  nextStep: string;
}) {
  return {
    id: input.id,
    prompt: input.prompt,
    reason_code: input.reasonCode,
    next_step: input.nextStep,
    blocks_publish: true,
  };
}

function buildQuestionsForMissingIntentFields(
  missingFields: string[],
): ClarificationQuestionOutput[] {
  return missingFields.map((field) => {
    switch (field) {
      case "title":
        return buildQuestion({
          id: "challenge-title",
          prompt: "What is the challenge title?",
          reasonCode: "AUTHORING_INTENT_TITLE_REQUIRED",
          nextStep: "Add a short, specific challenge title and resubmit.",
        });
      case "description":
        return buildQuestion({
          id: "challenge-description",
          prompt: "What exactly should solvers accomplish?",
          reasonCode: "AUTHORING_INTENT_DESCRIPTION_REQUIRED",
          nextStep:
            "Describe the solver task, target outcome, and relevant context, then resubmit.",
        });
      case "payout_condition":
        return buildQuestion({
          id: "winning-definition",
          prompt: "How is the winner determined?",
          reasonCode: "AUTHORING_INTENT_PAYOUT_CONDITION_REQUIRED",
          nextStep:
            "Specify the metric or winning condition in plain language and resubmit.",
        });
      case "reward_total":
        return buildQuestion({
          id: "reward-total",
          prompt: "How much USDC should this bounty pay in total?",
          reasonCode: "AUTHORING_INTENT_REWARD_TOTAL_REQUIRED",
          nextStep: "Provide the total USDC reward and resubmit.",
        });
      case "deadline":
        return buildQuestion({
          id: "submission-deadline",
          prompt: "When should submissions close?",
          reasonCode: "AUTHORING_INTENT_DEADLINE_REQUIRED",
          nextStep:
            "Provide an RFC3339 deadline with timezone offset and resubmit.",
        });
      default:
        return buildQuestion({
          id: field,
          prompt: `Provide ${field.replace(/_/g, " ")}.`,
          reasonCode: "AUTHORING_INTENT_FIELD_REQUIRED",
          nextStep: `Fill in ${field.replace(/_/g, " ")} and resubmit.`,
        });
    }
  });
}

function buildQuestionsForCompileError(input: {
  code?: string | null;
  message?: string | null;
}): ClarificationQuestionOutput[] {
  switch (input.code) {
    case "MANAGED_ARTIFACTS_MISSING":
      return [
        buildQuestion({
          id: "missing-artifacts",
          prompt: "Which files should Agora use to evaluate submissions?",
          reasonCode: "MANAGED_ARTIFACTS_MISSING",
          nextStep: "Attach the required files and resubmit.",
        }),
      ];
    case "MANAGED_ARTIFACTS_INCOMPLETE":
      return [
        buildQuestion({
          id: "incomplete-artifacts",
          prompt: "Which required evaluation files are still missing?",
          reasonCode: "MANAGED_ARTIFACTS_INCOMPLETE",
          nextStep:
            "Upload the missing evaluation files or rename the current files so their roles are clear, then resubmit.",
        }),
      ];
    case "MANAGED_ARTIFACTS_AMBIGUOUS":
    case "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID":
      return [
        buildQuestion({
          id: "artifact-roles",
          prompt:
            "Which uploaded file is the training set, evaluation set, reference output, or hidden labels?",
          reasonCode: input.code,
          nextStep:
            "Rename the uploaded files to make their roles obvious, or provide clearer file metadata and resubmit.",
        }),
      ];
    case "MANAGED_THRESHOLD_UNSUPPORTED":
      return [
        buildQuestion({
          id: "winning-definition",
          prompt:
            "Can you restate the winning condition without a lower-is-better payout threshold?",
          reasonCode: input.code,
          nextStep:
            "Remove the explicit lower-is-better threshold or switch to a rank-based winning condition and resubmit.",
        }),
      ];
    case "MANAGED_COMPILER_NEEDS_INPUT":
      return [
        buildQuestion({
          id: "scorer-fit",
          prompt:
            input.message ??
            "Agora needs one more detail to choose the right Gems scorer.",
          reasonCode: input.code,
          nextStep: "Answer the question and resubmit.",
        }),
      ];
    default:
      return [];
  }
}

function extractMissingIntentFields(intent: PartialIntent) {
  const missing: string[] = [];
  if (!trimmed(intent?.title)) {
    missing.push("title");
  }
  if (!trimmed(intent?.description)) {
    missing.push("description");
  }
  if (!trimmed(intent?.payout_condition)) {
    missing.push("payout_condition");
  }
  if (!trimmed(intent?.reward_total)) {
    missing.push("reward_total");
  }
  if (!trimmed(intent?.deadline)) {
    missing.push("deadline");
  }
  return missing;
}

export function buildManagedAuthoringIr(input: {
  intent?: PartialIntent;
  uploadedArtifacts: AuthoringArtifactOutput[];
  sourceTitle?: string | null;
  sourceMessages?: ExternalSourceMessageOutput[];
  origin?: {
    provider: ChallengeAuthoringIrOutput["origin"]["provider"];
    external_id?: string | null;
    external_url?: string | null;
    ingested_at?: string;
    raw_context?: Record<string, unknown> | null;
  };
  runtimeFamily?: string | null;
  metric?: string | null;
  artifactAssignments?: Array<{
    artifactIndex: number;
    role: string;
    visibility: "public" | "private";
  }>;
  clarificationQuestions?: ClarificationQuestionOutput[];
  compileError?: {
    code?: string | null;
    message?: string | null;
  } | null;
  rejectionReasons?: string[];
  resolvedAssumptions?: string[];
}) {
  const missingFields = extractMissingIntentFields(input.intent);
  const compileQuestions =
    input.clarificationQuestions?.map((question) =>
      buildQuestion({
        id: question.id,
        prompt: question.prompt,
        reasonCode: question.reason_code,
        nextStep: question.next_step,
      }),
    ) ??
    buildQuestionsForCompileError({
      code: input.compileError?.code ?? null,
      message: input.compileError?.message ?? null,
    });
  const questions =
    compileQuestions.length > 0
      ? compileQuestions
      : buildQuestionsForMissingIntentFields(missingFields);

  return challengeAuthoringIrSchema.parse({
    version: 2,
    origin: {
      provider: input.origin?.provider ?? "direct",
      external_id: input.origin?.external_id ?? null,
      external_url: input.origin?.external_url ?? null,
      ingested_at: input.origin?.ingested_at ?? new Date().toISOString(),
      raw_context: input.origin?.raw_context ?? null,
    },
    source: {
      title: trimmed(input.sourceTitle) ?? trimmed(input.intent?.title) ?? null,
      poster_messages: (input.sourceMessages ?? []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        created_at: message.created_at ?? new Date().toISOString(),
      })),
      uploaded_artifact_ids: input.uploadedArtifacts.map(artifactId),
    },
    intent: {
      current: input.intent ?? {},
      missing_fields: missingFields,
    },
    evaluation: {
      runtime_family: input.runtimeFamily ?? null,
      metric: input.metric ?? null,
      artifact_assignments: (input.artifactAssignments ?? []).map(
        (assignment) => {
          const assignedArtifact =
            input.uploadedArtifacts[assignment.artifactIndex];
          return {
            artifact_id: assignedArtifact
              ? artifactId(assignedArtifact, assignment.artifactIndex)
              : `artifact-${assignment.artifactIndex + 1}`,
            artifact_index: assignment.artifactIndex,
            role: assignment.role,
            visibility: assignment.visibility,
          };
        },
      ),
      rejection_reasons: input.rejectionReasons ?? [],
      compile_error_codes:
        input.compileError?.code != null ? [input.compileError.code] : [],
      compile_error_message: input.compileError?.message ?? null,
    },
    clarification: {
      open_questions: questions,
      resolved_assumptions: input.resolvedAssumptions ?? [],
    },
  });
}

export function buildClarificationQuestionsFromAuthoringIr(
  authoringIr: ChallengeAuthoringIrOutput,
) {
  return authoringIr.clarification.open_questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    reason_code: question.reason_code,
    next_step: question.next_step,
  }));
}
