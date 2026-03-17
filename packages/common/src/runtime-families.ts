import type { SubmissionContractOutput } from "./schemas/submission-contract.js";
import {
  createCsvTableEvaluationContract,
  createRuntimePolicies,
  type CsvTableEvaluationContractOutput,
  type ScorerRuntimePoliciesOutput,
} from "./schemas/scorer-runtime.js";

export const OFFICIAL_SCORER_IMAGES = {
  reproducibility: "ghcr.io/andymolecule/repro-scorer:v1",
  tabular: "ghcr.io/andymolecule/regression-scorer:v1",
  ranking: "ghcr.io/andymolecule/docking-scorer:v1",
  docking: "ghcr.io/andymolecule/docking-scorer:v1",
} as const;

export const EXPERT_RUNTIME_FAMILY_ID = "expert_custom" as const;

export interface RunnerLimits {
  memory: string;
  cpus: string;
  pids: number;
  timeoutMs: number;
}

export interface ScoringMountConfig {
  evaluationBundleName?: string;
  submissionFileName: string;
}

export const DEFAULT_SCORER_MOUNT: ScoringMountConfig = {
  evaluationBundleName: "ground_truth.csv",
  submissionFileName: "submission.csv",
};

export interface RuntimeMetricDefinition {
  id: string;
  label: string;
  direction: "higher" | "lower";
}

export interface RuntimeDefaults {
  evaluationContract?: CsvTableEvaluationContractOutput;
  policies?: ScorerRuntimePoliciesOutput;
  env?: Record<string, string>;
}

export interface ManagedRuntimeFamily {
  id: string;
  displayName: string;
  description: string;
  supportedMetrics: RuntimeMetricDefinition[];
  supportedArtifactRoles: string[];
  submissionKind: SubmissionContractOutput["kind"];
  scorerImage: string;
  defaultLimits: RunnerLimits;
  requiresEvaluationBundle: boolean;
  mount?: ScoringMountConfig;
  runtimeDefaults?: RuntimeDefaults;
  defaultVisibility: "private_eval" | "public_benchmark";
}

const CSV_LABEL_EVALUATION_CONTRACT = createCsvTableEvaluationContract({
  requiredColumns: ["id", "label"],
  idColumn: "id",
  valueColumn: "label",
});

const DOCKING_EVALUATION_CONTRACT = createCsvTableEvaluationContract({
  requiredColumns: ["ligand_id", "reference_score"],
  idColumn: "ligand_id",
  valueColumn: "reference_score",
});

