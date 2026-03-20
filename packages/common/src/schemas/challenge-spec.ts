import yaml from "yaml";
import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import { getDisputeWindowMinHours } from "../dispute-policy.js";
import {
  type ChallengeEvalRow,
  type EvaluationPlan,
  evaluationBackendKindSchema,
  resolveEvaluationPlan,
  toLegacyResolvedChallengeEvaluation,
} from "../evaluation-plan.js";
import {
  generatedScorerProgramSchema,
  resolveGeneratedScorerImage,
} from "../generated-scorers.js";
import {
  isManagedRuntimeFamily,
  isOfficialScorerImage,
  resolveManagedScorerImage,
  resolveOfficialImageToDigest,
  resolveRuntimeFamilyLimits,
  resolveRuntimeFamilyRuntimeDefaults,
  validateExpertScorerImage,
  validateRuntimeMetric,
  validateScorerImage,
} from "../runtime-families.js";
import {
  CHALLENGE_ARTIFACT_VISIBILITIES,
  CHALLENGE_DOMAINS,
  CHALLENGE_TYPES,
  type ChallengeArtifact,
  type ChallengeSpec,
} from "../types/challenge.js";
import {
  externalSourceProviderSchema,
  safePublicHttpsUrlSchema,
} from "./authoring-source.js";
import {
  definitionBackedEvaluatorContractSchema,
  resolveDefinitionBackedExecutionOfficialImage,
  resolveDefinitionBackedExecutionPlan,
} from "./evaluator-contract.js";
import { submissionContractSchema } from "./submission-contract.js";

const domainEnum = z.enum(CHALLENGE_DOMAINS);
const typeEnum = z.enum(CHALLENGE_TYPES);
const artifactVisibilityEnum = z.enum(CHALLENGE_ARTIFACT_VISIBILITIES);
const rewardDistributionEnum = z.enum([
  "winner_take_all",
  "top_3",
  "proportional",
]);

const ipfsOrHttpsUriSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => value.startsWith("ipfs://") || value.startsWith("https://"),
    "value must start with ipfs:// or https://",
  );

const decimalStringPattern = /^\d+(?:\.\d{1,6})?$/;

function validatePresetInterpreterProvidedImage(image: string): string | null {
  const imageError = validateScorerImage(image);
  if (imageError) {
    return imageError;
  }
  if (!isOfficialScorerImage(image)) {
    return "Preset-interpreter challenges must use an official Agora scorer image.";
  }
  return null;
}

function validateGeneratedScorerProvidedImage(image: string): string | null {
  const imageError = validateScorerImage(image);
  if (imageError) {
    return imageError;
  }
  const generatedScorerImage = resolveGeneratedScorerImage();
  const expectedRepository = generatedScorerImage.split("@")[0]?.split(":")[0];
  const candidateRepository = image.trim().split("@")[0]?.split(":")[0];
  if (
    !expectedRepository ||
    !candidateRepository ||
    expectedRepository !== candidateRepository
  ) {
    return "Generated scorer challenges must use the official Agora generated scorer image.";
  }
  return null;
}

function normalizeRewardTotal(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return value;
}

const rewardTotalSchema = z
  .preprocess(normalizeRewardTotal, z.string().min(1))
  .refine(
    (value) => decimalStringPattern.test(value),
    `reward.total must be a decimal string with at most ${CHALLENGE_LIMITS.rewardDecimals} decimal places`,
  )
  .refine((value) => {
    const parsed = Number(value);
    return (
      Number.isFinite(parsed) &&
      parsed >= CHALLENGE_LIMITS.rewardMinUsdc &&
      parsed <= CHALLENGE_LIMITS.rewardMaxUsdc
    );
  }, `reward.total must be between ${CHALLENGE_LIMITS.rewardMinUsdc} and ${CHALLENGE_LIMITS.rewardMaxUsdc}`);

export const challengeArtifactSchema = z.object({
  role: z.string().trim().min(1),
  visibility: artifactVisibilityEnum,
  uri: ipfsOrHttpsUriSchema,
  file_name: z.string().trim().min(1).optional(),
  mime_type: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
});

export const challengeEvaluationSchema = z.object({
  preset_id: z.string().trim().min(1),
  backend_kind: evaluationBackendKindSchema,
  execution_runtime_family: z.string().trim().min(1).optional(),
  metric: z.string().trim().min(1),
  scorer_image: z.string().trim().min(1).optional(),
  evaluation_bundle: ipfsOrHttpsUriSchema.optional(),
  evaluator_contract: definitionBackedEvaluatorContractSchema.optional(),
  generated_scorer: generatedScorerProgramSchema.optional(),
});

