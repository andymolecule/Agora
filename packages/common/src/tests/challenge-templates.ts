import assert from "node:assert/strict";
import {
  buildChallengeSpecDraft,
  defaultMinimumScoreForChallengeType,
  defaultMinimumScoreForEvaluation,
  defaultRuntimeFamilyForChallengeType,
  getChallengeCompatibilityType,
  getChallengeCompatibilityTypeFromEvaluation,
  getChallengeTypeTemplate,
} from "../challenges/index.js";

const predictionTemplate = getChallengeTypeTemplate("prediction");
assert.equal(predictionTemplate.defaultRuntimeFamily, "tabular_regression");

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

assert.equal(reproducibilitySpec.schema_version, 3);
assert.equal(reproducibilitySpec.evaluation.runtime_family, "reproducibility");
assert.equal(reproducibilitySpec.submission_contract.kind, "csv_table");

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

assert.equal(dockingSpec.evaluation.runtime_family, "docking");
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
  runtimeFamily: "expert_custom",
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

const semiCustomSpec = buildChallengeSpecDraft({
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
  runtimeFamily: "semi_custom",
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

assert.equal(semiCustomSpec.evaluation.runtime_family, "semi_custom");
assert.equal("scorer_image" in semiCustomSpec.evaluation, false);
assert.equal(
  semiCustomSpec.evaluation.evaluator_contract?.archetype,
  "structured_record_score",
);
assert.equal(
  defaultRuntimeFamilyForChallengeType("prediction"),
  "tabular_regression",
);
assert.equal(defaultRuntimeFamilyForChallengeType("docking"), "docking");
assert.equal(defaultMinimumScoreForChallengeType("prediction"), 0);
assert.equal(
  getChallengeCompatibilityType({
    runtimeFamily: "tabular_regression",
  }),
  "prediction",
);
assert.equal(
  getChallengeCompatibilityType({
    runtimeFamily: "ranking",
  }),
  "optimization",
);
assert.equal(
  getChallengeCompatibilityTypeFromEvaluation(semiCustomSpec.evaluation),
  "custom",
);
assert.equal(defaultMinimumScoreForEvaluation(semiCustomSpec.evaluation), 0);

console.log("challenge templates validation passed");
