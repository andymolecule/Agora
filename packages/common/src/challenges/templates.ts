import {
  EXPERT_RUNTIME_FAMILY_ID,
  SEMI_CUSTOM_RUNTIME_FAMILY_ID,
  resolveManagedScorerImage,
} from "../runtime-families.js";
import type { SemiCustomEvaluatorContractOutput } from "../schemas/evaluator-contract.js";
import {
  type SubmissionContractOutput,
  createCsvTableSubmissionContract,
  createOpaqueFileSubmissionContract,
} from "../schemas/submission-contract.js";
import type {
  ChallengeArtifact,
  ChallengeDomain,
  ChallengeEvaluation,
  ChallengeSpec,
  ChallengeType,
} from "../types/challenge.js";

export interface ChallengeTypeTemplate {
  type: ChallengeType;
  label: string;
  description: string;
  defaultDomain: ChallengeDomain;
  defaultMetric: string;
  defaultRuntimeFamily: string;
  defaultScorerImage: string;
  defaultMinimumScore: number;
}

const TYPE_TEMPLATE_REGISTRY: Record<ChallengeType, ChallengeTypeTemplate> = {
  prediction: {
    type: "prediction",
    label: "Prediction",
    description:
      "Solvers predict held-out outcomes from a labeled training dataset.",
    defaultDomain: "omics",
    defaultMetric: "r2",
    defaultRuntimeFamily: "tabular_regression",
    defaultScorerImage: resolveManagedScorerImage("tabular_regression") ?? "",
    defaultMinimumScore: 0,
  },
  reproducibility: {
    type: "reproducibility",
    label: "Reproducibility",
    description:
      "Solvers reproduce a posted reference artifact from shared source data.",
    defaultDomain: "other",
    defaultMetric: "exact_match",
    defaultRuntimeFamily: "reproducibility",
    defaultScorerImage: resolveManagedScorerImage("reproducibility") ?? "",
    defaultMinimumScore: 0,
  },
  docking: {
    type: "docking",
    label: "Docking",
    description: "Solvers rank candidates against a target-specific benchmark.",
    defaultDomain: "drug_discovery",
    defaultMetric: "spearman",
    defaultRuntimeFamily: "docking",
    defaultScorerImage: resolveManagedScorerImage("docking") ?? "",
    defaultMinimumScore: 0,
  },
  optimization: {
    type: "optimization",
    label: "Optimization",
    description: "Solvers search a space while Agora scores the result.",
    defaultDomain: "drug_discovery",
    defaultMetric: "custom",
    defaultRuntimeFamily: EXPERT_RUNTIME_FAMILY_ID,
    defaultScorerImage: "",
    defaultMinimumScore: 0,
  },
  red_team: {
    type: "red_team",
    label: "Red Team",
    description:
      "Solvers submit adversarial inputs against a target model or claim.",
    defaultDomain: "other",
    defaultMetric: "custom",
    defaultRuntimeFamily: EXPERT_RUNTIME_FAMILY_ID,
    defaultScorerImage: "",
    defaultMinimumScore: 0,
  },
  custom: {
    type: "custom",
    label: "Custom",
    description: "Bring your own scorer image, rules, and artifact contract.",
    defaultDomain: "other",
    defaultMetric: "custom",
    defaultRuntimeFamily: EXPERT_RUNTIME_FAMILY_ID,
    defaultScorerImage: "",
    defaultMinimumScore: 0,
  },
};

export function getChallengeTypeTemplate(
  challengeType: ChallengeType,
): ChallengeTypeTemplate {
  return TYPE_TEMPLATE_REGISTRY[challengeType];
}

export function defaultRuntimeFamilyForChallengeType(
  challengeType: ChallengeType,
): string {
  return TYPE_TEMPLATE_REGISTRY[challengeType].defaultRuntimeFamily;
}

export function defaultMinimumScoreForChallengeType(
  challengeType: ChallengeType,
): number {
  return TYPE_TEMPLATE_REGISTRY[challengeType].defaultMinimumScore;
}

export function getChallengeCompatibilityType(input: {
  runtimeFamily: string;
  evaluatorContract?: SemiCustomEvaluatorContractOutput | null;
}): ChallengeType {
  switch (input.runtimeFamily) {
    case "reproducibility":
      return "reproducibility";
    case "tabular_regression":
    case "tabular_classification":
      return "prediction";
    case "docking":
      return "docking";
    case "ranking":
      return "optimization";
    case SEMI_CUSTOM_RUNTIME_FAMILY_ID:
    case EXPERT_RUNTIME_FAMILY_ID:
      return "custom";
    default:
      return "custom";
  }
}