export const challengeSourceSchema = z.object({
  provider: externalSourceProviderSchema,
  external_id: z.string().trim().min(1).nullable().optional(),
  external_url: safePublicHttpsUrlSchema.nullable().optional(),
  agent_handle: z.string().trim().min(1).nullable().optional(),
});

function hasDuplicateArtifacts(artifacts: ChallengeArtifact[]) {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    const key = `${artifact.role}|${artifact.visibility}|${artifact.uri}`;
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  return false;
}

function addIssue(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  message: string,
) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
  });
}

function validateDefinitionOnlyEvaluation(input: {
  value: ChallengeSpec;
  ctx: z.RefinementCtx;
}) {
  const { value, ctx } = input;
  const evaluatorContract = value.evaluation.evaluator_contract;

  if (!evaluatorContract) {
    addIssue(
      ctx,
      ["evaluation", "evaluator_contract"],
      "Definition-backed challenges require an evaluator_contract. Next step: attach the typed evaluator contract and retry.",
    );
    return;
  }

  if (value.evaluation.preset_id !== evaluatorContract.archetype) {
    addIssue(
      ctx,
      ["evaluation", "preset_id"],
      "evaluation.preset_id must match evaluator_contract.archetype.",
    );
  }

  if (value.evaluation.metric !== evaluatorContract.scoring.metric) {
    addIssue(
      ctx,
      ["evaluation", "metric"],
      "evaluation.metric must match evaluator_contract.scoring.metric.",
    );
  }

  if (value.evaluation.execution_runtime_family) {
    addIssue(
      ctx,
      ["evaluation", "execution_runtime_family"],
      "Typed-only definition-backed challenges should omit execution_runtime_family until an execution path is configured. Next step: remove execution_runtime_family or switch backend_kind to preset_interpreter.",
    );
  }

  if (value.evaluation.scorer_image) {
    addIssue(
      ctx,
      ["evaluation", "scorer_image"],
      "Typed-only definition-backed challenges should omit scorer_image until an execution path is configured. Next step: remove scorer_image or switch backend_kind to preset_interpreter.",
    );
  }

  if (value.evaluation.evaluation_bundle) {
    addIssue(
      ctx,
      ["evaluation", "evaluation_bundle"],
      "Definition-backed challenges should describe hidden inputs through evaluator_contract instead of evaluation_bundle. Next step: move evaluator requirements into evaluator_contract and retry.",
    );
  }

  if (evaluatorContract.execution) {
    addIssue(
      ctx,
      ["evaluation", "backend_kind"],
      "Definition-backed challenges with execution details must use an executable backend_kind. Next step: switch backend_kind or remove the execution template.",
    );
  }

  if (value.evaluation.generated_scorer) {
    addIssue(
      ctx,
      ["evaluation", "generated_scorer"],
      "Typed-only definition-backed challenges should omit generated_scorer until an execution path is configured. Next step: remove generated_scorer or switch backend_kind.",
    );
  }
}

