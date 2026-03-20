import {
  AgoraError,
  type AuthoringArtifactOutput,
  type ChallengeAuthoringIrOutput,
  type ChallengeIntentOutput,
  type ChallengeSpecOutput,
  type ClarificationQuestionOutput,
  type CompilationResultOutput,
  type ConfirmationContractOutput,
  type DryRunPreviewOutput,
  PROTOCOL_FEE_PERCENT,
  canonicalizeChallengeSpec,
  challengeSpecSchemaForChain,
  createCsvTableSubmissionContract,
  getChallengeCompatibilityType,
  getManagedRuntimeMetric,
  lookupManagedRuntimeFamily,
  readApiServerRuntimeConfig,
  validateChallengeScoreability,
} from "@agora/common";
import type { getText } from "@agora/ipfs";
import type { executeScoringPipeline } from "@agora/scorer";
import {
  type CompilerArtifactAssignment,
  type SupportedRuntimeFamily,
  compileManagedAuthoringProposal,
} from "./managed-authoring-compiler.js";
import {
  executeManagedAuthoringDryRun,
} from "./managed-authoring-dry-run.js";
import {
  buildClarificationQuestionsFromAuthoringIr,
  buildManagedAuthoringIr,
} from "./managed-authoring-ir.js";
import { readManagedAuthoringRuntimeConfig } from "./managed-authoring-runtime.js";

interface ParsedThreshold {
  operator: "gte" | "lte";
  value: number;
}

const CLARIFICATION_ERROR_CODES = new Set([
  "MANAGED_ARTIFACTS_INCOMPLETE",
  "MANAGED_ARTIFACTS_AMBIGUOUS",
  "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID",
  "MANAGED_THRESHOLD_UNSUPPORTED",
  "MANAGED_COMPILER_NEEDS_INPUT",
]);

export interface ManagedAuthoringDraftOutcome {
  state: "ready" | "needs_clarification" | "failed";
  compilation?: CompilationResultOutput;
  clarificationQuestions?: ClarificationQuestionOutput[];
  authoringIr: ChallengeAuthoringIrOutput;
  message?: string;
}

interface DraftCompilation {
  proposal: Awaited<ReturnType<typeof compileManagedAuthoringProposal>>;
  compilation: CompilationResultOutput;
}