export const MANAGED_RUNTIME_REGISTRY: Record<string, ManagedRuntimeFamily> = {
  reproducibility: {
    id: "reproducibility",
    displayName: "Reproducibility",
    description:
      "Deterministic row-by-row comparison against a reference output.",
    supportedMetrics: [
      { id: "exact_match", label: "Exact Match", direction: "higher" },
      { id: "tolerant_match", label: "Tolerant Match", direction: "higher" },
    ],
    supportedArtifactRoles: ["source_data", "reference_output"],
    submissionKind: "csv_table",
    scorerImage: OFFICIAL_SCORER_IMAGES.reproducibility,
    defaultLimits: { memory: "512m", cpus: "1", pids: 64, timeoutMs: 300_000 },
    requiresEvaluationBundle: true,
    defaultVisibility: "public_benchmark",
    runtimeDefaults: {
      env: {
        AGORA_TOLERANCE: "0.001",
      },
    },
  },
  tabular_regression: {
    id: "tabular_regression",
    displayName: "Prediction (Regression)",
    description:
      "Scores tabular predictions against hidden numeric labels using deterministic CSV evaluation.",
    supportedMetrics: [
      { id: "r2", label: "R2", direction: "higher" },
      { id: "rmse", label: "RMSE", direction: "lower" },
      { id: "mae", label: "MAE", direction: "lower" },
      { id: "pearson", label: "Pearson", direction: "higher" },
      { id: "spearman", label: "Spearman", direction: "higher" },
    ],
    supportedArtifactRoles: ["training_data", "evaluation_features", "hidden_labels"],
    submissionKind: "csv_table",
    scorerImage: OFFICIAL_SCORER_IMAGES.tabular,
    defaultLimits: { memory: "2g", cpus: "2", pids: 64, timeoutMs: 600_000 },
    requiresEvaluationBundle: true,
    defaultVisibility: "private_eval",
    runtimeDefaults: {
      evaluationContract: CSV_LABEL_EVALUATION_CONTRACT,
      policies: createRuntimePolicies({
        coveragePolicy: "reject",
        duplicateIdPolicy: "reject",
        invalidValuePolicy: "reject",
      }),
    },
  },
  tabular_classification: {
    id: "tabular_classification",
    displayName: "Prediction (Classification)",
    description:
      "Scores tabular classification predictions against hidden labels.",
    supportedMetrics: [
      { id: "accuracy", label: "Accuracy", direction: "higher" },
      { id: "f1", label: "F1", direction: "higher" },
    ],
    supportedArtifactRoles: ["training_data", "evaluation_features", "hidden_labels"],
    submissionKind: "csv_table",
    scorerImage: OFFICIAL_SCORER_IMAGES.tabular,
    defaultLimits: { memory: "2g", cpus: "2", pids: 64, timeoutMs: 600_000 },
    requiresEvaluationBundle: true,
    defaultVisibility: "private_eval",
    runtimeDefaults: {
      evaluationContract: CSV_LABEL_EVALUATION_CONTRACT,
      policies: createRuntimePolicies({
        coveragePolicy: "reject",
        duplicateIdPolicy: "reject",
        invalidValuePolicy: "reject",
      }),
    },
  },
  ranking: {
    id: "ranking",
    displayName: "Ranking",
    description:
      "Scores ranked predictions against a reference ordering or hidden scores.",
    supportedMetrics: [
      { id: "spearman", label: "Spearman", direction: "higher" },
      { id: "ndcg", label: "NDCG", direction: "higher" },
    ],
    supportedArtifactRoles: ["ranking_inputs", "reference_ranking"],
    submissionKind: "csv_table",
    scorerImage: OFFICIAL_SCORER_IMAGES.ranking,
    defaultLimits: { memory: "4g", cpus: "2", pids: 64, timeoutMs: 1_200_000 },
    requiresEvaluationBundle: true,
    defaultVisibility: "private_eval",
    runtimeDefaults: {
      evaluationContract: CSV_LABEL_EVALUATION_CONTRACT,
      policies: createRuntimePolicies({
        coveragePolicy: "reject",
        duplicateIdPolicy: "reject",
        invalidValuePolicy: "reject",
      }),
    },
  },
  docking: {
    id: "docking",
    displayName: "Docking",
    description:
      "Scores ligand docking predictions against hidden reference scores for a posted target structure and ligand set.",
    supportedMetrics: [
      { id: "spearman", label: "Spearman", direction: "higher" },
      { id: "ndcg", label: "NDCG", direction: "higher" },
    ],
    supportedArtifactRoles: [
      "target_structure",
      "ligand_library",
      "reference_scores",
    ],
    submissionKind: "csv_table",
    scorerImage: OFFICIAL_SCORER_IMAGES.docking,
    defaultLimits: { memory: "4g", cpus: "2", pids: 64, timeoutMs: 1_200_000 },
    requiresEvaluationBundle: true,
    defaultVisibility: "private_eval",
    runtimeDefaults: {
      evaluationContract: DOCKING_EVALUATION_CONTRACT,
      policies: createRuntimePolicies({
        coveragePolicy: "reject",
        duplicateIdPolicy: "reject",
        invalidValuePolicy: "reject",
      }),
    },
  },
};

export function listManagedRuntimeFamilies(): ManagedRuntimeFamily[] {
  return Object.values(MANAGED_RUNTIME_REGISTRY);
}

export function lookupManagedRuntimeFamily(
  runtimeFamilyId: string,
): ManagedRuntimeFamily | undefined {
  return MANAGED_RUNTIME_REGISTRY[runtimeFamilyId];
}

export function isManagedRuntimeFamily(runtimeFamilyId: string): boolean {
  return Boolean(lookupManagedRuntimeFamily(runtimeFamilyId));
}

export function getManagedRuntimeMetric(
  runtimeFamilyId: string,
  metricId: string,
): RuntimeMetricDefinition | undefined {
  return lookupManagedRuntimeFamily(runtimeFamilyId)?.supportedMetrics.find(
    (metric) => metric.id === metricId,
  );
}