function validatePresetInterpreterEvaluation(input: {
  value: ChallengeSpec;
  ctx: z.RefinementCtx;
}) {
  const { value, ctx } = input;
  const executionRuntimeFamily =
    value.evaluation.execution_runtime_family?.trim() || undefined;
  const scorerImage = value.evaluation.scorer_image;
  const evaluatorContract = value.evaluation.evaluator_contract;

  if (!executionRuntimeFamily) {
    addIssue(
      ctx,
      ["evaluation", "execution_runtime_family"],
      "Preset-interpreter challenges require execution_runtime_family. Next step: set the effective managed runtime family and retry.",
    );
    return;
  }

  if (evaluatorContract) {
    const executionPlan =
      resolveDefinitionBackedExecutionPlan(evaluatorContract);
    if (!executionPlan) {
      addIssue(
        ctx,
        ["evaluation", "evaluator_contract"],
        "Definition-backed preset-interpreter challenges require a supported execution template. Next step: attach execution details or switch backend_kind to definition_only.",
      );
      return;
    }

    if (value.evaluation.preset_id !== evaluatorContract.archetype) {
      addIssue(
        ctx,
        ["evaluation", "preset_id"],
        "evaluation.preset_id must match evaluator_contract.archetype.",
      );
    }

    if (value.evaluation.metric !== evaluatorContract.scoring.metric) {
      addIssue(
        ctx,
        ["evaluation", "metric"],
        "evaluation.metric must match evaluator_contract.scoring.metric.",
      );
    }

    if (executionRuntimeFamily !== executionPlan.runner_runtime_family) {
      addIssue(
        ctx,
        ["evaluation", "execution_runtime_family"],
        `execution_runtime_family must match the evaluator contract execution template (${executionPlan.runner_runtime_family}).`,
      );
    }

    if (value.evaluation.evaluation_bundle) {
      addIssue(
        ctx,
        ["evaluation", "evaluation_bundle"],
        "Definition-backed preset-interpreter challenges should derive hidden inputs from evaluator_contract artifact roles instead of evaluation_bundle. Next step: remove evaluation_bundle and retry.",
      );
    }

    if (scorerImage) {
      const imageError = validatePresetInterpreterProvidedImage(scorerImage);
      if (imageError) {
        addIssue(
          ctx,
          ["evaluation", "scorer_image"],
          `${imageError} Next step: use the official interpreter image for this execution template or omit scorer_image and let Agora canonicalize it.`,
        );
      }
    }

    const evaluationArtifact = value.artifacts.find(
      (artifact) => artifact.role === executionPlan.evaluation_artifact_role,
    );
    if (!evaluationArtifact) {
      addIssue(
        ctx,
        ["artifacts"],
        `Definition-backed execution requires an artifact with role ${executionPlan.evaluation_artifact_role}. Next step: add that artifact role or remove execution.`,
      );
    }
    return;
  }

  if (value.evaluation.preset_id !== executionRuntimeFamily) {
    addIssue(
      ctx,
      ["evaluation", "execution_runtime_family"],
      "Managed preset-interpreter challenges must use execution_runtime_family equal to preset_id. Next step: align the two fields and retry.",
    );
  }

  if (!isManagedRuntimeFamily(value.evaluation.preset_id)) {
    addIssue(
      ctx,
      ["evaluation", "preset_id"],
      `Unknown preset_id: ${value.evaluation.preset_id}`,
    );
    return;
  }

  const metricError = validateRuntimeMetric(
    executionRuntimeFamily,
    value.evaluation.metric,
  );
  if (metricError) {
    addIssue(ctx, ["evaluation", "metric"], metricError);
  }

  if (scorerImage) {
    const imageError = validatePresetInterpreterProvidedImage(scorerImage);
    if (imageError) {
      addIssue(
        ctx,
        ["evaluation", "scorer_image"],
        `${imageError} Next step: use the official preset interpreter image or omit scorer_image and let Agora canonicalize it.`,
      );
    }
  }

  if (!resolveRuntimeFamilyLimits(executionRuntimeFamily)) {
    addIssue(
      ctx,
      ["evaluation", "execution_runtime_family"],
      `Runtime family ${executionRuntimeFamily} is missing runner limits.`,
    );
  }

  const defaults = resolveRuntimeFamilyRuntimeDefaults(executionRuntimeFamily);
  if (
    defaults?.evaluationContract &&
    value.submission_contract.kind !== "csv_table"
  ) {
    addIssue(
      ctx,
      ["submission_contract"],
      `Runtime family ${executionRuntimeFamily} requires a csv_table submission contract.`,
    );
  }

  if (!value.evaluation.evaluation_bundle) {
    addIssue(
      ctx,
      ["evaluation", "evaluation_bundle"],
      `Preset ${value.evaluation.preset_id} requires an evaluation_bundle.`,
    );
  }
}

function validateCustomImageEvaluation(input: {
  value: ChallengeSpec;
  ctx: z.RefinementCtx;
}) {
  const { value, ctx } = input;
  const scorerImage = value.evaluation.scorer_image;
  if (value.evaluation.preset_id !== "custom") {
    addIssue(
      ctx,
      ["evaluation", "preset_id"],
      "Custom image challenges must use preset_id custom. Next step: set preset_id to custom and retry.",
    );
  }
  if (value.evaluation.evaluator_contract) {
    addIssue(
      ctx,
      ["evaluation", "evaluator_contract"],
      "Custom image challenges should not attach evaluator_contract. Next step: remove evaluator_contract or switch backend_kind.",
    );
  }
  if (value.evaluation.execution_runtime_family) {
    addIssue(
      ctx,
      ["evaluation", "execution_runtime_family"],
      "Custom image challenges should omit execution_runtime_family. Next step: remove execution_runtime_family and retry.",
    );
  }
  if (!scorerImage) {
    addIssue(
      ctx,
      ["evaluation", "scorer_image"],
      "Custom image challenges require a scorer_image. Next step: attach a pinned scorer image and retry.",
    );
    return;
  }
  const imageError = validateExpertScorerImage(scorerImage);
  if (imageError) {
    addIssue(ctx, ["evaluation", "scorer_image"], imageError);
  }
}