function formatUsdc(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatDeadline(deadlineIso: string, timezone: string) {
  try {
    return `${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(deadlineIso))} (${timezone})`;
  } catch {
    return `${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(deadlineIso))} (UTC)`;
  }
}

function artifactName(artifact: AuthoringArtifactOutput) {
  return artifact.file_name?.trim() || artifact.uri;
}

function matchesArtifactPattern(
  artifact: AuthoringArtifactOutput,
  pattern: RegExp,
) {
  return pattern.test(artifactName(artifact).toLowerCase());
}

function findFirstMatchingArtifact(
  artifacts: AuthoringArtifactOutput[],
  pattern: RegExp,
  exclude = new Set<string>(),
) {
  return artifacts.find((artifact, index) => {
    const key = artifact.id ?? `${index}:${artifact.uri}`;
    return !exclude.has(key) && matchesArtifactPattern(artifact, pattern);
  });
}

function artifactKey(artifact: AuthoringArtifactOutput, index: number) {
  return artifact.id ?? `${index}:${artifact.uri}`;
}

function escapeMetricPattern(metric: string) {
  return metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metricPattern(metric: string) {
  if (metric === "exact_match") {
    return "(?:exact\\s*match|match)";
  }
  if (metric === "tolerant_match") {
    return "(?:tolerant\\s*match|match)";
  }
  return escapeMetricPattern(metric);
}

function parsePayoutThreshold(
  runtimeFamily: SupportedRuntimeFamily,
  metric: string,
  sourceText: string,
): ParsedThreshold | undefined {
  const metricDefinition = getManagedRuntimeMetric(runtimeFamily, metric);
  if (!metricDefinition) {
    return undefined;
  }

  const operatorPattern =
    metricDefinition.direction === "lower"
      ? "(<=|<|at most|less than|under|below|no more than)"
      : "(>=|>|at least|more than|above|over|no less than)";

  const thresholdPattern = new RegExp(
    `${metricPattern(metric)}[^0-9<>]{0,20}${operatorPattern}\\s*([0-9]+(?:\\.[0-9]+)?)`,
    "i",
  );
  const match = thresholdPattern.exec(sourceText);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[2]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return {
    operator: metricDefinition.direction === "lower" ? "lte" : "gte",
    value: parsed,
  };
}

function inferIdColumn(artifact?: AuthoringArtifactOutput) {
  const columns = artifact?.detected_columns ?? [];
  const explicitId = columns.find((column: string) => /^id$/i.test(column));
  return explicitId ?? columns[0] ?? "id";
}

function ensureArtifactCount(
  uploadedArtifacts: AuthoringArtifactOutput[],
  minimum: number,
  runtimeFamily: SupportedRuntimeFamily,
) {
  if (uploadedArtifacts.length >= minimum) {
    return;
  }

  throw new AgoraError(
    `Managed authoring needs at least ${minimum} uploaded file${minimum === 1 ? "" : "s"} for ${runtimeFamily.replace(/_/g, " ")} challenges. Next step: attach the missing files or use Expert Mode.`,
    {
      code: "MANAGED_ARTIFACTS_INCOMPLETE",
      status: 422,
      details: { runtimeFamily, minimumArtifacts: minimum },
    },
  );
}

function defaultVisibilityForRole(role: string): "public" | "private" {
  switch (role) {
    case "hidden_labels":
    case "reference_ranking":
    case "reference_scores":
      return "private";
    default:
      return "public";
  }
}

function assignArtifactsHeuristically(input: {
  runtimeFamily: SupportedRuntimeFamily;
  uploadedArtifacts: AuthoringArtifactOutput[];
}) {
  const usedKeys = new Set<string>();
  const artifacts = input.uploadedArtifacts;

  const pick = (pattern: RegExp) => {
    const artifact = findFirstMatchingArtifact(artifacts, pattern, usedKeys);
    if (!artifact) {
      return null;
    }
    const index = artifacts.indexOf(artifact);
    usedKeys.add(artifactKey(artifact, index));
    return artifact;
  };

  const pickFallback = () => {
    const index = artifacts.findIndex(
      (artifact, artifactIndex) =>
        !usedKeys.has(artifactKey(artifact, artifactIndex)),
    );
    if (index < 0) {
      return null;
    }
    const artifact = artifacts[index];
    if (!artifact) {
      return null;
    }
    usedKeys.add(artifactKey(artifact, index));
    return artifact;
  };

  switch (input.runtimeFamily) {
    case "reproducibility": {
      ensureArtifactCount(artifacts, 2, input.runtimeFamily);
      const sourceData =
        pick(/(?:source|input|train|dataset|data)/i) ?? artifacts[0] ?? null;
      if (sourceData) {
        usedKeys.add(artifactKey(sourceData, artifacts.indexOf(sourceData)));
      }
      const referenceOutput =
        pick(/(?:reference|expected|output|truth|answer|gold)/i) ??
        pickFallback() ??
        null;

      if (!sourceData || !referenceOutput) {
        throw new AgoraError(
          "Agora could not map the uploaded files to source data and reference output. Next step: rename the files to make their roles obvious or use Expert Mode.",
          {
            code: "MANAGED_ARTIFACTS_AMBIGUOUS",
            status: 422,
            details: { runtimeFamily: input.runtimeFamily },
          },
        );
      }

      const requiredColumns = referenceOutput.detected_columns?.length
        ? referenceOutput.detected_columns
        : sourceData.detected_columns?.length
          ? sourceData.detected_columns
          : ["id", "value"];

      return {
        resolvedArtifacts: [
          { ...sourceData, role: "source_data", visibility: "public" as const },
          {
            ...referenceOutput,
            role: "reference_output",
            visibility: "public" as const,
          },
        ],
        evaluationBundle: referenceOutput.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns,
          idColumn: requiredColumns[0],
        }),
      };
    }
    case "tabular_regression":
    case "tabular_classification": {
      ensureArtifactCount(artifacts, 3, input.runtimeFamily);
      const trainingData = pick(/(?:train|training)/i) ?? pickFallback();
      const hiddenLabels =
        pick(/(?:hidden|label|labels|target|truth|answer|ground)/i) ??
        pickFallback();
      const evaluationFeatures =
        pick(/(?:test|eval|feature|features|input|inputs|holdout|scoring)/i) ??
        pickFallback();

      if (!trainingData || !hiddenLabels || !evaluationFeatures) {
        throw new AgoraError(
          "Agora could not confidently map the uploaded files to training data, evaluation features, and hidden labels. Next step: rename the files to make their roles obvious or use Expert Mode.",
          {
            code: "MANAGED_ARTIFACTS_AMBIGUOUS",
            status: 422,
            details: { runtimeFamily: input.runtimeFamily },
          },
        );
      }

      const idColumn = inferIdColumn(evaluationFeatures);

      return {
        resolvedArtifacts: [
          {
            ...trainingData,
            role: "training_data",
            visibility: "public" as const,
          },
          {
            ...evaluationFeatures,
            role: "evaluation_features",
            visibility: "public" as const,
          },
          {
            ...hiddenLabels,
            role: "hidden_labels",
            visibility: "private" as const,
          },
        ],
        evaluationBundle: hiddenLabels.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns: [idColumn, "prediction"],
          idColumn,
          valueColumn: "prediction",
        }),
      };
    }
    case "ranking": {
      ensureArtifactCount(artifacts, 2, input.runtimeFamily);
      const rankingInputs =
        pick(/(?:input|candidate|ranking|rank|query|items)/i) ?? artifacts[0];
      if (rankingInputs) {
        usedKeys.add(
          artifactKey(rankingInputs, artifacts.indexOf(rankingInputs)),
        );
      }
      const referenceRanking =
        pick(/(?:reference|truth|gold|ranking|scores|labels)/i) ??
        pickFallback() ??
        null;

      if (!rankingInputs || !referenceRanking) {
        throw new AgoraError(
          "Agora could not map the uploaded files to ranking inputs and reference ranking. Next step: rename the files to make their roles obvious or use Expert Mode.",
          {
            code: "MANAGED_ARTIFACTS_AMBIGUOUS",
            status: 422,
            details: { runtimeFamily: input.runtimeFamily },
          },
        );
      }

      const idColumn = inferIdColumn(rankingInputs);

      return {
        resolvedArtifacts: [
          {
            ...rankingInputs,
            role: "ranking_inputs",
            visibility: "public" as const,
          },
          {
            ...referenceRanking,
            role: "reference_ranking",
            visibility: "private" as const,
          },
        ],
        evaluationBundle: referenceRanking.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns: [idColumn, "score"],
          idColumn,
          valueColumn: "score",
        }),
      };
    }
    case "docking": {
      ensureArtifactCount(artifacts, 3, input.runtimeFamily);
      const targetStructure =
        pick(/(?:target|protein|structure|pdb|receptor|pocket)/i) ??
        pickFallback();
      const ligandLibrary =
        pick(/(?:ligand|library|set|candidate|smiles|molecule)/i) ??
        pickFallback();
      const referenceScores =
        pick(/(?:reference|truth|score|scores|label|labels|gold)/i) ??
        pickFallback();

      if (!targetStructure || !ligandLibrary || !referenceScores) {
        throw new AgoraError(
          "Agora could not confidently map the uploaded files to the target structure, ligand set, and hidden reference scores. Next step: rename the files to make their roles obvious or use Expert Mode.",
          {
            code: "MANAGED_ARTIFACTS_AMBIGUOUS",
            status: 422,
            details: { runtimeFamily: input.runtimeFamily },
          },
        );
      }

      return {
        resolvedArtifacts: [
          {
            ...targetStructure,
            role: "target_structure",
            visibility: "public" as const,
          },
          {
            ...ligandLibrary,
            role: "ligand_library",
            visibility: "public" as const,
          },
          {
            ...referenceScores,
            role: "reference_scores",
            visibility: "private" as const,
          },
        ],
        evaluationBundle: referenceScores.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns: ["ligand_id", "docking_score"],
          idColumn: "ligand_id",
          valueColumn: "docking_score",
        }),
      };
    }
  }
}

