import assert from "node:assert/strict";
import {
  buildGeneratedScorerProgramForManagedPreset,
  buildGeneratedScorerProgramFromDefinitionBackedEvaluator,
} from "../generated-scorers.js";
import {
  canonicalizeChallengeSpec,
  challengeSpecSchema,
  parseChallengeSpecDocument,
  resolveChallengeEvaluation,
  validateChallengeScoreability,
  validateChallengeSpec,
} from "../schemas/challenge-spec.js";

const sample = {
  schema_version: 4,
  id: "ch-001",
  title: "Predict assay response",
  domain: "omics",
  type: "prediction",
  description: "Predict the held-out labels.",
  evaluation: {
    preset_id: "tabular_regression",
    backend_kind: "preset_interpreter" as const,
    execution_runtime_family: "tabular_regression",
    metric: "r2",
    evaluation_bundle: "ipfs://QmHiddenLabels",
  },
  artifacts: [
    {
      role: "training_data",
      visibility: "public" as const,
      uri: "ipfs://QmTrain",
      file_name: "train.csv",
    },
    {
      role: "evaluation_features",
      visibility: "public" as const,
      uri: "ipfs://QmTest",
      file_name: "test.csv",
    },
    {
      role: "hidden_labels",
      visibility: "private" as const,
      uri: "ipfs://QmHiddenLabels",
      file_name: "hidden_labels.csv",
    },
  ],
  submission_contract: {
    version: "v1" as const,
    kind: "csv_table" as const,
    file: {
      extension: ".csv",
      mime: "text/csv",
      max_bytes: 10_000_000,
    },
    columns: {
      required: ["id", "prediction"],
      id: "id",
      value: "prediction",
      allow_extra: true,
    },
  },
  reward: {
    total: "25",
    distribution: "winner_take_all" as const,
  },
  deadline: "2026-03-20T00:00:00Z",
  dispute_window_hours: 0,
};

const result = challengeSpecSchema.safeParse(sample);
assert.equal(result.success, true, "sample spec should validate");

const chainValidated = validateChallengeSpec(sample, 84532);
assert.equal(chainValidated.success, true, "chain validation should succeed");

if (!result.success) {
  throw new Error("Expected sample spec to parse");
}

const resolved = resolveChallengeEvaluation(result.data);
assert.equal(resolved.executionRuntimeFamily, "tabular_regression");
assert.equal(resolved.metric, "r2");
assert.equal(resolved.evaluationBundleCid, "ipfs://QmHiddenLabels");

const scoreability = validateChallengeScoreability(result.data);
assert.equal(scoreability.ok, true, "sample spec should be scoreable");

const canonicalized = await canonicalizeChallengeSpec(result.data, {
  resolveOfficialPresetDigests: false,
});
assert.equal(
  canonicalized.evaluation.scorer_image,
  "ghcr.io/andymolecule/gems-tabular-scorer:v1",
  "managed challenges should canonicalize their scorer image from the registry",
);

const generatedManagedSpec = challengeSpecSchema.safeParse({
  ...sample,
  evaluation: {
    preset_id: "tabular_regression",
    backend_kind: "generated_scorer" as const,
    execution_runtime_family: "tabular_regression",
    metric: "r2",
    generated_scorer: buildGeneratedScorerProgramForManagedPreset({
      presetId: "tabular_regression",
      metric: "r2",
    }),
  },
});
assert.equal(
  generatedManagedSpec.success,
  true,
  "managed generated-scorer specs should validate for collapsed preset families",
);

if (!generatedManagedSpec.success) {
  throw new Error("Expected managed generated scorer spec to parse");
}

const generatedManagedCanonical = await canonicalizeChallengeSpec(
  generatedManagedSpec.data,
  {
    resolveOfficialPresetDigests: false,
  },
);
assert.equal(
  generatedManagedCanonical.evaluation.scorer_image,
  "ghcr.io/andymolecule/gems-generated-scorer:v1",
  "collapsed managed specs should canonicalize to the generated scorer",
);