function validateGeneratedScorerEvaluation(input: {
  value: ChallengeSpec;
  ctx: z.RefinementCtx;
}) {
  const { value, ctx } = input;
  const evaluatorContract = value.evaluation.evaluator_contract;
  const generatedScorer = value.evaluation.generated_scorer;
  const scorerImage = value.evaluation.scorer_image;
  const executionRuntimeFamily =
    value.evaluation.execution_runtime_family?.trim() || undefined;
  const managedRuntimeFamily = isManagedRuntimeFamily(value.evaluation.preset_id)
    ? value.evaluation.preset_id
    : null;

  if (!generatedScorer) {
    addIssue(
      ctx,
      ["evaluation", "generated_scorer"],
      "Generated scorer challenges require a generated_scorer manifest. Next step: compile the generated scorer and retry.",
    );
    return;
  }

  if (evaluatorContract) {
    if (value.evaluation.preset_id !== evaluatorContract.archetype) {
      addIssue(
        ctx,
        ["evaluation", "preset_id"],
        "evaluation.preset_id must match evaluator_contract.archetype.",
      );
    }

    if (value.evaluation.metric !== evaluatorContract.scoring.metric) {
      addIssue(
        ctx,
        ["evaluation", "metric"],
        "evaluation.metric must match evaluator_contract.scoring.metric.",
      );
    }
  } else if (!managedRuntimeFamily) {
    addIssue(
      ctx,
      ["evaluation", "evaluator_contract"],
      "Generated scorer challenges must either target a supported managed preset or attach an evaluator_contract. Next step: set preset_id to a managed runtime family or include the typed evaluator contract.",
    );
    return;
  } else {
    const metricError = validateRuntimeMetric(
      managedRuntimeFamily,
      value.evaluation.metric,
    );
    if (metricError) {
      addIssue(ctx, ["evaluation", "metric"], metricError);
    }

    if (
      executionRuntimeFamily &&
      executionRuntimeFamily !== managedRuntimeFamily
    ) {
      addIssue(
        ctx,
        ["evaluation", "execution_runtime_family"],
        "Managed generated scorer challenges must use execution_runtime_family equal to preset_id. Next step: align the two fields and retry.",
      );
    }

    if (!resolveRuntimeFamilyLimits(managedRuntimeFamily)) {
      addIssue(
        ctx,
        ["evaluation", "execution_runtime_family"],
        `Runtime family ${managedRuntimeFamily} is missing runner limits.`,
      );
    }

    const defaults = resolveRuntimeFamilyRuntimeDefaults(managedRuntimeFamily);
    if (
      defaults?.evaluationContract &&
      value.submission_contract.kind !== "csv_table"
    ) {
      addIssue(
        ctx,
        ["submission_contract"],
        `Runtime family ${managedRuntimeFamily} requires a csv_table submission contract.`,
      );
    }
  }

  if (scorerImage) {
    const imageError = validateGeneratedScorerProvidedImage(scorerImage);
    if (imageError) {
      addIssue(
        ctx,
        ["evaluation", "scorer_image"],
        `${imageError} Next step: use the official generated scorer image or omit scorer_image and let Agora canonicalize it.`,
      );
    }
  }

  if (executionRuntimeFamily && generatedScorer.runtime_family) {
    if (executionRuntimeFamily !== generatedScorer.runtime_family) {
      addIssue(
        ctx,
        ["evaluation", "execution_runtime_family"],
        `execution_runtime_family must match generated_scorer.runtime_family (${generatedScorer.runtime_family}).`,
      );
    }
  }

  if (
    managedRuntimeFamily &&
    generatedScorer.runtime_family &&
    generatedScorer.runtime_family !== managedRuntimeFamily
  ) {
    addIssue(
      ctx,
      ["evaluation", "generated_scorer", "runtime_family"],
      `generated_scorer.runtime_family must match preset_id (${managedRuntimeFamily}) for managed generated scorer challenges.`,
    );
  }

  if (value.evaluation.evaluation_bundle) {
    addIssue(
      ctx,
      ["evaluation", "evaluation_bundle"],
      "Generated scorer challenges should derive hidden inputs from generated_scorer artifact roles instead of evaluation_bundle. Next step: remove evaluation_bundle and retry.",
    );
  }

  const evaluationArtifact = value.artifacts.find(
    (artifact) =>
      artifact.role === generatedScorer.evaluation_artifact_role,
  );
  if (!evaluationArtifact) {
    addIssue(
      ctx,
      ["artifacts"],
      `Generated scorer execution requires an artifact with role ${generatedScorer.evaluation_artifact_role}. Next step: add that artifact role or regenerate the scorer.`,
    );
  }
}