export function validateRuntimeMetric(
  runtimeFamilyId: string,
  metricId: string,
): string | null {
  if (runtimeFamilyId === EXPERT_RUNTIME_FAMILY_ID) {
    return metricId.trim().length > 0
      ? null
      : "Expert challenges require a metric identifier.";
  }

  const family = lookupManagedRuntimeFamily(runtimeFamilyId);
  if (!family) {
    return `Unknown runtime family: ${runtimeFamilyId}`;
  }

  return getManagedRuntimeMetric(runtimeFamilyId, metricId)
    ? null
    : `Metric ${metricId} is not supported by runtime family ${runtimeFamilyId}.`;
}

export function resolveRuntimeFamilyMount(
  runtimeFamilyId: string,
): ScoringMountConfig {
  return (
    lookupManagedRuntimeFamily(runtimeFamilyId)?.mount ?? DEFAULT_SCORER_MOUNT
  );
}

export function resolveRuntimeFamilyRuntimeDefaults(
  runtimeFamilyId: string,
): RuntimeDefaults | null {
  return lookupManagedRuntimeFamily(runtimeFamilyId)?.runtimeDefaults ?? null;
}

export function resolveRuntimeFamilyLimits(
  runtimeFamilyId: string,
): RunnerLimits | null {
  return lookupManagedRuntimeFamily(runtimeFamilyId)?.defaultLimits ?? null;
}

export function resolveManagedScorerImage(
  runtimeFamilyId: string,
): string | null {
  return lookupManagedRuntimeFamily(runtimeFamilyId)?.scorerImage ?? null;
}

type ParsedGhcrImageRef = {
  imagePath: string;
  owner: string;
  repository: string;
  tag?: string;
  digest?: string;
};

function parseGhcrImageReference(image: string): ParsedGhcrImageRef | null {
  const match =
    /^ghcr\.io\/([^/]+\/[^:@]+)(?::([^@]+))?(?:@(sha256:[a-fA-F0-9]{64}))?$/.exec(
      image.trim(),
    );
  if (!match) return null;
  const imagePath = match[1];
  if (!imagePath) return null;
  const [owner = "", repository = ""] = imagePath.split("/", 2);
  return {
    imagePath,
    owner,
    repository,
    tag: match[2],
    digest: match[3],
  };
}

function sharesGhcrRepository(left: string, right: string): boolean {
  const leftRef = parseGhcrImageReference(left);
  const rightRef = parseGhcrImageReference(right);
  return (
    typeof leftRef?.imagePath === "string" &&
    typeof rightRef?.imagePath === "string" &&
    leftRef.imagePath === rightRef.imagePath
  );
}

const officialScorerImageSet = new Set<string>(
  Object.values(OFFICIAL_SCORER_IMAGES),
);

export function isOfficialScorerImage(image: string): boolean {
  const trimmed = image.trim();
  return (
    officialScorerImageSet.has(trimmed) ||
    Object.values(OFFICIAL_SCORER_IMAGES).some(
      (officialImage) =>
        trimmed.includes("@sha256:") &&
        sharesGhcrRepository(officialImage, trimmed),
    )
  );
}

export function validateScorerImage(image: string): string | null {
  const trimmed = image.trim();

  if (!trimmed) {
    return "Scorer image is required.";
  }

  if (!trimmed.includes("/")) {
    return "Scorer image must be a fully qualified OCI image reference (e.g. ghcr.io/org/image:tag).";
  }

  if (trimmed.endsWith(":latest")) {
    return "Using :latest is not allowed for scoring. Use a pinned digest or a stable Agora-managed image tag.";
  }

  return null;
}

export function validateExpertScorerImage(image: string): string | null {
  const base = validateScorerImage(image);
  if (base) return base;
  if (!image.trim().includes("@sha256:")) {
    return "Expert-mode scorer images must use a pinned digest (@sha256:...) for reproducibility.";
  }
  return null;
}

const GHCR_RESOLUTION_TIMEOUT_MS = 5_000;
const GHCR_CACHE_TTL_MS = 5 * 60 * 1000;
const ghcrDigestCache = new Map<
  string,
  { digest: string; expiresAt: number }
>();