function assignArtifactsFromProposal(input: {
  runtimeFamily: SupportedRuntimeFamily;
  uploadedArtifacts: AuthoringArtifactOutput[];
  artifactAssignments?: CompilerArtifactAssignment[];
}) {
  const family = lookupManagedRuntimeFamily(input.runtimeFamily);
  const assignments = input.artifactAssignments ?? [];
  if (!family || assignments.length === 0) {
    return null;
  }

  const roleToAssignment = new Map<string, CompilerArtifactAssignment>();
  const usedIndexes = new Set<number>();
  for (const assignment of assignments) {
    if (usedIndexes.has(assignment.artifactIndex)) {
      throw new AgoraError(
        "Managed authoring compiler assigned the same uploaded file to multiple roles. Next step: retry the compile request or use Expert Mode.",
        {
          code: "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID",
          status: 422,
          details: { runtimeFamily: input.runtimeFamily },
        },
      );
    }
    if (roleToAssignment.has(assignment.role)) {
      throw new AgoraError(
        "Managed authoring compiler returned duplicate artifact roles. Next step: retry the compile request or use Expert Mode.",
        {
          code: "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID",
          status: 422,
          details: { runtimeFamily: input.runtimeFamily },
        },
      );
    }
    usedIndexes.add(assignment.artifactIndex);
    roleToAssignment.set(assignment.role, assignment);
  }

  const missingRoles = family.supportedArtifactRoles.filter(
    (role) => !roleToAssignment.has(role),
  );
  if (missingRoles.length > 0) {
    throw new AgoraError(
      `Managed authoring compiler could not assign all required artifact roles (${missingRoles.join(", ")}). Next step: rename the uploaded files to clarify their roles or use Expert Mode.`,
      {
        code: "MANAGED_ARTIFACTS_AMBIGUOUS",
        status: 422,
        details: { runtimeFamily: input.runtimeFamily, missingRoles },
      },
    );
  }

  const resolvedArtifacts = family.supportedArtifactRoles.map((role) => {
    const assignment = roleToAssignment.get(role);
    const artifact =
      assignment && input.uploadedArtifacts[assignment.artifactIndex];
    if (!artifact) {
      throw new AgoraError(
        `Managed authoring compiler referenced a missing artifact for role ${role}. Next step: retry the compile request or use Expert Mode.`,
        {
          code: "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID",
          status: 422,
          details: { runtimeFamily: input.runtimeFamily, role },
        },
      );
    }
    return {
      ...artifact,
      role,
      visibility: assignment?.visibility ?? defaultVisibilityForRole(role),
    };
  });

  switch (input.runtimeFamily) {
    case "reproducibility": {
      const sourceData = resolvedArtifacts.find(
        (artifact) => artifact.role === "source_data",
      );
      const referenceOutput = resolvedArtifacts.find(
        (artifact) => artifact.role === "reference_output",
      );
      const requiredColumns = referenceOutput?.detected_columns?.length
        ? referenceOutput.detected_columns
        : sourceData?.detected_columns?.length
          ? sourceData.detected_columns
          : ["id", "value"];
      return {
        resolvedArtifacts,
        evaluationBundle: referenceOutput?.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns,
          idColumn: requiredColumns[0],
        }),
      };
    }
    case "tabular_regression":
    case "tabular_classification": {
      const evaluationFeatures = resolvedArtifacts.find(
        (artifact) => artifact.role === "evaluation_features",
      );
      const hiddenLabels = resolvedArtifacts.find(
        (artifact) => artifact.role === "hidden_labels",
      );
      const idColumn = inferIdColumn(evaluationFeatures);
      return {
        resolvedArtifacts,
        evaluationBundle: hiddenLabels?.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns: [idColumn, "prediction"],
          idColumn,
          valueColumn: "prediction",
        }),
      };
    }
    case "ranking": {
      const rankingInputs = resolvedArtifacts.find(
        (artifact) => artifact.role === "ranking_inputs",
      );
      const referenceRanking = resolvedArtifacts.find(
        (artifact) => artifact.role === "reference_ranking",
      );
      const idColumn = inferIdColumn(rankingInputs);
      return {
        resolvedArtifacts,
        evaluationBundle: referenceRanking?.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns: [idColumn, "score"],
          idColumn,
          valueColumn: "score",
        }),
      };
    }
    case "docking": {
      const referenceScores = resolvedArtifacts.find(
        (artifact) => artifact.role === "reference_scores",
      );
      return {
        resolvedArtifacts,
        evaluationBundle: referenceScores?.uri,
        submissionContract: createCsvTableSubmissionContract({
          requiredColumns: ["ligand_id", "docking_score"],
          idColumn: "ligand_id",
          valueColumn: "docking_score",
        }),
      };
    }
  }
}