const _baseSpecShape = z
  .object({
    schema_version: z.literal(4),
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    domain: domainEnum,
    type: typeEnum,
    description: z.string().trim().min(1),
    evaluation: challengeEvaluationSchema,
    artifacts: z.array(challengeArtifactSchema).min(1),
    submission_contract: submissionContractSchema,
    reward: z.object({
      total: rewardTotalSchema,
      distribution: rewardDistributionEnum,
    }),
    deadline: z.string().datetime({ offset: true }),
    tags: z.array(z.string().trim().min(1)).optional(),
    minimum_score: z.number().optional(),
    max_submissions_total: z.number().int().min(1).max(10000).optional(),
    max_submissions_per_solver: z.number().int().min(1).max(1000).optional(),
    dispute_window_hours: z
      .number()
      .int()
      .min(0)
      .max(CHALLENGE_LIMITS.disputeWindowMaxHours)
      .optional(),
    lab_tba: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "lab_tba must be a valid EVM address")
      .optional(),
    source: challengeSourceSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      typeof value.max_submissions_total === "number" &&
      typeof value.max_submissions_per_solver === "number" &&
      value.max_submissions_per_solver > value.max_submissions_total
    ) {
      addIssue(
        ctx,
        ["max_submissions_per_solver"],
        "max_submissions_per_solver cannot exceed max_submissions_total",
      );
    }

    if (hasDuplicateArtifacts(value.artifacts)) {
      addIssue(
        ctx,
        ["artifacts"],
        "Duplicate artifacts are not allowed. Next step: remove duplicated role/visibility/uri entries and retry.",
      );
    }

    switch (value.evaluation.backend_kind) {
      case "definition_only":
        validateDefinitionOnlyEvaluation({
          value,
          ctx,
        });
        return;
      case "generated_scorer":
        validateGeneratedScorerEvaluation({
          value,
          ctx,
        });
        return;
      case "preset_interpreter":
        validatePresetInterpreterEvaluation({
          value,
          ctx,
        });
        return;
      case "oci_image":
        validateCustomImageEvaluation({
          value,
          ctx,
        });
        return;
    }
  });

function withDisputeMin(minHours: number) {
  if (minHours <= 0) {
    return _baseSpecShape;
  }
  return _baseSpecShape.superRefine((value, ctx) => {
    if (
      value.dispute_window_hours !== undefined &&
      value.dispute_window_hours < minHours
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: minHours,
        type: "number",
        inclusive: true,
        path: ["dispute_window_hours"],
        message: `dispute_window_hours must be >= ${minHours}h`,
      });
    }
  });
}

export const challengeSpecSchema = _baseSpecShape;
export type ChallengeSpecInput = z.input<typeof challengeSpecSchema>;
export type ChallengeSpecOutput = z.output<typeof challengeSpecSchema>;

export interface ResolvedChallengeEvaluation {
  executionRuntimeFamily?: string;
  image: string;
  metric: string;
  evaluationBundleCid?: string;
  evaluatorContract?: z.output<typeof definitionBackedEvaluatorContractSchema>;
  definitionBackedExecution?: ReturnType<
    typeof resolveDefinitionBackedExecutionPlan
  >;
  generatedScorer?: z.output<typeof generatedScorerProgramSchema>;
  mount: {
    evaluationBundleName?: string;
    submissionFileName: string;
  };
}

export function challengeSpecSchemaForChain(chainId: number) {
  return withDisputeMin(getDisputeWindowMinHours(chainId));
}

export function validateChallengeSpec(raw: unknown, chainId: number) {
  return challengeSpecSchemaForChain(chainId).safeParse(raw);
}

