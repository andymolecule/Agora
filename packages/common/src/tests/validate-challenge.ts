import { challengeSpecSchema } from "../schemas/challenge-spec";

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

console.log("challengeSpecSchema validation passed");