function buildRewardSummary(input: {
  rewardTotal: string;
  distribution: ChallengeIntentOutput["distribution"];
}) {
  const total = Number(input.rewardTotal);
  const net = total - total * (PROTOCOL_FEE_PERCENT / 100);

  if (!Number.isFinite(total) || total <= 0) {
    return "Reward will be funded in USDC at publish time.";
  }

  if (input.distribution === "top_3") {
    return `Top 3 split ${formatUsdc(net * 0.6)} / ${formatUsdc(net * 0.25)} / ${formatUsdc(net * 0.15)} USDC after the ${PROTOCOL_FEE_PERCENT}% protocol fee.`;
  }
  if (input.distribution === "proportional") {
    return `Payouts are distributed proportionally from ${formatUsdc(net)} USDC after the ${PROTOCOL_FEE_PERCENT}% protocol fee.`;
  }
  return `Winner takes ${formatUsdc(net)} USDC after the ${PROTOCOL_FEE_PERCENT}% protocol fee.`;
}

function buildConfirmationContract(input: {
  runtimeFamily: SupportedRuntimeFamily;
  metric: string;
  challengeSpec: ChallengeSpecOutput;
  submissionContract: CompilationResultOutput["submission_contract"];
  dryRun: DryRunPreviewOutput;
}): ConfirmationContractOutput {
  const runtimeFamily = lookupManagedRuntimeFamily(input.runtimeFamily);
  const metric = getManagedRuntimeMetric(input.runtimeFamily, input.metric);
  const submissionColumns =
    input.submissionContract.kind === "csv_table"
      ? input.submissionContract.columns.required.join(", ")
      : "the required file contract";
  const normalizationNote =
    metric?.direction === "lower"
      ? " Agora normalizes lower-is-better raw metrics into a higher-is-better payout score for ranking and settlement."
      : "";

  return {
    solver_submission:
      input.submissionContract.kind === "csv_table"
        ? `Solvers upload a CSV with columns: ${submissionColumns}.`
        : "Solvers upload the required result artifact.",
    scoring_summary: `Agora will score submissions with ${metric?.label ?? input.metric} (${metric?.direction === "lower" ? "lower is better" : "higher is better"}) using the ${runtimeFamily?.displayName ?? input.runtimeFamily} runtime family.${normalizationNote}${input.challengeSpec.minimum_score !== undefined ? ` Submissions below ${input.challengeSpec.minimum_score} are ineligible for payout.` : ""}`,
    public_private_summary: input.challengeSpec.artifacts.map((artifact) => {
      const accessLabel =
        artifact.visibility === "private"
          ? "hidden for evaluation"
          : "visible to solvers";
      return `${artifact.file_name ?? artifact.role}: ${accessLabel}`;
    }),
    reward_summary: buildRewardSummary({
      rewardTotal: input.challengeSpec.reward.total,
      distribution: input.challengeSpec.reward.distribution,
    }),
    deadline_summary: formatDeadline(
      input.challengeSpec.deadline,
      input.challengeSpec.tags
        ?.find((tag) => tag.startsWith("tz:"))
        ?.slice(3) ?? "UTC",
    ),
    dry_run_summary: input.dryRun.summary,
  };
}

