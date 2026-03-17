import assert from "node:assert/strict";
import {
  canonicalizeChallengeSpec,
  challengeSpecSchema,
  resolveChallengeEvaluation,
  validateChallengeScoreability,
  validateChallengeSpec,
} from "../schemas/challenge-spec.js";

const sample = {
  schema_version: 3,
  id: "ch-001",
  title: "Predict assay response",
  domain: "omics",
  type: "prediction",
  description: "Predict the held-out labels.",
  evaluation: {
    runtime_family: "tabular_regression",
    metric: "r2",
    scorer_image: "ghcr.io/placeholder/will-be-overridden:v1",
    evaluation_bundle: "ipfs://QmHiddenLabels",
  },
  artifacts: [
    {
      role: "training_data",
      visibility: "public",
      uri: "ipfs://QmTrain",
      file_name: "train.csv",
    },
    {
      role: "evaluation_features",
      visibility: "public",
      uri: "ipfs://QmTest",
      file_name: "test.csv",
    },
    {
      role: "hidden_labels",
      visibility: "private",
      uri: "ipfs://QmHiddenLabels",
      file_name: "hidden_labels.csv",
    },
  ],
  submission_contract: {
    version: "v1",
    kind: "csv_table",
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
    distribution: "winner_take_all",
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
assert.equal(resolved.runtimeFamily, "tabular_regression");
assert.equal(resolved.metric, "r2");
assert.equal(resolved.evaluationBundleCid, "ipfs://QmHiddenLabels");

const scoreability = validateChallengeScoreability(result.data);
assert.equal(scoreability.ok, true, "sample spec should be scoreable");

const canonicalized = await canonicalizeChallengeSpec(result.data, {
  resolveOfficialPresetDigests: false,
});
assert.equal(
  canonicalized.evaluation.scorer_image,
  "ghcr.io/andymolecule/regression-scorer:v1",
  "managed challenges should canonicalize their scorer image from the registry",
);

const invalidMetric = challengeSpecSchema.safeParse({
  ...sample,
  evaluation: {
    ...sample.evaluation,
    metric: "accuracy",
  },
});
assert.equal(invalidMetric.success, false, "unsupported metric should fail");

const expertSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    runtime_family: "expert_custom",
    metric: "custom",
    scorer_image: "ghcr.io/acme/expert@sha256:1234",
  },
});
assert.equal(expertSpec.success, true, "expert spec should accept pinned digests");

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
  "managed runtime families should require an evaluation bundle",
);

console.log("challengeSpecSchema validation passed");
