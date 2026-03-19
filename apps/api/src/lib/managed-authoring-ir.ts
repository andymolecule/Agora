import {
  type AgoraError,
  type AuthoringAmbiguityClassOutput,
  type AuthoringArtifactOutput,
  type ChallengeAuthoringIrOutput,
  type ChallengeIntentOutput,
  type ClarificationQuestionOutput,
  type EvaluatorArchetypeId,
  type ExternalSourceMessageOutput,
  type RuntimeMetricDefinition,
  type SemiCustomSubmissionKindOutput,
  createCsvTableEvaluationContract,
  createRuntimePolicies,
  createSemiCustomEvaluatorContract,
  createSemiCustomExactArtifactMatchExecution,
  createSemiCustomStructuredRecordExecution,
  createSemiCustomStructuredTableExecution,
  getEvaluatorArchetype,
  getManagedRuntimeMetric,
  lookupManagedRuntimeFamily,
} from "@agora/common";
import type { SupportedRuntimeFamily } from "./managed-authoring-compiler.js";

type RoutingMode = ChallengeAuthoringIrOutput["routing"]["mode"];
type AmbiguityClass = AuthoringAmbiguityClassOutput;

const RUNTIME_METRIC_HINT_PATTERNS: Partial<
  Record<SupportedRuntimeFamily, RegExp>
> = {
  tabular_regression: /\b(r2|rmse|mae|pearson|spearman)\b/i,
  tabular_classification: /\b(accuracy|f1|precision|recall)\b/i,
  ranking: /\b(ndcg|spearman)\b/i,
  docking: /\b(ndcg|spearman)\b/i,
  reproducibility: /\b(exact match|tolerant match|match)\b/i,
};

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

function artifactName(artifact: AuthoringArtifactOutput, index: number) {
  return (
    artifact.file_name?.trim() || artifact.id?.trim() || `artifact-${index + 1}`
  );
}

function parseComparator(input: {
  payoutCondition: string | null;
  metricDefinition?: RuntimeMetricDefinition;
}): ChallengeAuthoringIrOutput["objective"]["comparator"] {
  if (input.metricDefinition) {
    return input.metricDefinition.direction === "lower"
      ? "minimize"
      : "maximize";
  }

  const payoutCondition = input.payoutCondition?.toLowerCase() ?? "";
  if (/(highest|maximize|best|top|largest|greater)/i.test(payoutCondition)) {
    return "maximize";
  }
  if (/(lowest|minimize|smallest|least|under|below)/i.test(payoutCondition)) {
    return "minimize";
  }
  if (/(match|closest)/i.test(payoutCondition)) {
    return "closest_match";
  }
  if (/(pass|fail|eligible|threshold)/i.test(payoutCondition)) {
    return "pass_fail";
  }
  return null;
}

function parseMinimumThreshold(payoutCondition: string | null) {
  if (!payoutCondition) {
    return null;
  }
  const match =
    /([<>]=?|at least|at most|above|below|under|over)\s*([0-9]+(?:\.[0-9]+)?)/i.exec(
      payoutCondition,
    );
  return match?.[2] ?? null;
}

