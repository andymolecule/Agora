import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import { getDisputeWindowMinHours } from "../dispute-policy.js";
import {
  EXPERT_RUNTIME_FAMILY_ID,
  isManagedRuntimeFamily,
  resolveManagedScorerImage,
  resolveOfficialImageToDigest,
  resolveRuntimeFamilyLimits,
  resolveRuntimeFamilyMount,
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
  type SubmissionContractOutput,
  submissionContractSchema,
} from "./submission-contract.js";

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
  runtime_family: z.string().trim().min(1),
  metric: z.string().trim().min(1),
  scorer_image: z.string().trim().min(1),
  evaluation_bundle: ipfsOrHttpsUriSchema.optional(),
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

const _baseSpecShape = z
  .object({
    schema_version: z.literal(3),
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
  })
  .superRefine((value, ctx) => {
    if (
      typeof value.max_submissions_total === "number" &&
      typeof value.max_submissions_per_solver === "number" &&
      value.max_submissions_per_solver > value.max_submissions_total
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max_submissions_per_solver"],
        message:
          "max_submissions_per_solver cannot exceed max_submissions_total",
      });
    }

    if (hasDuplicateArtifacts(value.artifacts)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message:
          "Duplicate artifacts are not allowed. Next step: remove duplicated role/visibility/uri entries and retry.",
      });
    }

    const runtimeFamilyId = value.evaluation.runtime_family;
    const scorerImage = value.evaluation.scorer_image;

    if (runtimeFamilyId === EXPERT_RUNTIME_FAMILY_ID) {
      const imageError = validateExpertScorerImage(scorerImage);
      if (imageError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evaluation", "scorer_image"],
          message: imageError,
        });
      }
      return;
    }

    if (!isManagedRuntimeFamily(runtimeFamilyId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "runtime_family"],
        message: `Unknown runtime family: ${runtimeFamilyId}`,
      });
      return;
    }

    const metricError = validateRuntimeMetric(
      runtimeFamilyId,
      value.evaluation.metric,
    );
    if (metricError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "metric"],
        message: metricError,
      });
    }

    const imageError = validateScorerImage(scorerImage);
    if (imageError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "scorer_image"],
        message: imageError,
      });
    }

    const family = resolveRuntimeFamilyLimits(runtimeFamilyId);
    if (!family) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "runtime_family"],
        message: `Runtime family ${runtimeFamilyId} is missing runner limits.`,
      });
    }

    const managedImage = resolveManagedScorerImage(runtimeFamilyId);
    if (!managedImage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "runtime_family"],
        message: `Runtime family ${runtimeFamilyId} is missing a scorer image.`,
      });
    }

    const defaults = resolveRuntimeFamilyRuntimeDefaults(runtimeFamilyId);
    if (
      defaults?.evaluationContract &&
      value.submission_contract.kind !== "csv_table"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission_contract"],
        message: `Runtime family ${runtimeFamilyId} requires a csv_table submission contract.`,
      });
    }

    if (
      runtimeFamilyId !== EXPERT_RUNTIME_FAMILY_ID &&
      !value.evaluation.evaluation_bundle
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "evaluation_bundle"],
        message: `Runtime family ${runtimeFamilyId} requires an evaluation bundle.`,
      });
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

export interface ChallengeEvaluationCacheRow {
  runtime_family: string;
  metric: string;
  scorer_image: string;
  evaluation_bundle?: string | null;
}

export interface ChallengeEvalRow {
  evaluation_json?: ChallengeEvaluationCacheRow | null;
  artifacts_json?: ChallengeArtifact[] | null;
  submission_contract_json?: SubmissionContractOutput | null;
}

export interface ResolvedChallengeEvaluation {
  runtimeFamily: string;
  image: string;
  metric: string;
  evaluationBundleCid?: string;
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

export async function canonicalizeChallengeSpec(
  spec: ChallengeSpecOutput,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    resolveOfficialPresetDigests?: boolean;
  } = {},
): Promise<ChallengeSpecOutput> {
  const runtimeFamilyId = spec.evaluation.runtime_family;
  let scorerImage = spec.evaluation.scorer_image.trim();

  if (runtimeFamilyId !== EXPERT_RUNTIME_FAMILY_ID) {
    const managedImage = resolveManagedScorerImage(runtimeFamilyId);
    if (!managedImage) {
      throw new Error(
        `Unknown runtime family ${runtimeFamilyId}. Next step: choose a registered runtime family and retry.`,
      );
    }
    scorerImage = managedImage;
  }

  if (options.resolveOfficialPresetDigests === true) {
    scorerImage = await resolveOfficialImageToDigest(scorerImage, options);
  }

  return {
    ...spec,
    evaluation: {
      ...spec.evaluation,
      scorer_image: scorerImage,
    },
  };
}

export function resolveChallengeEvaluation(
  spec: ChallengeSpecOutput | ChallengeEvalRow,
): ResolvedChallengeEvaluation {
  if ("evaluation" in spec) {
    return {
      runtimeFamily: spec.evaluation.runtime_family,
      image: spec.evaluation.scorer_image,
      metric: spec.evaluation.metric,
      evaluationBundleCid: spec.evaluation.evaluation_bundle,
      mount: resolveRuntimeFamilyMount(spec.evaluation.runtime_family),
    };
  }

  const evaluation = spec.evaluation_json;
  if (!evaluation) {
    throw new Error(
      "Challenge is missing evaluation_json. Next step: rebuild the challenge projection and retry.",
    );
  }

  return {
    runtimeFamily: evaluation.runtime_family,
    image: evaluation.scorer_image,
    metric: evaluation.metric,
    evaluationBundleCid: evaluation.evaluation_bundle ?? undefined,
    mount: resolveRuntimeFamilyMount(evaluation.runtime_family),
  };
}

export function resolveScoringEnvironmentFromSpec(
  spec: ChallengeSpecOutput | null | undefined,
): Record<string, string> | undefined {
  if (!spec) {
    return undefined;
  }

  return (
    resolveRuntimeFamilyRuntimeDefaults(spec.evaluation.runtime_family)?.env ??
    undefined
  );
}

export interface ChallengeScoreabilityValidation {
  ok: boolean;
  errors: string[];
}

export function validateChallengeScoreability(
  spec: ChallengeSpecOutput,
): ChallengeScoreabilityValidation {
  const errors: string[] = [];
  const runtimeFamilyId = spec.evaluation.runtime_family;

  if (!spec.evaluation.scorer_image.trim()) {
    errors.push("Challenge requires a scorer image.");
  }

  if (!spec.evaluation.metric.trim()) {
    errors.push("Challenge requires a metric.");
  }

  if (
    runtimeFamilyId !== EXPERT_RUNTIME_FAMILY_ID &&
    !spec.evaluation.evaluation_bundle
  ) {
    errors.push(
      `Runtime family ${runtimeFamilyId} requires an evaluation bundle.`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