const invalidMetric = challengeSpecSchema.safeParse({
  ...sample,
  evaluation: {
    ...sample.evaluation,
    metric: "accuracy",
  },
});
assert.equal(invalidMetric.success, false, "unsupported metric should fail");

const customImageSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    preset_id: "custom",
    backend_kind: "oci_image" as const,
    metric: "custom",
    scorer_image: `ghcr.io/acme/expert@sha256:${"1".repeat(64)}`,
  },
});
assert.equal(
  customImageSpec.success,
  true,
  "custom image specs should accept pinned digests",
);

const definitionOnlySpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    preset_id: "structured_record_score",
    backend_kind: "definition_only" as const,
    metric: "validation_score",
    evaluator_contract: {
      version: "v1",
      archetype: "structured_record_score",
      summary: "Validate a JSON report against a deterministic rubric.",
      artifact_roles: {
        solver_visible: ["training_data"],
        hidden: ["hidden_labels"],
      },
      submission: {
        kind: "json_file",
        schema_requirements: {
          expected_kind: "json_file",
        },
        validation_rules: ["Submission must be valid JSON."],
      },
      scoring: {
        metric: "validation_score",
        comparator: "maximize",
        deterministic_rule:
          "Score the JSON report against the hidden rubric and rank by validation score.",
        minimum_threshold: null,
      },
      notes: [],
    },
  },
});
assert.equal(
  definitionOnlySpec.success,
  true,
  "definition-only specs should validate when they include an evaluator contract",
);

if (!definitionOnlySpec.success) {
  throw new Error("Expected definition-only spec to parse");
}

const definitionOnlyResolved = resolveChallengeEvaluation(definitionOnlySpec.data);
assert.equal(
  definitionOnlyResolved.evaluatorContract?.archetype,
  "structured_record_score",
);
assert.equal(
  validateChallengeScoreability(definitionOnlySpec.data).ok,
  false,
  "definition-only specs should not be treated as executable until the runtime path exists",
);

const invalidDefinitionOnlyWithExecution = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    preset_id: "bundle_or_code_judge",
    backend_kind: "definition_only" as const,
    metric: "validation_score",
    evaluator_contract: {
      version: "v1",
      archetype: "bundle_or_code_judge",
      summary: "Validate a bundle against a deterministic manifest.",
      artifact_roles: {
        solver_visible: ["training_data"],
        hidden: ["hidden_labels"],
      },
      submission: {
        kind: "bundle_or_code",
        schema_requirements: {
          expected_extension: ".zip",
          expected_mime: "application/zip",
        },
        validation_rules: ["Submission must be a valid zip bundle."],
      },
      scoring: {
        metric: "validation_score",
        comparator: "maximize",
        deterministic_rule:
          "Validate the submitted bundle against the hidden manifest and rank by validation score.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_bundle_manifest_v1",
        evaluation_artifact_role: "hidden_labels",
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
  submission_contract: {
    version: "v1" as const,
    kind: "opaque_file" as const,
    file: {
      extension: ".zip",
      mime: "application/zip",
      max_bytes: 10_000_000,
    },
  },
});
assert.equal(
  invalidDefinitionOnlyWithExecution.success,
  false,
  "definition-only specs should reject attached execution templates",
);

const executableStructuredRecordSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    preset_id: "structured_record_score",
    backend_kind: "preset_interpreter" as const,
    execution_runtime_family: "reproducibility",
    metric: "validation_score",
    scorer_image:
      `ghcr.io/andymolecule/gems-match-scorer@sha256:${"2".repeat(64)}`,
    evaluator_contract: {
      version: "v1",
      archetype: "structured_record_score",
      summary: "Validate a JSON report against a deterministic hidden rubric.",
      artifact_roles: {
        solver_visible: ["training_data"],
        hidden: ["hidden_labels"],
      },
      submission: {
        kind: "json_file",
        schema_requirements: {
          expected_kind: "json_file",
        },
        validation_rules: ["Submission must be valid JSON."],
      },
      scoring: {
        metric: "validation_score",
        comparator: "maximize",
        deterministic_rule:
          "Score the JSON report against the hidden rubric and rank by validation score.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_structured_record_v1",
        evaluation_artifact_role: "hidden_labels",
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
  artifacts: [
    {
      role: "training_data",
      visibility: "public" as const,
      uri: "ipfs://QmPrompt",
    },
    {
      role: "hidden_labels",
      visibility: "private" as const,
      uri: "ipfs://QmRubric",
      file_name: "validation_rubric.json",
      mime_type: "application/json",
    },
  ],
  submission_contract: {
    version: "v1" as const,
    kind: "opaque_file" as const,
    file: {
      extension: ".json",
      mime: "application/json",
      max_bytes: 1024,
    },
  },
});
assert.equal(
  executableStructuredRecordSpec.success,
  true,
  "definition-backed structured-record specs should validate when they use the supported execution template",
);

