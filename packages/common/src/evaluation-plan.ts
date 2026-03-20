import { z } from "zod";
import {
  DEFAULT_SCORER_MOUNT,
  type ScoringMountConfig,
  resolveManagedScorerImage,
  resolveRuntimeFamilyLimits,
  resolveRuntimeFamilyMount,
  resolveRuntimeFamilyRuntimeDefaults,
} from "./runtime-families.js";
import type {
  ChallengeArtifact,
  ChallengeEvaluation,
  ChallengeEvaluationBackendKind,
} from "./types/challenge.js";
import {
  generatedScorerProgramSchema,
  resolveGeneratedScorerImage,
} from "./generated-scorers.js";
import {
  definitionBackedEvaluatorContractSchema,
  resolveDefinitionBackedExecutionOfficialImage,
  resolveDefinitionBackedExecutionPlan,
  type DefinitionBackedEvaluatorContractOutput,
} from "./schemas/evaluator-contract.js";
import {
  csvTableEvaluationContractSchema,
  scorerRuntimePoliciesSchema,
} from "./schemas/scorer-runtime.js";
import {
  submissionContractSchema,
  type SubmissionContractOutput,
} from "./schemas/submission-contract.js";

const scoringMountConfigSchema = z.object({
  evaluationBundleName: z.string().trim().min(1).optional(),
  submissionFileName: z.string().trim().min(1),
});

const runnerLimitsSchema = z.object({
  memory: z.string().trim().min(1),
  cpus: z.string().trim().min(1),
  pids: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
});

export const evaluationBackendKindSchema = z.enum([
  "preset_interpreter",
  "definition_only",
  "generated_scorer",
  "oci_image",
]);

export const evaluationPlanSchema = z.object({
  version: z.literal("v2"),
  presetId: z.string().trim().min(1),
  backendKind: evaluationBackendKindSchema,
  executionRuntimeFamily: z.string().trim().min(1).optional(),
  image: z.string().trim().min(1).optional(),
  metric: z.string().trim().min(1),
  evaluationBundleCid: z.string().trim().min(1).optional(),
  mount: scoringMountConfigSchema,
  submissionContract: submissionContractSchema.optional(),
  evaluationContract: csvTableEvaluationContractSchema.optional(),
  policies: scorerRuntimePoliciesSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
  limits: runnerLimitsSchema.optional(),
  evaluatorContract: definitionBackedEvaluatorContractSchema.optional(),
  generatedScorer: generatedScorerProgramSchema.optional(),
  executionTemplate: z.string().trim().min(1).optional(),
  evaluationArtifactRole: z.string().trim().min(1).optional(),
});

export type EvaluationBackendKind = z.output<typeof evaluationBackendKindSchema>;
export type EvaluationPlan = z.output<typeof evaluationPlanSchema>;

export interface ChallengeEvalRow {
  evaluation_plan_json?: EvaluationPlan | null;
  artifacts_json?: ChallengeArtifact[] | null;
  submission_contract_json?: SubmissionContractOutput | null;
}

interface ChallengeSpecPlanSource {
  evaluation: ChallengeEvaluation;
  artifacts: ChallengeArtifact[];
  submission_contract?: SubmissionContractOutput | null;
}

function resolveExecutionRuntimeFamily(input: {
  evaluation: ChallengeEvaluation;
  definitionBackedExecution: ReturnType<
    typeof resolveDefinitionBackedExecutionPlan
  >;
}): string | undefined {
  const explicitRuntimeFamily =
    input.evaluation.execution_runtime_family?.trim() || undefined;
  if (explicitRuntimeFamily) {
    return explicitRuntimeFamily;
  }
  if (input.evaluation.backend_kind === "preset_interpreter") {
    return (
      input.definitionBackedExecution?.runner_runtime_family ??
      input.evaluation.preset_id
    );
  }
  if (input.evaluation.backend_kind === "generated_scorer") {
    return undefined;
  }
  return undefined;
}

