import { z } from "zod";
import {
  DEFAULT_SCORER_MOUNT,
  OFFICIAL_SCORER_IMAGES,
  resolveRuntimeFamilyRuntimeDefaults,
  validateRuntimeMetric,
} from "./runtime-families.js";
import {
  createRuntimePolicies,
  csvTableEvaluationContractSchema,
  scorerRuntimePoliciesSchema,
  type CsvTableEvaluationContractOutput,
  type ScorerRuntimePoliciesOutput,
} from "./schemas/scorer-runtime.js";
import type { ScoringMountConfig } from "./runtime-families.js";
import type {
  DefinitionBackedBundleManifestExecutionOutput,
  DefinitionBackedEvaluatorContractOutput,
  DefinitionBackedSubmissionKindOutput,
} from "./schemas/evaluator-contract.js";

export const GENERATED_SCORER_PROGRAM_FILE_NAME = "generated_scorer.py";

const generatedScorerMountSchema = z.object({
  evaluation_bundle_name: z.string().trim().min(1).optional(),
  submission_file_name: z.string().trim().min(1),
});

export const generatedScorerProgramSchema = z.object({
  version: z.literal("v1"),
  language: z.literal("python"),
  source: z.string().trim().min(1),
  runtime_family: z.string().trim().min(1).optional(),
  mount: generatedScorerMountSchema,
  evaluation_artifact_role: z.string().trim().min(1),
  evaluation_contract: csvTableEvaluationContractSchema.optional(),
  policies: scorerRuntimePoliciesSchema,
});

export type GeneratedScorerProgramOutput = z.output<
  typeof generatedScorerProgramSchema
>;

export const GENERATED_MANAGED_PRESET_IDS = [
  "reproducibility",
  "tabular_regression",
  "tabular_classification",
] as const;

export type GeneratedManagedPresetId =
  (typeof GENERATED_MANAGED_PRESET_IDS)[number];

function createGeneratedScorerProgram(input: {
  source: string;
  runtimeFamily?: string;
  mount: ScoringMountConfig;
  evaluationArtifactRole: string;
  evaluationContract?: CsvTableEvaluationContractOutput;
  policies?: ScorerRuntimePoliciesOutput;
}): GeneratedScorerProgramOutput {
  return generatedScorerProgramSchema.parse({
    version: "v1",
    language: "python",
    source: input.source,
    ...(input.runtimeFamily ? { runtime_family: input.runtimeFamily } : {}),
    mount: {
      ...(input.mount.evaluationBundleName
        ? { evaluation_bundle_name: input.mount.evaluationBundleName }
        : {}),
      submission_file_name: input.mount.submissionFileName,
    },
    evaluation_artifact_role: input.evaluationArtifactRole,
    ...(input.evaluationContract
      ? { evaluation_contract: input.evaluationContract }
      : {}),
    policies:
      input.policies ??
      createRuntimePolicies({
        coveragePolicy: "reject",
        duplicateIdPolicy: "reject",
        invalidValuePolicy: "reject",
      }),
  });
}

function buildGeneratedPythonWrapper(helperName: string): string {
  return [
    `from agora_generated_runtime import ${helperName}`,
    "",
    "def score(input_dir, output_dir):",
    `    ${helperName}(input_dir, output_dir)`,
    "",
  ].join("\n");
}

function buildGeneratedExactMatchCsvWrapper(tolerance?: number): string {
  const lines = [
    "import os",
    "from agora_generated_runtime import run_exact_match_csv",
    "",
    "def score(input_dir, output_dir):",
  ];
  if (typeof tolerance === "number" && Number.isFinite(tolerance)) {
    lines.push(`    os.environ["AGORA_TOLERANCE"] = "${tolerance}"`);
  }
  lines.push("    run_exact_match_csv(input_dir, output_dir)", "");
  return lines.join("\n");
}

function defaultDefinitionBackedPolicies() {
  return createRuntimePolicies({
    coveragePolicy: "reject",
    duplicateIdPolicy: "reject",
    invalidValuePolicy: "reject",
  });
}

function singleHiddenArtifactRole(
  contract: DefinitionBackedEvaluatorContractOutput,
) {
  return contract.artifact_roles.hidden.length === 1
    ? contract.artifact_roles.hidden[0]
    : null;
}

function resolveGeneratedSubmissionMount(
  submissionKind: DefinitionBackedSubmissionKindOutput,
): ScoringMountConfig | null {
  switch (submissionKind) {
    case "csv_table":
      return DEFAULT_SCORER_MOUNT;
    case "json_file":
      return {
        evaluationBundleName: "ground_truth.json",
        submissionFileName: "submission.json",
      };
    case "opaque_file":
      return {
        evaluationBundleName: "ground_truth.bin",
        submissionFileName: "submission.bin",
      };
    default:
      return null;
  }
}

function resolveStructuredTableRuntimeFamily(metric: string) {
  switch (metric) {
    case "accuracy":
    case "f1":
      return "tabular_classification";
    case "r2":
    case "rmse":
    case "mae":
    case "pearson":
    case "spearman":
      return "tabular_regression";
    default:
      return null;
  }
}

function parseNumericTolerance(
  contract: DefinitionBackedEvaluatorContractOutput,
): number | undefined {
  const value = contract.submission.schema_requirements?.numeric_tolerance;
  const tolerance = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    return undefined;
  }
  return tolerance;
}