if (!executableStructuredRecordSpec.success) {
  throw new Error(
    "Expected executable structured-record definition-backed spec to parse",
  );
}

const executableStructuredRecordResolved = resolveChallengeEvaluation(
  executableStructuredRecordSpec.data,
);
assert.equal(
  executableStructuredRecordResolved.executionRuntimeFamily,
  "reproducibility",
);
assert.equal(
  executableStructuredRecordResolved.definitionBackedExecution
    ?.runner_runtime_family,
  "reproducibility",
);
assert.equal(
  executableStructuredRecordResolved.mount.evaluationBundleName,
  "ground_truth.json",
);
assert.equal(
  executableStructuredRecordResolved.mount.submissionFileName,
  "submission.json",
);
assert.equal(
  validateChallengeScoreability(executableStructuredRecordSpec.data).ok,
  true,
  "supported structured-record specs should be scoreable",
);

const executableTableSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    preset_id: "structured_table_score",
    backend_kind: "preset_interpreter" as const,
    execution_runtime_family: "tabular_regression",
    metric: "rmse",
    scorer_image:
      `ghcr.io/andymolecule/gems-tabular-scorer@sha256:${"3".repeat(64)}`,
    evaluator_contract: {
      version: "v1",
      archetype: "structured_table_score",
      summary: "Score a CSV submission against hidden truth with RMSE.",
      artifact_roles: {
        solver_visible: ["training_data", "evaluation_features"],
        hidden: ["hidden_labels"],
      },
      submission: {
        kind: "csv_table",
        schema_requirements: {
          suggested_columns: ["id", "prediction"],
        },
        validation_rules: ["Submission must be valid CSV."],
      },
      scoring: {
        metric: "rmse",
        comparator: "minimize",
        deterministic_rule:
          "Compute RMSE against the hidden labels and rank by the normalized leaderboard score.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_table_metric_v1",
        evaluation_artifact_role: "hidden_labels",
        evaluation_contract: {
          kind: "csv_table",
          columns: {
            required: ["id", "label"],
            id: "id",
            value: "label",
            allow_extra: true,
          },
        },
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
});
assert.equal(
  executableTableSpec.success,
  true,
  "definition-backed table specs should validate when they use a supported execution template",
);

if (!executableTableSpec.success) {
  throw new Error("Expected executable table spec to parse");
}

const executableTableResolved = resolveChallengeEvaluation(
  executableTableSpec.data,
);
assert.equal(executableTableResolved.executionRuntimeFamily, "tabular_regression");
assert.equal(
  executableTableResolved.evaluationBundleCid,
  "ipfs://QmHiddenLabels",
);
assert.equal(
  executableTableResolved.definitionBackedExecution?.runner_runtime_family,
  "tabular_regression",
);
assert.equal(
  validateChallengeScoreability(executableTableSpec.data).ok,
  true,
  "supported table specs should be scoreable",
);

const executableJsonExactMatchSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    preset_id: "exact_artifact_match",
    backend_kind: "preset_interpreter" as const,
    execution_runtime_family: "reproducibility",
    metric: "exact_match",
    scorer_image:
      `ghcr.io/andymolecule/gems-match-scorer@sha256:${"5".repeat(64)}`,
    evaluator_contract: {
      version: "v1",
      archetype: "exact_artifact_match",
      summary:
        "Compare a JSON solver output directly against a hidden reference document.",
      artifact_roles: {
        solver_visible: ["source_data"],
        hidden: ["reference_output"],
      },
      submission: {
        kind: "json_file",
        schema_requirements: {
          expected_kind: "json_file",
        },
        validation_rules: ["Submission must be valid JSON."],
      },
      scoring: {
        metric: "exact_match",
        comparator: "maximize",
        deterministic_rule:
          "Compare the submission JSON directly against the hidden reference output.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_exact_match_v1",
        evaluation_artifact_role: "reference_output",
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
  artifacts: [
    {
      role: "source_data",
      visibility: "public" as const,
      uri: "ipfs://QmJsonInput",
    },
    {
      role: "reference_output",
      visibility: "private" as const,
      uri: "ipfs://QmHiddenJson",
      file_name: "reference_output.json",
      mime_type: "application/json",
    },
  ],
  submission_contract: {
    version: "v1" as const,
    kind: "opaque_file" as const,
    file: {
      extension: ".json",
      mime: "application/json",
      max_bytes: 1024,
    },
  },
});
assert.equal(executableJsonExactMatchSpec.success, true);
if (!executableJsonExactMatchSpec.success) {
  throw new Error("Expected executable JSON exact-match spec to parse");
}
const executableJsonExactMatchResolved = resolveChallengeEvaluation(
  executableJsonExactMatchSpec.data,
);
assert.equal(
  executableJsonExactMatchResolved.evaluationBundleCid,
  "ipfs://QmHiddenJson",
);
assert.equal(
  executableJsonExactMatchResolved.mount.evaluationBundleName,
  "ground_truth.json",
);
assert.equal(
  executableJsonExactMatchResolved.mount.submissionFileName,
  "submission.json",
);

const executableOpaqueExactMatchSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    preset_id: "exact_artifact_match",
    backend_kind: "preset_interpreter" as const,
    execution_runtime_family: "reproducibility",
    metric: "exact_match",
    scorer_image:
      `ghcr.io/andymolecule/gems-match-scorer@sha256:${"7".repeat(64)}`,
    evaluator_contract: {
      version: "v1",
      archetype: "exact_artifact_match",
      summary:
        "Compare a solver-uploaded PDF directly against a hidden reference document.",
      artifact_roles: {
        solver_visible: ["source_documents"],
        hidden: ["reference_output"],
      },
      submission: {
        kind: "opaque_file",
        schema_requirements: {
          expected_kind: "opaque_file",
        },
        validation_rules: ["Submission must be a deterministic PDF artifact."],
      },
      scoring: {
        metric: "exact_match",
        comparator: "maximize",
        deterministic_rule:
          "Compare the solver document byte-for-byte against the hidden reference output.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_exact_match_v1",
        evaluation_artifact_role: "reference_output",
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
  artifacts: [
    {
      role: "source_documents",
      visibility: "public" as const,
      uri: "ipfs://QmPublicPdf",
    },
    {
      role: "reference_output",
      visibility: "private" as const,
      uri: "ipfs://QmHiddenPdf",
      file_name: "reference_output.pdf",
      mime_type: "application/pdf",
    },
  ],
  submission_contract: {
    version: "v1" as const,
    kind: "opaque_file" as const,
    file: {
      extension: ".pdf",
      mime: "application/pdf",
      max_bytes: 1024,
    },
  },
});
assert.equal(executableOpaqueExactMatchSpec.success, true);
if (!executableOpaqueExactMatchSpec.success) {
  throw new Error("Expected executable opaque exact-match spec to parse");
}
const executableOpaqueExactMatchResolved = resolveChallengeEvaluation(
  executableOpaqueExactMatchSpec.data,
);
assert.equal(
  executableOpaqueExactMatchResolved.evaluationBundleCid,
  "ipfs://QmHiddenPdf",
);
assert.equal(
  executableOpaqueExactMatchResolved.mount.evaluationBundleName,
  "ground_truth.bin",
);
assert.equal(
  executableOpaqueExactMatchResolved.mount.submissionFileName,
  "submission.bin",
);

