import {
  challengeSpecSchema,
  resolveEvalSpec,
  validateChallengeScoreability,
} from "../schemas/challenge-spec";

const sample = {
  id: "ch-001",
  preset_id: "csv_comparison_v1",
  title: "Reproduce Figure 3 from Gladyshev 2024 longevity clock",
  domain: "longevity",
  type: "reproducibility",
  description: "Reproduce the main figure from the paper.",
  dataset: {
    train: "ipfs://QmTrain",
    test: "ipfs://QmTest",
  },
  scoring: {
    container: "ghcr.io/hermes-science/repro-scorer:v1",
    metric: "custom",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
};

const result = challengeSpecSchema.safeParse(sample);
if (!result.success) {
  console.error(result.error.format());
  process.exit(1);
}

if (result.data.preset_id !== "csv_comparison_v1") {
  console.error("preset_id should be preserved by challengeSpecSchema");
  process.exit(1);
}

const invalidLimits = challengeSpecSchema.safeParse({
  ...sample,
  id: "ch-002",
  max_submissions_total: 2,
  max_submissions_per_solver: 3,
});
if (invalidLimits.success) {
  console.error(
    "max_submissions_per_solver > max_submissions_total should fail validation",
  );
  process.exit(1);
}

// --- Test eval_spec field ---

const sampleWithEvalSpec = {
  ...sample,
  id: "ch-003",
  eval_spec: {
    engine_id: "csv_comparison_v1",
    engine_digest: "ghcr.io/hermes-science/repro-scorer@sha256:abc123",
    evaluation_bundle: "ipfs://QmEvalBundle",
  },
};

const evalResult = challengeSpecSchema.safeParse(sampleWithEvalSpec);
if (!evalResult.success) {
  console.error("eval_spec should be accepted:", evalResult.error.format());
  process.exit(1);
}

if (evalResult.data.eval_spec?.engine_id !== "csv_comparison_v1") {
  console.error("eval_spec.engine_id should be preserved");
  process.exit(1);
}

// --- Test resolveEvalSpec with eval_spec ---
const resolvedNew = resolveEvalSpec(evalResult.data);
if (resolvedNew.engineId !== "csv_comparison_v1") {
  console.error("resolveEvalSpec should use eval_spec.engine_id");
  process.exit(1);
}
if (resolvedNew.evaluationBundle !== "ipfs://QmEvalBundle") {
  console.error("resolveEvalSpec should use eval_spec.evaluation_bundle");
  process.exit(1);
}

// --- Test resolveEvalSpec with legacy fields ---
const resolvedLegacy = resolveEvalSpec(result.data);
if (resolvedLegacy.engineId !== "csv_comparison_v1") {
  console.error("resolveEvalSpec should fall back to preset_id");
  process.exit(1);
}
if (resolvedLegacy.evaluationBundle !== "ipfs://QmTest") {
  console.error("resolveEvalSpec should fall back to dataset.test");
  process.exit(1);
}
if (resolvedLegacy.scoringContainer !== "ghcr.io/hermes-science/repro-scorer:v1") {
  console.error("resolveEvalSpec should use scoring.container");
  process.exit(1);
}

const predictionHiddenLabelsOnly = challengeSpecSchema.safeParse({
  id: "ch-004",
  title: "Prediction hidden labels only",
  domain: "omics",
  type: "prediction",
  description: "Prediction challenge with hidden labels only.",
  dataset: {
    hidden_labels: "ipfs://QmHiddenLabels",
  },
  scoring: {
    container: "ghcr.io/hermes-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
if (!predictionHiddenLabelsOnly.success) {
  console.error(
    "prediction spec should accept dataset.hidden_labels as evaluation bundle input:",
    predictionHiddenLabelsOnly.error.format(),
  );
  process.exit(1);
}

const resolvedPredictionHiddenLabels = resolveEvalSpec(
  predictionHiddenLabelsOnly.data,
);
if (resolvedPredictionHiddenLabels.evaluationBundle !== "ipfs://QmHiddenLabels") {
  console.error("resolveEvalSpec should use dataset.hidden_labels for prediction specs");
  process.exit(1);
}
const predictionScoreability = validateChallengeScoreability(
  predictionHiddenLabelsOnly.data,
);
if (!predictionScoreability.ok) {
  console.error(
    "validateChallengeScoreability should accept prediction challenges with hidden_labels only",
    predictionScoreability.errors,
  );
  process.exit(1);
}

const predictionTestOnly = challengeSpecSchema.safeParse({
  id: "ch-004b",
  title: "Prediction test dataset only",
  domain: "omics",
  type: "prediction",
  description: "Prediction challenge with dataset.test only.",
  dataset: {
    test: "ipfs://QmPredictionTest",
  },
  scoring: {
    container: "ghcr.io/hermes-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
if (!predictionTestOnly.success) {
  console.error("prediction spec should still accept dataset.test as the evaluation bundle fallback");
  process.exit(1);
}

const resolvedPredictionTestOnly = resolveEvalSpec(predictionTestOnly.data);
if (resolvedPredictionTestOnly.evaluationBundle !== "ipfs://QmPredictionTest") {
  console.error("resolveEvalSpec should fall back to dataset.test for prediction specs");
  process.exit(1);
}

const predictionMissingEvalBundle = challengeSpecSchema.safeParse({
  id: "ch-005",
  title: "Prediction missing eval bundle",
  domain: "omics",
  type: "prediction",
  description: "Prediction challenge without a scoreable bundle.",
  scoring: {
    container: "ghcr.io/hermes-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
if (predictionMissingEvalBundle.success) {
  console.error("prediction spec should require evaluation_bundle, hidden_labels, or dataset.test");
  process.exit(1);
}

const predictionMatchingEvalBundle = challengeSpecSchema.safeParse({
  id: "ch-006",
  title: "Prediction matching hidden labels and eval bundle",
  domain: "omics",
  type: "prediction",
  description: "Prediction challenge with matching aliases.",
  dataset: {
    hidden_labels: "ipfs://QmSharedBundle",
    test: "ipfs://QmLegacyTest",
  },
  eval_spec: {
    engine_id: "regression_v1",
    evaluation_bundle: "ipfs://QmSharedBundle",
  },
  scoring: {
    container: "ghcr.io/hermes-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
if (!predictionMatchingEvalBundle.success) {
  console.error("matching prediction eval bundle aliases should pass validation");
  process.exit(1);
}

const resolvedPredictionEvalBundle = resolveEvalSpec(predictionMatchingEvalBundle.data);
if (resolvedPredictionEvalBundle.evaluationBundle !== "ipfs://QmSharedBundle") {
  console.error("resolveEvalSpec should prefer eval_spec.evaluation_bundle for prediction specs");
  process.exit(1);
}

const predictionMismatchedEvalBundle = challengeSpecSchema.safeParse({
  id: "ch-007",
  title: "Prediction mismatched hidden labels and eval bundle",
  domain: "omics",
  type: "prediction",
  description: "Prediction challenge with conflicting aliases.",
  dataset: {
    hidden_labels: "ipfs://QmHiddenLabelsOnly",
  },
  eval_spec: {
    engine_id: "regression_v1",
    evaluation_bundle: "ipfs://QmDifferentBundle",
  },
  scoring: {
    container: "ghcr.io/hermes-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
if (predictionMismatchedEvalBundle.success) {
  console.error("prediction spec should reject mismatched hidden_labels and eval_spec.evaluation_bundle");
  process.exit(1);
}

const reproducibilityMissingBundle = challengeSpecSchema.parse({
  id: "ch-008",
  title: "Reproducibility missing bundle",
  domain: "longevity",
  type: "reproducibility",
  description: "Repro challenge without an evaluation bundle.",
  scoring: {
    container: "ghcr.io/hermes-science/repro-scorer:v1",
    metric: "custom",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
const reproducibilityScoreability = validateChallengeScoreability(
  reproducibilityMissingBundle,
);
if (reproducibilityScoreability.ok) {
  console.error(
    "validateChallengeScoreability should reject reproducibility challenges without an evaluation bundle",
  );
  process.exit(1);
}
if (
  reproducibilityScoreability.errors[0] !==
  "Reproducibility challenges require an evaluation bundle."
) {
  console.error(
    "validateChallengeScoreability should return a clear reproducibility error",
    reproducibilityScoreability.errors,
  );
  process.exit(1);
}

const customPinnedScoreability = validateChallengeScoreability(
  challengeSpecSchema.parse({
    id: "ch-009",
    title: "Custom pinned scorer",
    domain: "other",
    type: "custom",
    description: "Custom challenge with pinned scorer image.",
    scoring: {
      container: "ghcr.io/acme/custom-scorer@sha256:" + "a".repeat(64),
      metric: "custom",
    },
    reward: {
      total: 10,
      distribution: "winner_take_all",
    },
    deadline: "2026-03-04T23:59:59Z",
    dispute_window_hours: 168,
  }),
);
if (!customPinnedScoreability.ok) {
  console.error(
    "validateChallengeScoreability should accept custom challenges with a pinned scorer image",
    customPinnedScoreability.errors,
  );
  process.exit(1);
}

console.log("challengeSpecSchema validation passed");