export function getChallengeCompatibilityTypeFromEvaluation(
  evaluation: Pick<
    ChallengeEvaluation,
    "runtime_family" | "evaluator_contract"
  >,
): ChallengeType {
  return getChallengeCompatibilityType({
    runtimeFamily: evaluation.runtime_family,
    evaluatorContract: evaluation.evaluator_contract ?? null,
  });
}

export function defaultMinimumScoreForEvaluation(
  evaluation: Pick<
    ChallengeEvaluation,
    "runtime_family" | "evaluator_contract"
  >,
): number {
  return defaultMinimumScoreForChallengeType(
    getChallengeCompatibilityTypeFromEvaluation(evaluation),
  );
}

export type ChallengeSubmissionContractDraftInput =
  | {
      type: "prediction";
      idColumn: string;
      valueColumn: string;
    }
  | {
      type: "reproducibility";
      requiredColumns: string[];
    }
  | {
      type: "docking";
    }
  | {
      type: "optimization" | "red_team" | "custom";
      extension?: string;
      mime?: string;
    };

export function buildSubmissionContractForChallengeType(
  input: ChallengeSubmissionContractDraftInput,
): SubmissionContractOutput {
  switch (input.type) {
    case "prediction":
      return createCsvTableSubmissionContract({
        requiredColumns: [input.idColumn, input.valueColumn].filter(Boolean),
        idColumn: input.idColumn || undefined,
        valueColumn: input.valueColumn || undefined,
      });
    case "reproducibility":
      return createCsvTableSubmissionContract({
        requiredColumns: input.requiredColumns,
      });
    case "docking":
      return createCsvTableSubmissionContract({
        requiredColumns: ["ligand_id", "docking_score"],
        idColumn: "ligand_id",
        valueColumn: "docking_score",
      });
    case "optimization":
    case "red_team":
    case "custom":
      return createOpaqueFileSubmissionContract({
        extension: input.extension,
        mime: input.mime,
      });
  }
}

export interface ChallengeSpecDraftInput {
  id: string;
  title: string;
  domain: ChallengeDomain;
  type: ChallengeType;
  description: string;
  artifacts: ChallengeArtifact[];
  runtimeFamily?: string;
  scorerImage?: string;
  metric?: string;
  reward: {
    total: string;
    distribution: ChallengeSpec["reward"]["distribution"];
  };
  deadline: string;
  submission: ChallengeSubmissionContractDraftInput;
  minimumScore?: number;
  disputeWindowHours?: number;
  tags?: string[];
  labTba?: string;
  evaluationBundle?: string;
  evaluatorContract?: SemiCustomEvaluatorContractOutput;
}

export function buildChallengeSpecDraft(
  input: ChallengeSpecDraftInput,
): ChallengeSpec {
  const template = getChallengeTypeTemplate(input.type);
  const runtimeFamily =
    input.runtimeFamily?.trim() || template.defaultRuntimeFamily;
  const scorerImage =
    input.scorerImage?.trim() ||
    (runtimeFamily === EXPERT_RUNTIME_FAMILY_ID
      ? ""
      : runtimeFamily === SEMI_CUSTOM_RUNTIME_FAMILY_ID
        ? null
        : (resolveManagedScorerImage(runtimeFamily) ??
          template.defaultScorerImage));

  return {
    schema_version: 3,
    id: input.id,
    title: input.title,
    domain: input.domain,
    type: input.type,
    description: input.description,
    evaluation: {
      runtime_family: runtimeFamily,
      metric: input.metric?.trim() || template.defaultMetric,
      ...(scorerImage ? { scorer_image: scorerImage } : {}),
      ...(input.evaluationBundle
        ? { evaluation_bundle: input.evaluationBundle }
        : {}),
      ...(input.evaluatorContract
        ? { evaluator_contract: input.evaluatorContract }
        : {}),
    },
    artifacts: input.artifacts,
    submission_contract: buildSubmissionContractForChallengeType(
      input.submission,
    ),
    reward: {
      total: input.reward.total,
      distribution: input.reward.distribution,
    },
    deadline: input.deadline,
    ...(typeof input.minimumScore === "number"
      ? { minimum_score: input.minimumScore }
      : {}),
    ...(typeof input.disputeWindowHours === "number"
      ? { dispute_window_hours: input.disputeWindowHours }
      : {}),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(input.labTba ? { lab_tba: input.labTba } : {}),
  };
}