const generatedExactMatchProgram =
  buildGeneratedScorerProgramFromDefinitionBackedEvaluator({
    version: "v1",
    archetype: "exact_artifact_match",
    summary: "Compare JSON submissions directly against a hidden reference file.",
    artifact_roles: {
      solver_visible: ["source_data"],
      hidden: ["reference_output"],
    },
    submission: {
      kind: "json_file",
      schema_requirements: null,
      validation_rules: ["Submission must be valid JSON."],
    },
    scoring: {
      metric: "exact_match",
      comparator: "maximize",
      deterministic_rule: "JSON must match exactly.",
      minimum_threshold: null,
    },
    execution: {
      template: "official_exact_match_v1",
      evaluation_artifact_role: "reference_output",
      policies: {
        coverage_policy: "reject",
        duplicate_id_policy: "reject",
        invalid_value_policy: "reject",
      },
    },
    notes: [],
  });
if (!generatedExactMatchProgram) {
  throw new Error("Expected generated exact-match program");
}

const generatedExactMatchSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    preset_id: "exact_artifact_match",
    backend_kind: "generated_scorer" as const,
    execution_runtime_family: "reproducibility",
    metric: "exact_match",
    generated_scorer: generatedExactMatchProgram,
    evaluator_contract: {
      version: "v1",
      archetype: "exact_artifact_match",
      summary:
        "Compare a JSON solver output directly against a hidden reference document.",
      artifact_roles: {
        solver_visible: ["source_data"],
        hidden: ["reference_output"],
      },
      submission: {
        kind: "json_file",
        schema_requirements: null,
        validation_rules: ["Submission must be valid JSON."],
      },
      scoring: {
        metric: "exact_match",
        comparator: "maximize",
        deterministic_rule:
          "Compare the submission JSON directly against the hidden reference output.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_exact_match_v1",
        evaluation_artifact_role: "reference_output",
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
  artifacts: [
    {
      role: "source_data",
      visibility: "public" as const,
      uri: "ipfs://QmJsonInput",
    },
    {
      role: "reference_output",
      visibility: "private" as const,
      uri: "ipfs://QmHiddenJson",
      file_name: "reference_output.json",
      mime_type: "application/json",
    },
  ],
  submission_contract: {
    version: "v1" as const,
    kind: "opaque_file" as const,
    file: {
      extension: ".json",
      mime: "application/json",
      max_bytes: 1024 * 1024,
    },
  },
});
assert.equal(generatedExactMatchSpec.success, true);
if (!generatedExactMatchSpec.success) {
  throw new Error("Expected generated exact-match spec to parse");
}
assert.equal(
  validateChallengeScoreability(generatedExactMatchSpec.data).ok,
  true,
  "generated scorer specs should be scoreable",
);

const missingBundleParse = challengeSpecSchema.safeParse({
  ...sample,
  evaluation: {
    ...sample.evaluation,
    evaluation_bundle: undefined,
  },
});
assert.equal(
  missingBundleParse.success,
  false,
  "managed presets should require an evaluation bundle",
);

const yamlDocument = `
schema_version: 4
id: ch-yaml
title: YAML challenge
domain: omics
type: prediction
description: Parse from pinned YAML
evaluation:
  preset_id: tabular_regression
  backend_kind: preset_interpreter
  execution_runtime_family: tabular_regression
  metric: r2
  evaluation_bundle: ipfs://QmHiddenLabels
artifacts:
  - role: training_data
    visibility: public
    uri: ipfs://QmTrain
submission_contract:
  version: v1
  kind: csv_table
  file:
    extension: .csv
    mime: text/csv
    max_bytes: 10485760
  columns:
    required: [id, prediction]
    id: id
    value: prediction
    allow_extra: true
reward:
  total: "5"
  distribution: winner_take_all
deadline: 2026-03-20T00:00:00Z
`;
const parsedYaml = challengeSpecSchema.safeParse(
  parseChallengeSpecDocument(yamlDocument),
);
assert.equal(
  parsedYaml.success,
  true,
  "pinned YAML specs should parse through the canonical schema",
);

console.log("challengeSpecSchema validation passed");