function roundConfidence(value: number) {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

interface InferredSubmissionShape {
  solverDeliverable: string;
  artifactKind: SemiCustomSubmissionKindOutput;
  schemaRequirements: Record<string, unknown> | null;
  validationRules: string[];
}

function inferOpaqueFileSchemaRequirements(input: {
  brief: string;
  payoutCondition: string | null;
  artifacts: AuthoringArtifactOutput[];
}) {
  const sourceText =
    `${input.brief}\n${input.payoutCondition ?? ""}`.toLowerCase();
  if (/\bpdf\b/.test(sourceText)) {
    return {
      expected_kind: "opaque_file",
      expected_extension: ".pdf",
      expected_mime: "application/pdf",
    };
  }

  const extensions = [
    ...new Set(
      input.artifacts
        .map((artifact) => artifact.file_name?.match(/(\.[^.]+)$/)?.[1]?.toLowerCase())
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
  const mimeTypes = [
    ...new Set(
      input.artifacts
        .map((artifact) => artifact.mime_type?.trim().toLowerCase())
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            value.length > 0 &&
            value !== "application/octet-stream",
        ),
    ),
  ];

  return {
    expected_kind: "opaque_file",
    ...(extensions.length === 1 ? { expected_extension: extensions[0] } : {}),
    ...(mimeTypes.length === 1 ? { expected_mime: mimeTypes[0] } : {}),
  };
}

function inferGenericSubmissionShape(input: {
  brief: string;
  payoutCondition: string | null;
  artifacts: AuthoringArtifactOutput[];
  runtimeFamily?: SupportedRuntimeFamily | null;
}): InferredSubmissionShape | null {
  const runtimeFamilyConfig = input.runtimeFamily
    ? lookupManagedRuntimeFamily(input.runtimeFamily)
    : undefined;
  if (runtimeFamilyConfig?.submissionKind === "csv_table") {
    return {
      solverDeliverable: "Structured CSV submission",
      artifactKind: "csv_table",
      schemaRequirements: { expected_kind: "csv_table" },
      validationRules: [
        "Submission must be a valid CSV matching the challenge contract.",
      ],
    };
  }

  const sourceText =
    `${input.brief}\n${input.payoutCondition ?? ""}`.toLowerCase();
  const artifactColumns = input.artifacts.flatMap(
    (artifact) => artifact.detected_columns ?? [],
  );
  if (/\bjson\b|\brecords?\b|\bobject\b|\bschema\b/i.test(sourceText)) {
    return {
      solverDeliverable: "Structured record submission",
      artifactKind: "json_file",
      schemaRequirements: {
        expected_kind: "json_file",
      },
      validationRules: [
        "Submission must be a machine-parseable structured record file.",
        "Required keys and validation rules must be locked before publish.",
      ],
    };
  }

  if (
    /\b(zip|archive|bundle|notebook|script|code|program|repository|repo)\b/i.test(
      sourceText,
    )
  ) {
    return {
      solverDeliverable: "Bundle or code artifact",
      artifactKind: "bundle_or_code",
      schemaRequirements: {
        expected_kind: "bundle_or_code",
      },
      validationRules: [
        "Submission must match the bundle or code packaging contract.",
      ],
    };
  }

  const hasTabularSignal =
    /\bcsv\b|\btable\b|\bspreadsheet\b|\brows?\b|\bcolumns?\b|\branking\b|\blabels?\b|\bpredictions?\b/i.test(
      sourceText,
    ) || artifactColumns.length > 0;
  if (hasTabularSignal) {
    const suggestedColumns = /\brank|ranking|leaderboard|score/i.test(
      sourceText,
    )
      ? ["id", "score"]
      : /\blabel|class/i.test(sourceText)
        ? ["id", "label"]
        : ["id", "value"];
    return {
      solverDeliverable: "Structured tabular submission",
      artifactKind: "csv_table",
      schemaRequirements: {
        expected_kind: "csv_table",
        suggested_columns: suggestedColumns,
      },
      validationRules: [
        "Submission must be a structured table file with stable row identifiers.",
        "Column names and value semantics must be locked before publish.",
      ],
    };
  }

  if (/\b(file|artifact|report|document|pdf|image)\b/i.test(sourceText)) {
    return {
      solverDeliverable: "Deterministic file artifact",
      artifactKind: "opaque_file",
      schemaRequirements: inferOpaqueFileSchemaRequirements({
        brief: input.brief,
        payoutCondition: input.payoutCondition,
        artifacts: input.artifacts,
      }),
      validationRules: [
        "Submission file type and validation rules must be locked before publish.",
      ],
    };
  }

  return null;
}

function inferSemiCustomEvaluatorArchetype(input: {
  brief: string;
  payoutCondition: string | null;
  submissionKind: string | null;
}): EvaluatorArchetypeId {
  const sourceText =
    `${input.brief}\n${input.payoutCondition ?? ""}`.toLowerCase();
  if (
    /\b(exact match|match exactly|reproduce|same output)\b/i.test(sourceText)
  ) {
    return "exact_artifact_match";
  }
  switch (input.submissionKind) {
    case "csv_table":
      return "structured_table_score";
    case "json_file":
      return "structured_record_score";
    case "bundle_or_code":
      return "bundle_or_code_judge";
    default:
      return "opaque_file_judge";
  }
}

function buildSemiCustomEvaluatorContract(input: {
  archetypeId: EvaluatorArchetypeId;
  archetypeLabel: string;
  artifacts: ChallengeAuthoringIrOutput["artifacts"];
  submission: InferredSubmissionShape;
  winningDefinition: string | null;
  comparator: ChallengeAuthoringIrOutput["objective"]["comparator"];
  metric: string | null;
  minimumThreshold: string | null;
}) {
  const solverVisibleArtifactRoles = input.artifacts
    .filter((artifact) => artifact.visibility !== "private")
    .map((artifact) => artifact.selected_role ?? artifact.id);
  const hiddenArtifactRoles = input.artifacts
    .filter((artifact) => artifact.visibility === "private")
    .map((artifact) => artifact.selected_role ?? artifact.id);
  const resolvedMetric =
    input.metric ??
    inferSemiCustomMetric({
      archetypeId: input.archetypeId,
      winningDefinition: input.winningDefinition,
    }) ??
    "custom";
  const execution =
    input.archetypeId === "structured_table_score" &&
    resolvedMetric !== "custom"
      ? inferStructuredTableExecution(input.artifacts)
      : input.archetypeId === "structured_record_score" &&
          resolvedMetric === "validation_score"
        ? inferStructuredRecordExecution(input.artifacts)
      : input.archetypeId === "exact_artifact_match" &&
          resolvedMetric === "exact_match"
        ? inferExactArtifactMatchExecution(
            input.artifacts,
            input.submission.artifactKind,
          )
        : null;
  const executionNote =
    execution?.template === "official_table_metric_v1"
      ? "This evaluator contract maps to the official structured table execution template."
      : execution?.template === "official_structured_record_v1"
        ? "This evaluator contract maps to the official structured record execution template."
      : execution?.template === "official_exact_match_v1"
        ? "This evaluator contract maps to the official exact artifact match execution template."
        : "This evaluator contract is typed and reviewable, but still needs a configured execution path.";

  return createSemiCustomEvaluatorContract({
    archetype: input.archetypeId,
    summary: `${input.archetypeLabel} evaluator contract for deterministic scoring outside the current managed runtime catalog.`,
    solverVisibleArtifactRoles,
    hiddenArtifactRoles,
    submissionKind: input.submission.artifactKind,
    schemaRequirements: input.submission.schemaRequirements,
    validationRules: input.submission.validationRules,
    metric: resolvedMetric,
    comparator: input.comparator ?? "custom",
    deterministicRule:
      input.winningDefinition ??
      "Deterministically score the solver submission according to the typed evaluator contract.",
    minimumThreshold: input.minimumThreshold,
    ...(execution ? { execution } : {}),
    notes: [executionNote],
  });
}

function inferSemiCustomMetric(input: {
  archetypeId: EvaluatorArchetypeId;
  winningDefinition: string | null;
}) {
  const sourceText = input.winningDefinition?.toLowerCase() ?? "";
  if (input.archetypeId === "structured_record_score") {
    return "validation_score";
  }
  if (input.archetypeId === "structured_table_score") {
    if (/\brmse\b/.test(sourceText)) return "rmse";
    if (/\bmae\b/.test(sourceText)) return "mae";
    if (/\bpearson\b/.test(sourceText)) return "pearson";
    if (/\bspearman\b/.test(sourceText)) return "spearman";
    if (/\baccuracy\b/.test(sourceText)) return "accuracy";
    if (/\bf1\b/.test(sourceText)) return "f1";
    if (/\br2\b/.test(sourceText)) return "r2";
  }
  if (/\bexact match\b|\bmatch exactly\b/.test(sourceText)) {
    return "exact_match";
  }
  return null;
}

function inferStructuredRecordExecution(
  artifacts: ChallengeAuthoringIrOutput["artifacts"],
) {
  const hiddenRubricArtifact = artifacts.find(
    (artifact) =>
      artifact.visibility === "private" &&
      typeof artifact.selected_role === "string" &&
      (/^application\/json\b/i.test(artifact.mime_type ?? "") ||
        artifact.file_name?.toLowerCase().endsWith(".json") === true),
  );
  const evaluationArtifactRole = hiddenRubricArtifact?.selected_role;
  if (!evaluationArtifactRole) {
    return null;
  }

  return createSemiCustomStructuredRecordExecution({
    evaluationArtifactRole,
    policies: createRuntimePolicies({
      coveragePolicy: "reject",
      duplicateIdPolicy: "reject",
      invalidValuePolicy: "reject",
    }),
  });
}

function inferStructuredTableExecution(
  artifacts: ChallengeAuthoringIrOutput["artifacts"],
) {
  const hiddenTableArtifact = artifacts.find(
    (artifact) =>
      artifact.visibility === "private" &&
      typeof artifact.selected_role === "string" &&
      artifact.detected_schema?.kind === "csv_table",
  );
  const detectedSchema = hiddenTableArtifact?.detected_schema;
  if (
    !hiddenTableArtifact ||
    !detectedSchema ||
    detectedSchema.kind !== "csv_table"
  ) {
    return null;
  }

  const columns = detectedSchema.columns;
  const idColumn =
    columns.find((column) => column.toLowerCase() === "id") ?? columns[0];
  const valueColumn =
    columns.find(
      (column) =>
        column !== idColumn &&
        /(label|score|value|target|truth|answer|class|rank)/i.test(column),
    ) ??
    columns.find((column) => column !== idColumn) ??
    null;
  const evaluationArtifactRole = hiddenTableArtifact.selected_role;
  if (!idColumn || !valueColumn || !evaluationArtifactRole) {
    return null;
  }

  return createSemiCustomStructuredTableExecution({
    evaluationArtifactRole,
    evaluationContract: createCsvTableEvaluationContract({
      requiredColumns: [idColumn, valueColumn],
      idColumn,
      valueColumn,
    }),
    policies: createRuntimePolicies({
      coveragePolicy: "reject",
      duplicateIdPolicy: "reject",
      invalidValuePolicy: "reject",
    }),
  });
}

function inferExactArtifactMatchExecution(
  artifacts: ChallengeAuthoringIrOutput["artifacts"],
  submissionKind: InferredSubmissionShape["artifactKind"],
) {
  const hiddenReferenceArtifact = artifacts.find(
    (artifact) =>
      artifact.visibility === "private" &&
      typeof artifact.selected_role === "string" &&
      (submissionKind === "csv_table"
        ? artifact.detected_schema?.kind === "csv_table"
        : submissionKind === "json_file"
          ? /^application\/json\b/i.test(artifact.mime_type ?? "") ||
            artifact.file_name?.toLowerCase().endsWith(".json") === true
          : submissionKind === "opaque_file"),
  );
  const evaluationArtifactRole = hiddenReferenceArtifact?.selected_role;
  if (!evaluationArtifactRole) {
    return null;
  }

  return createSemiCustomExactArtifactMatchExecution({
    evaluationArtifactRole,
    policies: createRuntimePolicies({
      coveragePolicy: "reject",
      duplicateIdPolicy: "reject",
      invalidValuePolicy: "reject",
    }),
  });
}

function inferRoleHypotheses(
  artifact: AuthoringArtifactOutput,
  runtimeFamily?: SupportedRuntimeFamily,
) {
  const source = [
    artifact.file_name?.trim(),
    artifact.id?.trim(),
    !artifact.file_name && !artifact.id ? artifact.uri : null,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
  const columns =
    artifact.detected_columns?.map((column) => column.toLowerCase()) ?? [];
  const hints: Array<{ role: string; confidence: number }> = [];

  const add = (role: string, confidence: number) => {
    if (!hints.some((hint) => hint.role === role)) {
      hints.push({ role, confidence });
    }
  };

  if (!runtimeFamily) {
    if (
      /(source|train|data|dataset|input|feature|context|template|schema|example|sample|public|eval|records?)/i.test(
        source,
      )
    ) {
      add("public_inputs", 0.82);
    }
    if (
      /(hidden|reference|expected|truth|ground|gold|answer|rubric|solution|output)/i.test(
        source,
      )
    ) {
      add("hidden_reference", 0.88);
    }
    if (/(brief|instruction|guide|readme|prompt|spec)/i.test(source)) {
      add("supporting_context", 0.8);
    }
    if (columns.includes("label") || columns.includes("answer")) {
      add("hidden_reference", 0.78);
    }
    if (columns.includes("id") && columns.length > 1) {
      add("public_inputs", 0.45);
    }
    return hints.sort((left, right) => right.confidence - left.confidence);
  }

  if (/(train|source|dataset|input)/i.test(source)) add("training_data", 0.82);
  if (/(eval|evaluation|test|feature|holdout|scoring)/i.test(source))
    add("evaluation_features", 0.8);
  if (/(hidden|label|truth|ground|answer|gold)/i.test(source))
    add("hidden_labels", 0.88);
  if (/(reference|expected|output)/i.test(source))
    add("reference_output", 0.86);
  if (/(rank|candidate|items|query)/i.test(source)) add("ranking_inputs", 0.72);
  if (/(reference.*rank|gold.*rank|hidden.*rank)/i.test(source)) {
    add("reference_ranking", 0.85);
  }
  if (/(target|protein|pocket|receptor|structure)/i.test(source)) {
    add("target_structure", 0.9);
  }
  if (/(ligand|compound|smiles|library)/i.test(source))
    add("ligand_library", 0.86);
  if (/(reference.*score|score.*reference|docking.*score)/i.test(source)) {
    add("reference_scores", 0.9);
  }
  if (columns.includes("label")) add("hidden_labels", 0.78);
  if (columns.includes("prediction")) add("evaluation_features", 0.45);
  if (columns.includes("reference_score")) add("reference_scores", 0.88);
  if (columns.includes("smiles")) add("ligand_library", 0.84);
  if (columns.includes("ligand_id")) add("ligand_library", 0.5);

  const supportedRoles = runtimeFamily
    ? new Set(
        lookupManagedRuntimeFamily(runtimeFamily)?.supportedArtifactRoles ?? [],
      )
    : null;
  const filtered = supportedRoles
    ? hints.filter((hint) => supportedRoles.has(hint.role))
    : hints;

  return filtered.sort((left, right) => right.confidence - left.confidence);
}

function defaultVisibilityForRole(role: string): "public" | "private" {
  return role.startsWith("hidden_") ||
    role === "reference_output" ||
    role === "reference_ranking" ||
    role === "reference_scores"
    ? "private"
    : "public";
}

function rolePromptForRuntimeFamily(
  runtimeFamily?: SupportedRuntimeFamily | null,
) {
  switch (runtimeFamily) {
    case "reproducibility":
      return "Which uploaded file is the solver-visible source input, and which file is the hidden reference output Agora should compare against?";
    case "ranking":
      return "Which uploaded file contains the solver-visible ranking inputs, and which file contains the hidden reference ranking or labels?";
    case "docking":
      return "Which uploaded file is the target structure, which file is the ligand set, and which file contains the hidden reference docking scores?";
    case "tabular_classification":
    case "tabular_regression":
      return "Which uploaded file is training data, which file contains evaluation features, and which file contains the hidden labels?";
    default:
      return "Which uploaded files should Agora treat as solver-visible inputs, and which files should stay hidden for evaluation?";
  }
}

function buildBlockingReasons(input: {
  hasBrief: boolean;
  hasWinningDefinition: boolean;
  hasArtifacts: boolean;
  artifactsNeedRoleClarification: boolean;
  artifactsNeedVisibilityClarification: boolean;
  hasReward: boolean;
  hasDistribution: boolean;
  hasDeadline: boolean;
  submissionDeliverableKnown: boolean;
  error?: AgoraError;
}) {
  const reasons: string[] = [];

  if (!input.hasBrief) reasons.push("problem_statement_missing");
  if (!input.hasWinningDefinition) reasons.push("objective_missing");
  if (!input.hasArtifacts) reasons.push("missing_artifacts");
  if (!input.submissionDeliverableKnown)
    reasons.push("submission_contract_missing");
  if (input.artifactsNeedRoleClarification)
    reasons.push("artifact_roles_unresolved");
  if (input.artifactsNeedVisibilityClarification)
    reasons.push("artifact_visibility_unresolved");
  if (!input.hasReward) reasons.push("reward_missing");
  if (!input.hasDistribution) reasons.push("distribution_missing");
  if (!input.hasDeadline) reasons.push("deadline_missing");

  switch (input.error?.code) {
    case "MANAGED_THRESHOLD_UNSUPPORTED":
      reasons.push("threshold_policy_unsupported");
      break;
    case "MANAGED_ARTIFACTS_INCOMPLETE":
      reasons.push("missing_artifacts");
      break;
    case "MANAGED_ARTIFACTS_AMBIGUOUS":
    case "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID":
      reasons.push(
        "artifact_roles_unresolved",
        "artifact_visibility_unresolved",
      );
      break;
    default:
      break;
  }

  return [...new Set(reasons)];
}

function buildOpenQuestions(input: {
  blockingReasons: string[];
  runtimeFamily?: SupportedRuntimeFamily;
  metric?: string | null;
  error?: AgoraError;
  artifactCount: number;
}): ChallengeAuthoringIrOutput["clarification"]["open_questions"] {
  const questions: ChallengeAuthoringIrOutput["clarification"]["open_questions"] =
    [];
  const add = (
    id: string,
    prompt: string,
    reasonCode: string,
    nextStep: string,
    blocksPublish = true,
  ) => {
    if (!questions.some((question) => question.id === id)) {
      questions.push({
        id,
        prompt,
        reason_code: reasonCode,
        next_step: nextStep,
        blocks_publish: blocksPublish,
      });
    }
  };

  if (input.blockingReasons.includes("objective_missing")) {
    add(
      "winning-definition",
      "How should Agora decide what counts as winning in a way a scorer can check deterministically?",
      "objective_missing",
      "State the exact score, ranking rule, or pass/fail condition that should determine payout.",
    );
  }

  if (input.blockingReasons.includes("missing_artifacts")) {
    add(
      "missing-artifacts",
      input.artifactCount === 0
        ? "What files will solvers need, and what hidden file will Agora score against?"
        : "What file is still missing from this challenge draft, and what role should it play in scoring?",
      "missing_artifacts",
      "Upload the missing file, give it a descriptive name, and compile again.",
    );
  }

  if (input.blockingReasons.includes("submission_contract_missing")) {
    add(
      "submission-shape",
      "What exactly do solvers submit: a CSV, JSON file, bundle, report, or some other deterministic artifact?",
      "submission_contract_missing",
      "Describe the required submission artifact and any required columns or fields.",
    );
  }

  if (input.blockingReasons.includes("artifact_roles_unresolved")) {
    add(
      "artifact-roles",
      rolePromptForRuntimeFamily(input.runtimeFamily),
      "artifact_roles_unresolved",
      "Rename the files or describe their roles explicitly so Agora can lock the scoring contract.",
    );
  }

  if (input.blockingReasons.includes("artifact_visibility_unresolved")) {
    add(
      "artifact-visibility",
      "Which files should solvers see up front, and which files must stay hidden until scoring?",
      "artifact_visibility_unresolved",
      "Make the public/private split explicit so Agora can lock the contract safely.",
    );
  }

  if (input.blockingReasons.includes("threshold_policy_unsupported")) {
    add(
      "threshold-policy",
      "Do you want Agora to rank submissions by the metric alone, or do you need a custom pass/fail threshold that should move to Expert Mode?",
      "threshold_policy_unsupported",
      "Remove the explicit RMSE/MAE threshold and rank by score, or switch to Expert Mode for a custom evaluator.",
    );
  }

  if (input.blockingReasons.includes("reward_missing")) {
    add(
      "reward-total",
      "How much USDC do you want to pay out for this challenge?",
      "reward_missing",
      "Set the total reward amount in USDC so Agora can build the escrow contract.",
    );
  }

  if (input.blockingReasons.includes("distribution_missing")) {
    add(
      "reward-distribution",
      "Should Agora pay only the top solver, the top three solvers, or distribute rewards proportionally?",
      "distribution_missing",
      "Choose a payout split so Agora can lock the challenge economics.",
    );
  }

  if (input.blockingReasons.includes("deadline_missing")) {
    add(
      "submission-deadline",
      "When should solver submissions close?",
      "deadline_missing",
      "Set a submission deadline or submission window so Agora can publish a valid contract.",
    );
  }

  return questions;
}

function buildAmbiguityState(input: {
  brief: string;
  payoutCondition: string | null;
  runtimeFamily?: SupportedRuntimeFamily;
  metric?: string | null;
  artifacts: ChallengeAuthoringIrOutput["artifacts"];
  blockingReasons: string[];
  routingMode: RoutingMode;
  routingConfidence: number;
  submissionDeliverableKnown: boolean;
  intent?: ChallengeIntentOutput | null;
  error?: AgoraError;
}): ChallengeAuthoringIrOutput["ambiguity"] {
  const classes = new Set<AmbiguityClass>();
  const alternatives: string[] = [];

  if (input.brief.length === 0) {
    classes.add("not_deterministic_yet");
  }
  if (input.payoutCondition === null) {
    classes.add("objective_missing");
    classes.add("not_deterministic_yet");
  }
  if (!input.submissionDeliverableKnown) {
    classes.add("submission_shape_missing");
    classes.add("data_format_unclear");
  }
  if (input.blockingReasons.includes("artifact_roles_unresolved")) {
    classes.add("artifact_roles_unclear");
  }
  if (input.blockingReasons.includes("artifact_visibility_unresolved")) {
    classes.add("privacy_unclear");
  }
  if (input.blockingReasons.includes("reward_missing")) {
    classes.add("reward_unclear");
  }
  if (input.blockingReasons.includes("distribution_missing")) {
    classes.add("distribution_unclear");
  }
  if (input.blockingReasons.includes("deadline_missing")) {
    classes.add("deadline_unclear");
  }
  if (
    input.error?.code === "MANAGED_THRESHOLD_UNSUPPORTED" ||
    input.routingMode === "expert_mode_required" ||
    input.routingMode === "semi_custom"
  ) {
    classes.add("custom_evaluator_needed");
  }
  if (
    input.runtimeFamily === undefined &&
    input.brief.length > 0 &&
    input.payoutCondition !== null &&
    input.artifacts.length > 0
  ) {
    classes.add("custom_evaluator_needed");
    classes.add("multi_family_ambiguous");
    alternatives.push(
      "This draft may need either a managed runtime clarification or a semi-custom evaluator.",
    );
  }
  if (
    (input.intent?.domain ?? "other") === "other" &&
    input.runtimeFamily === undefined &&
    input.brief.length > 0
  ) {
    classes.add("domain_ambiguous");
  }

  const metricHintPattern = input.runtimeFamily
    ? RUNTIME_METRIC_HINT_PATTERNS[input.runtimeFamily]
    : undefined;
  if (
    input.runtimeFamily &&
    input.metric &&
    metricHintPattern &&
    !metricHintPattern.test(`${input.brief}\n${input.payoutCondition ?? ""}`)
  ) {
    classes.add("evaluation_metric_unclear");
    const runtimeFamilyConfig = lookupManagedRuntimeFamily(input.runtimeFamily);
    if (runtimeFamilyConfig) {
      alternatives.push(
        `Possible metric candidates: ${runtimeFamilyConfig.supportedMetrics
          .map((supportedMetric) => supportedMetric.id)
          .join(", ")}.`,
      );
    }
  }

  const roleResolutionRatio =
    input.artifacts.length === 0
      ? 0
      : input.artifacts.filter((artifact) => artifact.selected_role !== null)
          .length / input.artifacts.length;
  const visibilityResolutionRatio =
    input.artifacts.length === 0
      ? 0
      : input.artifacts.filter(
          (artifact) =>
            artifact.required_for_publish && artifact.visibility !== null,
        ).length / input.artifacts.length;
  const economicsSignals = [
    !input.blockingReasons.includes("reward_missing"),
    !input.blockingReasons.includes("distribution_missing"),
    !input.blockingReasons.includes("deadline_missing"),
  ].filter(Boolean).length;

  return {
    classes: [...classes],
    alternative_interpretations: alternatives,
    confidence_by_section: {
      problem: roundConfidence(input.brief.length > 0 ? 1 : 0),
      objective: roundConfidence(input.payoutCondition ? 1 : 0),
      artifacts: roundConfidence(
        input.artifacts.length === 0
          ? 0
          : (roleResolutionRatio + visibilityResolutionRatio) / 2,
      ),
      submission: roundConfidence(input.submissionDeliverableKnown ? 1 : 0.2),
      evaluation: roundConfidence(
        input.runtimeFamily && input.metric ? input.routingConfidence : 0.25,
      ),
      economics: roundConfidence(economicsSignals / 3),
    },
  };
}

export function buildManagedAuthoringIr(input: {
  intent?: ChallengeIntentOutput | null;
  uploadedArtifacts: AuthoringArtifactOutput[];
  sourceTitle?: string | null;
  sourceMessages?: ExternalSourceMessageOutput[];
  runtimeFamily?: SupportedRuntimeFamily;
  metric?: string | null;
  confidenceScore?: number;
  error?: AgoraError;
  routingMode?: RoutingMode;
  origin?: Partial<ChallengeAuthoringIrOutput["origin"]> | null;
}): ChallengeAuthoringIrOutput {
  const intent = input.intent ?? null;
  const sourceMessages = (input.sourceMessages ?? []).map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content.trim(),
    created_at: message.created_at ?? new Date().toISOString(),
  }));
  const sourceMessageBrief = sourceMessages
    .filter((message) => message.role !== "system")
    .map((message) => message.content)
    .join("\n\n");
  const brief = [
    trimmed(input.sourceTitle),
    trimmed(intent?.title),
    trimmed(intent?.description),
    trimmed(sourceMessageBrief),
  ]
    .filter((value): value is string => value !== null)
    .join("\n\n");
  const payoutCondition = trimmed(intent?.payout_condition);
  const metricDefinition =
    input.runtimeFamily && input.metric
      ? getManagedRuntimeMetric(input.runtimeFamily, input.metric)
      : undefined;
  const comparator = parseComparator({
    payoutCondition,
    metricDefinition,
  });

  const artifacts = input.uploadedArtifacts.map((artifact, index) => {
    const hypotheses = inferRoleHypotheses(artifact, input.runtimeFamily);
    const topHypothesis = hypotheses[0];
    const selectedRole =
      topHypothesis && topHypothesis.confidence >= 0.8
        ? topHypothesis.role
        : null;
    return {
      id: artifactId(artifact, index),
      uri: artifact.uri,
      file_name: trimmed(artifact.file_name),
      mime_type: trimmed(artifact.mime_type),
      detected_schema:
        artifact.detected_columns && artifact.detected_columns.length > 0
          ? {
              kind: "csv_table" as const,
              columns: artifact.detected_columns,
            }
          : {
              kind: "binary_or_other" as const,
            },
      poster_description: null,
      role_hypotheses: hypotheses,
      selected_role: selectedRole,
      visibility: selectedRole ? defaultVisibilityForRole(selectedRole) : null,
      required_for_publish: true,
    };
  });

  const runtimeFamily = input.runtimeFamily ?? null;
  const runtimeFamilyConfig = runtimeFamily
    ? lookupManagedRuntimeFamily(runtimeFamily)
    : undefined;
  const inferredSubmission =
    inferGenericSubmissionShape({
      brief,
      payoutCondition,
      artifacts: input.uploadedArtifacts,
      runtimeFamily,
    }) ?? null;
  const scoreability =
    payoutCondition && artifacts.length > 0 && inferredSubmission
      ? runtimeFamily
        ? "deterministic"
        : "deterministic_with_custom_evaluator"
      : "not_objective_yet";
  const submissionDeliverableKnown = inferredSubmission !== null;
  const blockingReasons = buildBlockingReasons({
    hasBrief: brief.length > 0,
    hasWinningDefinition: payoutCondition !== null,
    hasArtifacts: artifacts.length > 0,
    artifactsNeedRoleClarification: artifacts.some(
      (artifact) => artifact.selected_role === null,
    ),
    artifactsNeedVisibilityClarification: artifacts.some(
      (artifact) =>
        artifact.required_for_publish &&
        artifact.selected_role !== null &&
        artifact.visibility === null,
    ),
    hasReward: trimmed(intent?.reward_total) !== null,
    hasDistribution: intent?.distribution !== undefined,
    hasDeadline: trimmed(intent?.deadline) !== null,
    submissionDeliverableKnown,
    error: input.error,
  });

  const openQuestions = buildOpenQuestions({
    blockingReasons,
    runtimeFamily: input.runtimeFamily,
    metric: input.metric,
    error: input.error,
    artifactCount: artifacts.length,
  });

  const routingMode =
    input.routingMode ??
    (blockingReasons.length > 0
      ? "not_ready"
      : runtimeFamily
        ? "managed_supported"
        : "semi_custom");

  const routingConfidence =
    typeof input.confidenceScore === "number"
      ? input.confidenceScore
      : blockingReasons.length > 0
        ? 0.4
        : 0.8;
  const semiCustomArchetypeId =
    inferredSubmission && scoreability === "deterministic_with_custom_evaluator"
      ? inferSemiCustomEvaluatorArchetype({
          brief,
          payoutCondition,
          submissionKind: inferredSubmission.artifactKind,
        })
      : null;
  const semiCustomArchetype = semiCustomArchetypeId
    ? getEvaluatorArchetype(semiCustomArchetypeId)
    : null;
  const domainHint = trimmed(intent?.domain);
  const ambiguity = buildAmbiguityState({
    brief,
    payoutCondition,
    runtimeFamily: input.runtimeFamily,
    metric: input.metric,
    artifacts,
    blockingReasons,
    routingMode,
    routingConfidence,
    submissionDeliverableKnown,
    intent,
    error: input.error,
  });

  return {
    version: 1,
    origin: {
      provider: input.origin?.provider ?? "direct",
      external_id: trimmed(input.origin?.external_id) ?? null,
      external_url:
        typeof input.origin?.external_url === "string" &&
        input.origin.external_url.trim().length > 0
          ? input.origin.external_url.trim()
          : null,
      ingested_at: input.origin?.ingested_at ?? new Date().toISOString(),
      raw_context: input.origin?.raw_context ?? null,
    },
    source: {
      poster_messages:
        sourceMessages.length > 0
          ? sourceMessages
          : brief
            ? [
                {
                  id: "poster-brief",
                  role: "poster",
                  content: brief,
                  created_at: new Date().toISOString(),
                },
              ]
            : [],
      uploaded_artifact_ids: artifacts.map((artifact) => artifact.id),
    },
    problem: {
      raw_brief: brief,
      normalized_summary:
        trimmed(intent?.description) ??
        sourceMessages.find((message) => message.role === "poster")?.content ??
        null,
      domain_hints: domainHint ? [domainHint] : [],
      hard_constraints: [],
    },
    objective: {
      solver_goal: trimmed(intent?.description),
      winning_definition: payoutCondition,
      comparator,
      primary_metric: input.metric ?? null,
      minimum_threshold: parseMinimumThreshold(payoutCondition),
      secondary_constraints: [],
    },
    artifacts,
    submission: {
      solver_deliverable: inferredSubmission?.solverDeliverable ?? null,
      artifact_kind: inferredSubmission?.artifactKind ?? null,
      schema_requirements: inferredSubmission?.schemaRequirements ?? null,
      validation_rules: inferredSubmission?.validationRules ?? [],
    },
    evaluation: {
      scoreability,
      evaluator_candidates: runtimeFamily
        ? [
            {
              id: runtimeFamily,
              kind: "managed_template",
              confidence: routingConfidence,
              notes: runtimeFamilyConfig
                ? [
                    `${runtimeFamilyConfig.displayName} is the current best managed fit.`,
                  ]
                : [],
            },
          ]
        : inferredSubmission &&
            scoreability === "deterministic_with_custom_evaluator" &&
            semiCustomArchetypeId
          ? (() => {
              return [
                {
                  id: semiCustomArchetypeId,
                  kind: "semi_custom" as const,
                  confidence: routingConfidence,
                  notes: [
                    semiCustomArchetype
                      ? `${semiCustomArchetype.label} is the current best evaluator archetype fit.`
                      : "This draft is deterministic but needs a configurable evaluator path.",
                    "No current managed runtime family fits this challenge cleanly.",
                  ],
                },
              ];
            })()
          : [],
      selected_evaluator:
        runtimeFamily ??
        (inferredSubmission &&
        scoreability === "deterministic_with_custom_evaluator" &&
        semiCustomArchetypeId
          ? semiCustomArchetypeId
          : null),
      runtime_family: runtimeFamily,
      metric: input.metric ?? null,
      semi_custom_contract:
        inferredSubmission &&
        scoreability === "deterministic_with_custom_evaluator" &&
        semiCustomArchetypeId &&
        semiCustomArchetype
          ? buildSemiCustomEvaluatorContract({
              archetypeId: semiCustomArchetypeId,
              archetypeLabel: semiCustomArchetype.label,
              artifacts,
              submission: inferredSubmission,
              winningDefinition: payoutCondition,
              comparator,
              metric: input.metric ?? null,
              minimumThreshold: parseMinimumThreshold(payoutCondition),
            })
          : null,
      compute_hints:
        inferredSubmission?.artifactKind === "bundle_or_code"
          ? ["Evaluator must execute a bounded bundle or code artifact."]
          : [],
      privacy_requirements: artifacts.some(
        (artifact) => artifact.visibility === "private",
      )
        ? ["Private evaluation artifacts must remain hidden until scoring."]
        : [],
    },
    economics: {
      reward_total: trimmed(intent?.reward_total),
      distribution: intent?.distribution ?? null,
      submission_deadline: trimmed(intent?.deadline),
      dispute_window_hours:
        typeof intent?.dispute_window_hours === "number"
          ? intent.dispute_window_hours
          : null,
    },
    ambiguity,
    routing: {
      mode: routingMode,
      confidence_score: routingConfidence,
      blocking_reasons: blockingReasons,
      recommended_next_action:
        openQuestions[0]?.next_step ??
        (routingMode === "managed_supported"
          ? "Review the compiled contract before publishing."
          : null),
    },
    clarification: {
      open_questions: openQuestions,
      resolved_assumptions: [],
      contradictions: [],
    },
  };
}

export function buildClarificationQuestionsFromAuthoringIr(
  authoringIr: ChallengeAuthoringIrOutput,
): ClarificationQuestionOutput[] {
  return authoringIr.clarification.open_questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    reason_code: question.reason_code,
    next_step: question.next_step,
  }));
}