async function compileManagedAuthoringDraft(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
  } = {},
): Promise<DraftCompilation> {
  if (input.uploadedArtifacts.length === 0) {
    throw new AgoraError(
      "Managed authoring requires at least one uploaded file. Next step: attach your dataset or reference outputs and retry.",
      {
        code: "MANAGED_ARTIFACTS_MISSING",
        status: 422,
      },
    );
  }

  const proposal = await compileManagedAuthoringProposal({
    intent: input.intent,
    uploadedArtifacts: input.uploadedArtifacts,
    fetchImpl: dependencies.fetchImpl,
  });

  const assigned = assignArtifactsFromProposal({
    runtimeFamily: proposal.runtimeFamily,
    uploadedArtifacts: input.uploadedArtifacts,
    artifactAssignments: proposal.artifactAssignments,
  });
  if (!assigned) {
    throw new AgoraError(
      "Agora could not assign the uploaded files to the required Gems scorer roles. Next step: rename the files to make their roles obvious and resubmit.",
      {
        code: "MANAGED_ARTIFACTS_AMBIGUOUS",
        status: 422,
        details: { runtimeFamily: proposal.runtimeFamily },
      },
    );
  }

  const runtimeFamily = lookupManagedRuntimeFamily(proposal.runtimeFamily);
  if (!runtimeFamily) {
    throw new AgoraError(
      `Unknown runtime family ${proposal.runtimeFamily}. Next step: choose a supported managed runtime and retry.`,
      {
        code: "MANAGED_RUNTIME_UNKNOWN",
        status: 500,
      },
    );
  }

  const payoutThreshold = parsePayoutThreshold(
    proposal.runtimeFamily,
    proposal.metric,
    `${input.intent.description} ${input.intent.payout_condition}`,
  );
  if (payoutThreshold?.operator === "lte") {
    throw new AgoraError(
      "Managed authoring can score lower-is-better metrics like RMSE and MAE, but payout thresholds for them are not modeled yet. Next step: remove the explicit threshold and let submissions rank by score, or use Expert Mode.",
      {
        code: "MANAGED_THRESHOLD_UNSUPPORTED",
        status: 422,
        details: {
          runtimeFamily: proposal.runtimeFamily,
          metric: proposal.metric,
        },
      },
    );
  }
  const minimumScore =
    payoutThreshold?.operator === "gte" ? payoutThreshold.value : undefined;
  const challengeType = getChallengeCompatibilityType({
    runtimeFamily: proposal.runtimeFamily,
  });
  const apiRuntime = readApiServerRuntimeConfig();

  const draftSpec = {
    schema_version: 3 as const,
    id: `draft-${Date.now()}`,
    title: input.intent.title,
    description: input.intent.description,
    domain: input.intent.domain as ChallengeSpecOutput["domain"],
    type: challengeType,
    evaluation: {
      runtime_family: proposal.runtimeFamily,
      metric: proposal.metric,
      scorer_image: runtimeFamily.scorerImage,
      evaluation_bundle: assigned.evaluationBundle,
    },
    artifacts: assigned.resolvedArtifacts,
    submission_contract: assigned.submissionContract,
    reward: {
      total: input.intent.reward_total,
      distribution: input.intent.distribution,
    },
    deadline: input.intent.deadline,
    ...(typeof input.intent.dispute_window_hours === "number"
      ? { dispute_window_hours: input.intent.dispute_window_hours }
      : {}),
    tags: [...input.intent.tags, `tz:${input.intent.timezone}`],
    ...(minimumScore !== undefined ? { minimum_score: minimumScore } : {}),
  };

  const parsedSpec = challengeSpecSchemaForChain(apiRuntime.chainId).parse(
    draftSpec,
  );
  const canonicalSpec = await canonicalizeChallengeSpec(parsedSpec);
  const managedRuntime = readManagedAuthoringRuntimeConfig();
  const dryRun = await executeManagedAuthoringDryRun(
    {
      challengeSpec: canonicalSpec,
      timeoutMs: managedRuntime.dryRunTimeoutMs,
    },
    {
      executeScoringPipelineImpl: dependencies.executeScoringPipelineImpl,
      getTextImpl: dependencies.getTextImpl,
    },
  );

  const confirmationContract = buildConfirmationContract({
    runtimeFamily: proposal.runtimeFamily,
    metric: proposal.metric,
    challengeSpec: canonicalSpec,
    submissionContract: assigned.submissionContract,
    dryRun,
  });

  return {
    proposal,
    compilation: {
      challenge_type: challengeType,
      runtime_family: proposal.runtimeFamily,
      metric: proposal.metric,
      resolved_artifacts: canonicalSpec.artifacts,
      submission_contract: canonicalSpec.submission_contract,
      dry_run: dryRun,
      reason_codes: proposal.reasonCodes,
      warnings: proposal.warnings,
      confirmation_contract: confirmationContract,
      challenge_spec: canonicalSpec,
    },
  };
}