export function parseChallengeSpecDocument(raw: string): unknown {
  const parsed = yaml.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  const normalized = { ...(parsed as Record<string, unknown>) };
  if (normalized.deadline instanceof Date) {
    normalized.deadline = normalized.deadline.toISOString();
  }
  return normalized;
}

export async function canonicalizeChallengeSpec(
  spec: ChallengeSpecOutput,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    resolveOfficialPresetDigests?: boolean;
  } = {},
): Promise<ChallengeSpecOutput> {
  let scorerImage = spec.evaluation.scorer_image?.trim() ?? "";

  if (spec.evaluation.backend_kind === "generated_scorer") {
    scorerImage = resolveGeneratedScorerImage();
  } else if (spec.evaluation.backend_kind === "preset_interpreter") {
    if (spec.evaluation.evaluator_contract) {
      const executionPlan = resolveDefinitionBackedExecutionPlan(
        spec.evaluation.evaluator_contract,
      );
      if (!executionPlan) {
        throw new Error(
          "Definition-backed preset-interpreter challenges require a supported execution template. Next step: attach execution details or switch backend_kind.",
        );
      }
      scorerImage = resolveDefinitionBackedExecutionOfficialImage(
        executionPlan.template,
      );
    } else {
      const executionRuntimeFamily =
        spec.evaluation.execution_runtime_family?.trim() || spec.evaluation.preset_id;
      const managedImage = resolveManagedScorerImage(executionRuntimeFamily);
      if (!managedImage) {
        throw new Error(
          `Unknown runtime family ${executionRuntimeFamily}. Next step: choose a registered runtime family and retry.`,
        );
      }
      scorerImage = managedImage;
    }
  }

  if (options.resolveOfficialPresetDigests === true) {
    if (scorerImage && isOfficialScorerImage(scorerImage)) {
      scorerImage = await resolveOfficialImageToDigest(scorerImage, options);
    }
  }

  return {
    ...spec,
    evaluation: {
      ...spec.evaluation,
      ...(spec.evaluation.backend_kind === "definition_only"
        ? {}
        : scorerImage
          ? { scorer_image: scorerImage }
          : {}),
    },
  };
}

export function resolveChallengeEvaluation(
  spec: ChallengeSpecOutput | ChallengeEvalRow,
): ResolvedChallengeEvaluation {
  return toLegacyResolvedChallengeEvaluation(resolveEvaluationPlan(spec));
}

export function resolveScoringEnvironmentFromSpec(
  spec: ChallengeSpecOutput | null | undefined,
): Record<string, string> | undefined {
  if (!spec) {
    return undefined;
  }

  return resolveEvaluationPlan(spec).env;
}

export interface ChallengeScoreabilityValidation {
  ok: boolean;
  errors: string[];
}

function validateChallengeScoreabilityForPlan(
  spec: ChallengeSpecOutput,
  evaluationPlan: EvaluationPlan,
): ChallengeScoreabilityValidation {
  const errors: string[] = [];

  if (evaluationPlan.backendKind === "definition_only") {
    errors.push(
      "Definition-backed evaluator contracts are typed but not executable by the current scorer runtime yet.",
    );
    return {
      ok: false,
      errors,
    };
  }

  if (!evaluationPlan.image?.trim()) {
    errors.push("Challenge requires a scorer image.");
  }

  if (!evaluationPlan.metric.trim()) {
    errors.push("Challenge requires a metric.");
  }

  if (evaluationPlan.evaluationArtifactRole) {
    const evaluationArtifact = spec.artifacts.find(
      (artifact) => artifact.role === evaluationPlan.evaluationArtifactRole,
    );
    if (!evaluationArtifact) {
      errors.push(
        `Execution requires an artifact with role ${evaluationPlan.evaluationArtifactRole}.`,
      );
    }
  }

  if (
    evaluationPlan.backendKind !== "oci_image" &&
    !evaluationPlan.evaluationBundleCid
  ) {
    errors.push(
      `Preset ${evaluationPlan.presetId} requires a deterministic evaluation artifact.`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function validateChallengeScoreability(
  spec: ChallengeSpecOutput,
  evaluationPlan?: EvaluationPlan,
): ChallengeScoreabilityValidation {
  return validateChallengeScoreabilityForPlan(
    spec,
    evaluationPlan ?? resolveEvaluationPlan(spec),
  );
}
