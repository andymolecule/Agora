import assert from "node:assert/strict";
import {
  buildGeneratedScorerProgramForManagedPreset,
  buildGeneratedScorerProgramFromDefinitionBackedEvaluator,
  challengeSpecSchema,
  createCsvTableEvaluationContract,
  createCsvTableSubmissionContract,
  createDefinitionBackedBundleManifestExecution,
  createDefinitionBackedExactArtifactMatchExecution,
  createDefinitionBackedEvaluatorContract,
  createDefinitionBackedStructuredTableExecution,
  createOpaqueFileSubmissionContract,
  createRuntimePolicies,
  resolveEvaluationPlan,
  type ChallengeEvalRow,
} from "../index.js";

const managedSpec = challengeSpecSchema.parse({
  schema_version: 4,
  id: "managed-plan",
  title: "Managed plan",
  domain: "omics",
  type: "prediction",
  description: "managed",
  evaluation: {
    preset_id: "tabular_regression",
    backend_kind: "preset_interpreter",
    execution_runtime_family: "tabular_regression",
    metric: "r2",
    evaluation_bundle: "ipfs://QmHiddenLabels",
  },
  artifacts: [
    {
      role: "training_data",
      visibility: "public",
      uri: "ipfs://QmTrain",
    },
    {
      role: "hidden_labels",
      visibility: "private",
      uri: "ipfs://QmHiddenLabels",
    },
  ],
  submission_contract: createCsvTableSubmissionContract({
    requiredColumns: ["id", "prediction"],
    idColumn: "id",
    valueColumn: "prediction",
  }),
  reward: {
    total: "5",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
});

const managedPlan = resolveEvaluationPlan(managedSpec);
assert.equal(managedPlan.backendKind, "preset_interpreter");
assert.equal(managedPlan.presetId, "tabular_regression");
assert.equal(
  managedPlan.image,
  "ghcr.io/andymolecule/gems-tabular-scorer:v1",
);
assert.equal(managedPlan.executionRuntimeFamily, "tabular_regression");
assert.equal(managedPlan.evaluationBundleCid, "ipfs://QmHiddenLabels");
assert.equal(managedPlan.submissionContract?.kind, "csv_table");
assert.equal(managedPlan.evaluationContract?.columns.id, "id");

const managedGeneratedSpec = challengeSpecSchema.parse({
  ...managedSpec,
  id: "managed-generated-plan",
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

const managedGeneratedPlan = resolveEvaluationPlan(managedGeneratedSpec);
assert.equal(managedGeneratedPlan.backendKind, "generated_scorer");
assert.equal(managedGeneratedPlan.presetId, "tabular_regression");
assert.equal(
  managedGeneratedPlan.image,
  "ghcr.io/andymolecule/gems-generated-scorer:v1",
);
assert.equal(
  managedGeneratedPlan.executionRuntimeFamily,
  "tabular_regression",
);
assert.equal(managedGeneratedPlan.evaluationBundleCid, "ipfs://QmHiddenLabels");
assert.equal(managedGeneratedPlan.evaluationArtifactRole, "hidden_labels");

const definitionBackedContract = createDefinitionBackedEvaluatorContract({
  archetype: "structured_table_score",
  summary: "Score CSV predictions against hidden labels.",
  solverVisibleArtifactRoles: ["training_data"],
  hiddenArtifactRoles: ["hidden_labels"],
  submissionKind: "csv_table",
  schemaRequirements: {
    suggested_columns: ["id", "prediction"],
  },
  metric: "accuracy",
  comparator: "maximize",
  deterministicRule: "Join by id and compute deterministic accuracy.",
  execution: createDefinitionBackedStructuredTableExecution({
    evaluationArtifactRole: "hidden_labels",
    evaluationContract: createCsvTableEvaluationContract({
      requiredColumns: ["id", "label"],
      idColumn: "id",
      valueColumn: "label",
    }),
    policies: createRuntimePolicies({
      coveragePolicy: "reject",
      duplicateIdPolicy: "reject",
      invalidValuePolicy: "reject",
    }),
  }),
});

const definitionBackedSpec = challengeSpecSchema.parse({
  schema_version: 4,
  id: "definition-plan",
  title: "Definition-backed plan",
  domain: "other",
  type: "custom",
  description: "definition backed",
  evaluation: {
    preset_id: "structured_table_score",
    backend_kind: "preset_interpreter",
    execution_runtime_family: "tabular_classification",
    metric: "accuracy",
    scorer_image: `ghcr.io/andymolecule/gems-tabular-scorer@sha256:${"a".repeat(64)}`,
    evaluator_contract: definitionBackedContract,
  },
  artifacts: [
    {
      role: "training_data",
      visibility: "public",
      uri: "ipfs://QmTrain",
    },
    {
      role: "hidden_labels",
      visibility: "private",
      uri: "ipfs://QmHiddenLabels",
    },
  ],
  submission_contract: createCsvTableSubmissionContract({
    requiredColumns: ["id", "prediction"],
    idColumn: "id",
    valueColumn: "prediction",
  }),
  reward: {
    total: "5",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
});

const definitionBackedPlan = resolveEvaluationPlan(definitionBackedSpec);
assert.equal(definitionBackedPlan.backendKind, "preset_interpreter");
assert.equal(definitionBackedPlan.presetId, "structured_table_score");
assert.equal(
  definitionBackedPlan.executionRuntimeFamily,
  "tabular_classification",
);
assert.equal(
  definitionBackedPlan.executionTemplate,
  "official_table_metric_v1",
);

const generatedExactMatchContract = createDefinitionBackedEvaluatorContract({
  archetype: "exact_artifact_match",
  summary: "Compare a JSON submission directly against a hidden reference file.",
  solverVisibleArtifactRoles: ["source_data"],
  hiddenArtifactRoles: ["reference_output"],
  submissionKind: "json_file",
  metric: "exact_match",
  comparator: "maximize",
  deterministicRule:
    "Compare the submission JSON exactly to the hidden reference JSON.",
  execution: createDefinitionBackedExactArtifactMatchExecution({
    evaluationArtifactRole: "reference_output",
  }),
});

const generatedProgram = buildGeneratedScorerProgramFromDefinitionBackedEvaluator(
  generatedExactMatchContract,
);
assert.ok(generatedProgram);
if (!generatedProgram) {
  throw new Error("Expected generated exact-match program");
}
assert.equal(generatedProgram?.runtime_family, "reproducibility");

const generatedSpec = challengeSpecSchema.parse({
  schema_version: 4,
  id: "generated-plan",
  title: "Generated plan",
  domain: "other",
  type: "custom",
  description: "generated scorer",
  evaluation: {
    preset_id: "exact_artifact_match",
    backend_kind: "generated_scorer",
    execution_runtime_family: "reproducibility",
    metric: "exact_match",
    generated_scorer: generatedProgram,
    evaluator_contract: generatedExactMatchContract,
  },
  artifacts: [
    {
      role: "source_data",
      visibility: "public",
      uri: "ipfs://QmSource",
    },
    {
      role: "reference_output",
      visibility: "private",
      uri: "ipfs://QmReference",
    },
  ],
  submission_contract: createOpaqueFileSubmissionContract({
    extension: ".json",
    mime: "application/json",
  }),
  reward: {
    total: "5",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
});

const generatedPlan = resolveEvaluationPlan(generatedSpec);
assert.equal(generatedPlan.backendKind, "generated_scorer");
assert.equal(
  generatedPlan.image,
  "ghcr.io/andymolecule/gems-generated-scorer:v1",
);
assert.equal(generatedPlan.executionRuntimeFamily, "reproducibility");
assert.equal(generatedPlan.evaluationBundleCid, "ipfs://QmReference");
assert.equal(generatedPlan.generatedScorer?.language, "python");
assert.equal(definitionBackedPlan.evaluationArtifactRole, "hidden_labels");
assert.equal(definitionBackedPlan.evaluationBundleCid, "ipfs://QmHiddenLabels");
assert.equal(
  definitionBackedPlan.image,
  `ghcr.io/andymolecule/gems-tabular-scorer@sha256:${"a".repeat(64)}`,
);

const bundleManifestContract = createDefinitionBackedEvaluatorContract({
  archetype: "bundle_or_code_judge",
  summary: "Validate a submitted zip bundle against a hidden manifest.",
  solverVisibleArtifactRoles: ["public_inputs"],
  hiddenArtifactRoles: ["hidden_reference"],
  submissionKind: "bundle_or_code",
  schemaRequirements: {
    expected_extension: ".zip",
    expected_mime: "application/zip",
  },
  metric: "validation_score",
  comparator: "maximize",
  deterministicRule:
    "Check that the submitted bundle contains the required files and no forbidden files.",
  execution: createDefinitionBackedBundleManifestExecution({
    evaluationArtifactRole: "hidden_reference",
  }),
});

const bundleManifestProgram =
  buildGeneratedScorerProgramFromDefinitionBackedEvaluator(
    bundleManifestContract,
  );
assert.ok(bundleManifestProgram);
if (!bundleManifestProgram) {
  throw new Error("Expected generated bundle manifest program");
}
assert.equal(bundleManifestProgram.runtime_family, "bundle_or_code_judge");

const bundleManifestSpec = challengeSpecSchema.parse({
  schema_version: 4,
  id: "bundle-manifest-plan",
  title: "Bundle manifest plan",
  domain: "other",
  type: "custom",
  description: "generated bundle manifest scorer",
  evaluation: {
    preset_id: "bundle_or_code_judge",
    backend_kind: "generated_scorer",
    execution_runtime_family: "bundle_or_code_judge",
    metric: "validation_score",
    generated_scorer: bundleManifestProgram,
    evaluator_contract: bundleManifestContract,
  },
  artifacts: [
    {
      role: "public_inputs",
      visibility: "public",
      uri: "ipfs://QmPublicInputs",
    },
    {
      role: "hidden_reference",
      visibility: "private",
      uri: "ipfs://QmBundleRubric",
    },
  ],
  submission_contract: createOpaqueFileSubmissionContract({
    extension: ".zip",
    mime: "application/zip",
  }),
  reward: {
    total: "5",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
});

const bundleManifestPlan = resolveEvaluationPlan(bundleManifestSpec);
assert.equal(bundleManifestPlan.backendKind, "generated_scorer");
assert.equal(bundleManifestPlan.executionRuntimeFamily, "bundle_or_code_judge");
assert.equal(bundleManifestPlan.evaluationBundleCid, "ipfs://QmBundleRubric");
assert.equal(bundleManifestPlan.mount.evaluationBundleName, "judge_rubric.json");
assert.equal(bundleManifestPlan.mount.submissionFileName, "submission.zip");

const expertSpec = challengeSpecSchema.parse({
  schema_version: 4,
  id: "expert-plan",
  title: "Expert plan",
  domain: "other",
  type: "custom",
  description: "expert custom",
  evaluation: {
    preset_id: "custom",
    backend_kind: "oci_image",
    metric: "custom",
    scorer_image: `ghcr.io/acme/custom-scorer@sha256:${"b".repeat(64)}`,
  },
  artifacts: [
    {
      role: "public_input",
      visibility: "public",
      uri: "ipfs://QmPublicInput",
    },
  ],
  submission_contract: createOpaqueFileSubmissionContract({
    extension: ".json",
    mime: "application/json",
  }),
  reward: {
    total: "5",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
});

const expertPlan = resolveEvaluationPlan(expertSpec);
assert.equal(expertPlan.backendKind, "oci_image");
assert.equal(expertPlan.presetId, "custom");
assert.equal(
  expertPlan.image,
  `ghcr.io/acme/custom-scorer@sha256:${"b".repeat(64)}`,
);
assert.equal(expertPlan.limits, undefined);

assert.throws(
  () =>
    resolveEvaluationPlan({
      evaluation_plan_json: null,
    } satisfies ChallengeEvalRow),
  /evaluation_plan_json/i,
);

console.log("evaluation plan resolution passed");
