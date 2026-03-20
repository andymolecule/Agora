import assert from "node:assert/strict";
import {
  buildChallengeSpecDraft,
  defaultMinimumScoreForChallengeType,
  defaultMinimumScoreForEvaluation,
  defaultPresetIdForChallengeType,
  getChallengeCompatibilityType,
  getChallengeCompatibilityTypeFromEvaluation,
  getChallengeTypeTemplate,
} from "../challenges/index.js";

const predictionTemplate = getChallengeTypeTemplate("prediction");
assert.equal(predictionTemplate.defaultPresetId, "tabular_regression");
assert.equal(predictionTemplate.defaultBackendKind, "generated_scorer");

const reproducibilitySpec = buildChallengeSpecDraft({
  id: "draft-001",
  title: "Reproduce assay summary",
  domain: "omics",
  type: "reproducibility",
  description: "Reproduce the shared assay artifact.",
  artifacts: [
    {
      role: "source_data",
      visibility: "public",
      uri: "ipfs://QmTrain",
    },
    {
      role: "reference_output",
      visibility: "private",
      uri: "ipfs://QmExpected",
    },
  ],
  evaluationBundle: "ipfs://QmExpected",
  reward: {
    total: "25",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
  submission: {
    type: "reproducibility",
    requiredColumns: ["sample_id", "value"],
  },
});

assert.equal(reproducibilitySpec.schema_version, 4);
assert.equal(reproducibilitySpec.evaluation.preset_id, "reproducibility");
assert.equal(reproducibilitySpec.evaluation.backend_kind, "generated_scorer");
assert.equal(
  reproducibilitySpec.evaluation.execution_runtime_family,
  "reproducibility",
);
assert.equal(
  reproducibilitySpec.evaluation.generated_scorer?.evaluation_artifact_role,
  "reference_output",
);
assert.equal(reproducibilitySpec.submission_contract.kind, "csv_table");
assert.equal(
  "evaluation_bundle" in reproducibilitySpec.evaluation,
  false,
);

const dockingSpec = buildChallengeSpecDraft({
  id: "draft-003",
  title: "Rank ligands against a kinase pocket",
  domain: "drug_discovery",
  type: "docking",
  description: "Rank ligands by predicted binding strength.",
  artifacts: [
    {
      role: "target_structure",
      visibility: "public",
      uri: "ipfs://QmTarget",
    },
    {
      role: "ligand_library",
      visibility: "public",
      uri: "ipfs://QmLigands",
    },
    {
      role: "reference_scores",
      visibility: "private",
      uri: "ipfs://QmReferenceScores",
    },
  ],
  evaluationBundle: "ipfs://QmReferenceScores",
  reward: {
    total: "75",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
  submission: {
    type: "docking",
  },
});

assert.equal(dockingSpec.evaluation.preset_id, "docking");
assert.equal(dockingSpec.submission_contract.kind, "csv_table");
assert.equal(dockingSpec.submission_contract.columns.id, "ligand_id");
assert.equal(dockingSpec.submission_contract.columns.value, "docking_score");

const customSpec = buildChallengeSpecDraft({
  id: "draft-002",
  title: "Custom protocol",
  domain: "other",
  type: "custom",
  description: "Bring your own container.",
  artifacts: [
    {
      role: "public_input",
      visibility: "public",
      uri: "ipfs://QmPublicInput",
    },
  ],
  presetId: "custom",
  backendKind: "oci_image",
  scorerImage: "ghcr.io/acme/custom-scorer@sha256:1234",
  metric: "custom",
  reward: {
    total: "50",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
  submission: {
    type: "custom",
    extension: ".json",
    mime: "application/json",
  },
});

assert.equal(customSpec.submission_contract.kind, "opaque_file");

const definitionSpec = buildChallengeSpecDraft({
  id: "draft-004",
  title: "Deterministic JSON report judge",
  domain: "other",
  type: "custom",
  description: "Score solver JSON reports with a typed evaluator contract.",
  artifacts: [
    {
      role: "public_prompt",
      visibility: "public",
      uri: "ipfs://QmPrompt",
    },
    {
      role: "hidden_rubric",
      visibility: "private",
      uri: "ipfs://QmRubric",
    },
  ],
  presetId: "structured_record_score",
  backendKind: "definition_only",
  metric: "validation_score",
  evaluatorContract: {
    version: "v1",
    archetype: "structured_record_score",
    summary: "Validate a JSON report against a deterministic rubric.",
    artifact_roles: {
      solver_visible: ["public_prompt"],
      hidden: ["hidden_rubric"],
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
        "Score the JSON report against the hidden rubric and rank by the resulting validation score.",
      minimum_threshold: null,
    },
    notes: [
      "Execution path configured separately from the evaluator contract.",
    ],
  },
  reward: {
    total: "40",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
  submission: {
    type: "custom",
    extension: ".json",
    mime: "application/json",
  },
});

assert.equal(definitionSpec.evaluation.preset_id, "structured_record_score");
assert.equal(definitionSpec.evaluation.backend_kind, "definition_only");
assert.equal("scorer_image" in definitionSpec.evaluation, false);
assert.equal(
  definitionSpec.evaluation.evaluator_contract?.archetype,
  "structured_record_score",
);
assert.equal(
  defaultPresetIdForChallengeType("prediction"),
  "tabular_regression",
);
assert.equal(defaultPresetIdForChallengeType("docking"), "docking");
assert.equal(defaultMinimumScoreForChallengeType("prediction"), 0);
assert.equal(
  getChallengeCompatibilityType({
    presetId: "tabular_regression",
    backendKind: "generated_scorer",
  }),
  "prediction",
);
assert.equal(
  getChallengeCompatibilityType({
    presetId: "ranking",
    backendKind: "preset_interpreter",
  }),
  "optimization",
);
assert.equal(
  getChallengeCompatibilityTypeFromEvaluation(definitionSpec.evaluation),
  "custom",
);
assert.equal(defaultMinimumScoreForEvaluation(definitionSpec.evaluation), 0);

console.log("challenge templates validation passed");
