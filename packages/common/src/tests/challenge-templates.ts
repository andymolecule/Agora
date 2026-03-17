import assert from "node:assert/strict";
import {
  buildChallengeSpecDraft,
  defaultMinimumScoreForChallengeType,
  defaultRuntimeFamilyForChallengeType,
  getChallengeTypeTemplate,
} from "../challenges/index.js";

const predictionTemplate = getChallengeTypeTemplate("prediction");
assert.equal(
  predictionTemplate.defaultRuntimeFamily,
  "tabular_regression",
);

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
assert.equal(
  defaultRuntimeFamilyForChallengeType("prediction"),
  "tabular_regression",
);
assert.equal(defaultRuntimeFamilyForChallengeType("docking"), "docking");
assert.equal(defaultMinimumScoreForChallengeType("prediction"), 0);

console.log("challenge templates validation passed");