function resolveEvaluationBundleCid(input: {
  evaluation: Pick<ChallengeEvaluation, "evaluation_bundle">;
  artifacts?: ChallengeArtifact[] | null;
  definitionBackedExecution: ReturnType<
    typeof resolveDefinitionBackedExecutionPlan
  >;
}): string | undefined {
  if (input.definitionBackedExecution) {
    return input.artifacts?.find(
      (artifact) =>
        artifact.role ===
        input.definitionBackedExecution?.evaluation_artifact_role,
    )?.uri;
  }
  return input.evaluation.evaluation_bundle ?? undefined;
}

function resolveEvaluationImage(input: {
  evaluation: Pick<
    ChallengeEvaluation,
    "backend_kind" | "scorer_image" | "preset_id"
  >;
  executionRuntimeFamily?: string;
  definitionBackedExecution: ReturnType<
    typeof resolveDefinitionBackedExecutionPlan
  >;
}): string | undefined {
  if (input.evaluation.backend_kind === "oci_image") {
    return input.evaluation.scorer_image?.trim() || undefined;
  }
  if (input.evaluation.backend_kind === "generated_scorer") {
    return input.evaluation.scorer_image?.trim() || resolveGeneratedScorerImage();
  }
  if (input.evaluation.backend_kind === "definition_only") {
    return undefined;
  }
  if (input.definitionBackedExecution) {
    const scorerImage = input.evaluation.scorer_image?.trim();
    if (scorerImage) {
      return scorerImage;
    }
    return resolveDefinitionBackedExecutionOfficialImage(
      input.definitionBackedExecution.template,
    );
  }
  return (
    resolveManagedScorerImage(
      input.executionRuntimeFamily ?? input.evaluation.preset_id,
    ) ??
    input.evaluation.scorer_image?.trim() ??
    undefined
  );
}

function resolveDefaultMount(executionRuntimeFamily?: string): ScoringMountConfig {
  if (!executionRuntimeFamily) {
    return DEFAULT_SCORER_MOUNT;
  }
  return resolveRuntimeFamilyMount(executionRuntimeFamily);
}

function buildEvaluationPlan(input: {
  evaluation: ChallengeEvaluation;
  artifacts?: ChallengeArtifact[] | null;
  submissionContract?: SubmissionContractOutput | null;
  env?: Record<string, string> | null;
}): EvaluationPlan {
  const evaluatorContract = input.evaluation.evaluator_contract ?? undefined;
  const definitionBackedExecution =
    resolveDefinitionBackedExecutionPlan(evaluatorContract);
  const generatedScorer = input.evaluation.generated_scorer ?? undefined;
  const executionRuntimeFamily = resolveExecutionRuntimeFamily({
    evaluation: input.evaluation,
    definitionBackedExecution,
  });
  const resolvedRuntimeFamily =
    input.evaluation.backend_kind === "generated_scorer"
      ? input.evaluation.execution_runtime_family?.trim() ||
        generatedScorer?.runtime_family ||
        undefined
      : executionRuntimeFamily;
  const runtimeDefaults = resolvedRuntimeFamily
    ? resolveRuntimeFamilyRuntimeDefaults(resolvedRuntimeFamily)
    : null;
  const limits = resolvedRuntimeFamily
    ? (resolveRuntimeFamilyLimits(resolvedRuntimeFamily) ?? undefined)
    : undefined;

  return evaluationPlanSchema.parse({
    version: "v2",
    presetId: input.evaluation.preset_id,
    backendKind: input.evaluation.backend_kind,
    executionRuntimeFamily: resolvedRuntimeFamily,
    image: resolveEvaluationImage({
      evaluation: input.evaluation,
      executionRuntimeFamily: resolvedRuntimeFamily,
      definitionBackedExecution,
    }),
    metric: input.evaluation.metric,
    evaluationBundleCid:
      input.evaluation.backend_kind === "generated_scorer"
        ? input.artifacts?.find(
            (artifact) =>
              artifact.role === generatedScorer?.evaluation_artifact_role,
          )?.uri
        : resolveEvaluationBundleCid({
            evaluation: input.evaluation,
            artifacts: input.artifacts,
            definitionBackedExecution,
          }),
    mount:
      input.evaluation.backend_kind === "generated_scorer"
        ? {
            ...(generatedScorer?.mount.evaluation_bundle_name
              ? {
                  evaluationBundleName:
                    generatedScorer.mount.evaluation_bundle_name,
                }
              : {}),
            submissionFileName:
              generatedScorer?.mount.submission_file_name ??
              DEFAULT_SCORER_MOUNT.submissionFileName,
          }
        : definitionBackedExecution?.mount ??
          resolveDefaultMount(resolvedRuntimeFamily),
    submissionContract: input.submissionContract ?? undefined,
    evaluationContract:
      input.evaluation.backend_kind === "generated_scorer"
        ? generatedScorer?.evaluation_contract
        : (definitionBackedExecution?.evaluation_contract ??
          runtimeDefaults?.evaluationContract),
    policies:
      input.evaluation.backend_kind === "generated_scorer"
        ? generatedScorer?.policies
        : definitionBackedExecution?.policies ?? runtimeDefaults?.policies,
    env: input.env ?? runtimeDefaults?.env ?? undefined,
    limits,
    evaluatorContract,
    generatedScorer,
    executionTemplate: definitionBackedExecution?.template,
    evaluationArtifactRole:
      input.evaluation.backend_kind === "generated_scorer"
        ? generatedScorer?.evaluation_artifact_role
        : definitionBackedExecution?.evaluation_artifact_role,
  });
}