export async function compileManagedAuthoringSession(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
  } = {},
): Promise<CompilationResultOutput> {
  const result = await compileManagedAuthoringDraft(input, dependencies);
  return result.compilation;
}

export async function compileManagedAuthoringDraftOutcome(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
  } = {},
): Promise<ManagedAuthoringDraftOutcome> {
  try {
    const result = await compileManagedAuthoringDraft(input, dependencies);

    const authoringIr = buildManagedAuthoringIr({
      intent: input.intent,
      uploadedArtifacts: input.uploadedArtifacts,
      origin: { provider: "direct" },
      runtimeFamily: result.proposal.runtimeFamily,
      metric: result.proposal.metric,
      artifactAssignments: result.proposal.artifactAssignments,
      resolvedAssumptions: result.proposal.reasonCodes,
    });
    return {
      state: "ready",
      compilation: result.compilation,
      authoringIr,
      message:
        "Agora mapped your files, chose a supported Gems runtime, and prepared a publishable challenge contract.",
    };
  } catch (error) {
    if (
      error instanceof AgoraError &&
      CLARIFICATION_ERROR_CODES.has(error.code)
    ) {
      const authoringIr = buildManagedAuthoringIr({
        intent: input.intent,
        uploadedArtifacts: input.uploadedArtifacts,
        origin: { provider: "direct" },
        runtimeFamily:
          typeof error.details?.runtimeFamily === "string"
            ? (error.details.runtimeFamily as SupportedRuntimeFamily)
            : undefined,
        metric:
          typeof error.details?.metric === "string"
            ? error.details.metric
            : null,
        clarificationQuestions: Array.isArray(error.details?.questions)
          ? (error.details.questions as ClarificationQuestionOutput[])
          : undefined,
        compileError: {
          code: error.code,
          message: error.message,
        },
      });
      return {
        state: "needs_clarification",
        authoringIr,
        clarificationQuestions:
          buildClarificationQuestionsFromAuthoringIr(authoringIr),
        message:
          error.message ||
          "Agora needs a little more context before it can lock the challenge contract.",
      };
    }

    if (error instanceof AgoraError && error.code === "MANAGED_COMPILER_UNSUPPORTED") {
      const authoringIr = buildManagedAuthoringIr({
        intent: input.intent,
        uploadedArtifacts: input.uploadedArtifacts,
        origin: { provider: "direct" },
        rejectionReasons: Array.isArray(error.details?.reasonCodes)
          ? (error.details.reasonCodes as string[])
          : [],
        compileError: {
          code: error.code,
          message: error.message,
        },
      });
      return {
        state: "failed",
        authoringIr,
        message: error.message,
      };
    }
    throw error;
  }
}
