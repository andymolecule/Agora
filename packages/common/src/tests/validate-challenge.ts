import { challengeSpecSchema, resolveEvalSpec } from "../schemas/challenge-spec";

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

console.log("challengeSpecSchema validation passed");