function resolveCachedEvaluationPlan(
  cachedPlan: unknown,
): EvaluationPlan | null {
  if (cachedPlan == null) {
    return null;
  }
  const parsed = evaluationPlanSchema.safeParse(cachedPlan);
  if (!parsed.success) {
    throw new Error(
      "Challenge is missing a valid evaluation_plan_json. Next step: rebuild the challenge projection and retry.",
    );
  }
  return parsed.data;
}

export function resolveEvaluationPlan(
  source: ChallengeSpecPlanSource | ChallengeEvalRow,
): EvaluationPlan {
  if ("evaluation" in source) {
    return buildEvaluationPlan({
      evaluation: source.evaluation,
      artifacts: source.artifacts,
      submissionContract: source.submission_contract ?? undefined,
    });
  }

  const cachedPlan = resolveCachedEvaluationPlan(source.evaluation_plan_json);
  if (cachedPlan) {
    return cachedPlan;
  }

  throw new Error(
    "Challenge is missing a valid evaluation_plan_json. Next step: rebuild the challenge projection and retry.",
  );
}

export function toLegacyResolvedChallengeEvaluation(
  plan: EvaluationPlan,
): {
  executionRuntimeFamily?: string;
  image: string;
  metric: string;
  evaluationBundleCid?: string;
  evaluatorContract?: DefinitionBackedEvaluatorContractOutput;
  definitionBackedExecution?: ReturnType<
    typeof resolveDefinitionBackedExecutionPlan
  >;
  generatedScorer?: z.output<typeof generatedScorerProgramSchema>;
  mount: ScoringMountConfig;
} {
  return {
    executionRuntimeFamily: plan.executionRuntimeFamily,
    image: plan.image ?? "",
    metric: plan.metric,
    ...(plan.evaluationBundleCid
      ? { evaluationBundleCid: plan.evaluationBundleCid }
      : {}),
    ...(plan.evaluatorContract
      ? { evaluatorContract: plan.evaluatorContract }
      : {}),
    ...(plan.evaluatorContract
      ? {
          definitionBackedExecution: resolveDefinitionBackedExecutionPlan(
            plan.evaluatorContract,
          ) ?? undefined,
        }
      : {}),
    ...(plan.generatedScorer
      ? { generatedScorer: plan.generatedScorer }
      : {}),
    mount: plan.mount,
  };
}

export function isCustomImageEvaluationBackend(
  backendKind: ChallengeEvaluationBackendKind | EvaluationBackendKind,
): boolean {
  return backendKind === "oci_image";
}