async function getGhcrHeaders(
  env: Record<string, string | undefined>,
  imagePath?: string,
  fetchImpl: typeof fetch = fetch,
) {
  const headers: Record<string, string> = {
    Accept:
      "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
  };
  const token = env.AGORA_GHCR_TOKEN ?? env.GHCR_TOKEN ?? env.GITHUB_TOKEN;
  if (typeof token === "string" && token.length > 0) {
    headers.Authorization = `Bearer ${token}`;
  } else if (imagePath) {
    try {
      const tokenRes = await fetchImpl(
        `https://ghcr.io/token?scope=repository:${imagePath}:pull`,
      );
      if (tokenRes.ok) {
        const body = (await tokenRes.json()) as { token?: string };
        if (typeof body.token === "string" && body.token.length > 0) {
          headers.Authorization = `Bearer ${body.token}`;
        }
      }
    } catch {
      // Anonymous fallback.
    }
  }
  return headers;
}

function getGhcrDigestCacheKey(
  image: string,
  env: Record<string, string | undefined>,
) {
  const token = env.AGORA_GHCR_TOKEN ?? env.GHCR_TOKEN ?? env.GITHUB_TOKEN;
  return `${image}|${token ? "auth" : "anon"}`;
}

export class GhcrResolutionError extends Error {
  constructor(
    readonly code:
      | "auth_failure"
      | "rate_limit"
      | "missing_digest_header"
      | "network_timeout"
      | "network_error"
      | "http_error"
      | "unsupported_image_reference",
    message: string,
  ) {
    super(message);
    this.name = "GhcrResolutionError";
  }
}

export async function resolveOfficialImageToDigest(
  image: string,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<string> {
  const trimmed = image.trim();
  if (trimmed.includes("@sha256:")) {
    return trimmed;
  }
  if (!officialScorerImageSet.has(trimmed)) {
    return trimmed;
  }

  const env = options.env ?? process.env;
  const cacheKey = getGhcrDigestCacheKey(trimmed, env);
  const cached = ghcrDigestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.digest;
  }

  const parsed = parseGhcrImageReference(trimmed);
  if (!parsed?.imagePath) {
    throw new GhcrResolutionError(
      "unsupported_image_reference",
      `Failed to resolve digest for official image ${trimmed}: unsupported image reference format.`,
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    GHCR_RESOLUTION_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(
      `https://ghcr.io/v2/${parsed.imagePath}/manifests/${parsed.tag ?? "latest"}`,
      {
        method: "GET",
        headers: await getGhcrHeaders(env, parsed.imagePath, fetchImpl),
        signal: controller.signal,
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new GhcrResolutionError(
        "auth_failure",
        `GHCR auth failure while resolving official image ${trimmed}. Configure AGORA_GHCR_TOKEN, GHCR_TOKEN, or GITHUB_TOKEN with pull access.`,
      );
    }

    if (response.status === 429) {
      throw new GhcrResolutionError(
        "rate_limit",
        `GHCR rate limit while resolving official image ${trimmed}. Please retry shortly.`,
      );
    }

    if (!response.ok) {
      throw new GhcrResolutionError(
        "http_error",
        `Failed to resolve digest for official image ${trimmed}: GHCR responded ${response.status}.`,
      );
    }

    const digest = response.headers.get("docker-content-digest");
    if (!digest || !digest.startsWith("sha256:")) {
      throw new GhcrResolutionError(
        "missing_digest_header",
        `Failed to resolve digest for official image ${trimmed}: missing docker-content-digest header.`,
      );
    }

    const resolvedDigest = `ghcr.io/${parsed.imagePath}@${digest}`;
    ghcrDigestCache.set(cacheKey, {
      digest: resolvedDigest,
      expiresAt: Date.now() + GHCR_CACHE_TTL_MS,
    });
    return resolvedDigest;
  } catch (error) {
    if (error instanceof GhcrResolutionError) {
      throw error;
    }
    if (
      error instanceof Error &&
      (error.name === "AbortError" || controller.signal.aborted)
    ) {
      throw new GhcrResolutionError(
        "network_timeout",
        `Timed out resolving official image ${trimmed} from GHCR.`,
      );
    }
    throw new GhcrResolutionError(
      "network_error",
      `Network error resolving official image ${trimmed} from GHCR: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    clearTimeout(timeout);
  }
}