function bundleManifestExecution(
  contract: DefinitionBackedEvaluatorContractOutput,
): DefinitionBackedBundleManifestExecutionOutput | null {
  if (contract.execution?.template !== "official_bundle_manifest_v1") {
    return null;
  }
  return contract.execution;
}

function isGeneratedManagedPresetId(
  presetId: string,
): presetId is GeneratedManagedPresetId {
  return GENERATED_MANAGED_PRESET_IDS.includes(
    presetId as GeneratedManagedPresetId,
  );
}

export function buildGeneratedScorerProgramForManagedPreset(input: {
  presetId: string;
  metric: string;
}): GeneratedScorerProgramOutput | null {
  if (!isGeneratedManagedPresetId(input.presetId)) {
    return null;
  }

  if (validateRuntimeMetric(input.presetId, input.metric)) {
    return null;
  }

  if (input.presetId === "reproducibility") {
    if (!["exact_match", "tolerant_match"].includes(input.metric)) {
      return null;
    }

    return createGeneratedScorerProgram({
      source: buildGeneratedPythonWrapper("run_exact_match_csv"),
      runtimeFamily: "reproducibility",
      mount: DEFAULT_SCORER_MOUNT,
      evaluationArtifactRole: "reference_output",
      policies: defaultDefinitionBackedPolicies(),
    });
  }

  const runtimeDefaults = resolveRuntimeFamilyRuntimeDefaults(input.presetId);
  if (!runtimeDefaults?.evaluationContract || !runtimeDefaults?.policies) {
    return null;
  }

  return createGeneratedScorerProgram({
    source: buildGeneratedPythonWrapper("run_structured_table_metric"),
    runtimeFamily: input.presetId,
    mount: DEFAULT_SCORER_MOUNT,
    evaluationArtifactRole: "hidden_labels",
    evaluationContract: runtimeDefaults.evaluationContract,
    policies: runtimeDefaults.policies,
  });
}

export function buildGeneratedScorerProgramFromDefinitionBackedEvaluator(
  contract?: DefinitionBackedEvaluatorContractOutput | null,
): GeneratedScorerProgramOutput | null {
  if (!contract) {
    return null;
  }

  if (contract.archetype === "structured_table_score") {
    const execution = contract.execution;
    if (
      execution?.template !== "official_table_metric_v1" ||
      !execution.evaluation_contract
    ) {
      return null;
    }

    const runtimeFamily = resolveStructuredTableRuntimeFamily(
      contract.scoring.metric,
    );
    if (!runtimeFamily) {
      return null;
    }

    return createGeneratedScorerProgram({
      source: buildGeneratedPythonWrapper("run_structured_table_metric"),
      runtimeFamily,
      mount: DEFAULT_SCORER_MOUNT,
      evaluationArtifactRole: execution.evaluation_artifact_role,
      evaluationContract: execution.evaluation_contract,
      policies: execution.policies,
    });
  }

  if (contract.archetype === "structured_record_score") {
    if (contract.submission.kind !== "json_file") {
      return null;
    }

    const evaluationArtifactRole =
      contract.execution?.evaluation_artifact_role ??
      singleHiddenArtifactRole(contract);
    if (!evaluationArtifactRole) {
      return null;
    }

    return createGeneratedScorerProgram({
      source: buildGeneratedPythonWrapper("run_structured_record_validation"),
      runtimeFamily: "reproducibility",
      mount: {
        evaluationBundleName: "ground_truth.json",
        submissionFileName: "submission.json",
      },
      evaluationArtifactRole,
      policies: contract.execution?.policies ?? defaultDefinitionBackedPolicies(),
    });
  }

  if (contract.archetype === "exact_artifact_match") {
    const mount = resolveGeneratedSubmissionMount(contract.submission.kind);
    if (!mount) {
      return null;
    }
    const evaluationArtifactRole =
      contract.execution?.evaluation_artifact_role ??
      singleHiddenArtifactRole(contract);
    if (!evaluationArtifactRole) {
      return null;
    }
    const source =
      contract.submission.kind === "csv_table"
        ? buildGeneratedExactMatchCsvWrapper(parseNumericTolerance(contract))
        : buildGeneratedPythonWrapper(
            contract.submission.kind === "json_file"
              ? "run_exact_match_json"
              : "run_exact_match_binary",
          );

    return createGeneratedScorerProgram({
      source,
      runtimeFamily: "reproducibility",
      mount,
      evaluationArtifactRole,
      policies: contract.execution?.policies ?? defaultDefinitionBackedPolicies(),
    });
  }

  if (contract.archetype === "bundle_or_code_judge") {
    const execution = bundleManifestExecution(contract);
    if (!execution || contract.submission.kind !== "bundle_or_code") {
      return null;
    }

    return createGeneratedScorerProgram({
      source: buildGeneratedPythonWrapper("run_bundle_manifest_validation"),
      runtimeFamily: "bundle_or_code_judge",
      mount: {
        evaluationBundleName: "judge_rubric.json",
        submissionFileName: "submission.zip",
      },
      evaluationArtifactRole: execution.evaluation_artifact_role,
      policies: execution.policies,
    });
  }

  return null;
}

export function resolveGeneratedScorerImage(): string {
  return OFFICIAL_SCORER_IMAGES.generated;
}
