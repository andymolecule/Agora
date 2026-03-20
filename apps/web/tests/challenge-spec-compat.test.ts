import assert from "node:assert/strict";
import test from "node:test";
import { hydrateChallengeSpec } from "../src/lib/api";

test("hydrateChallengeSpec accepts current specs", () => {
  const spec = hydrateChallengeSpec({
    schema_version: 4,
    id: "current-1",
    title: "Current spec",
    domain: "other",
    type: "reproducibility",
    description: "Pinned with the current schema",
    evaluation: {
      preset_id: "reproducibility",
      backend_kind: "preset_interpreter",
      execution_runtime_family: "reproducibility",
      metric: "exact_match",
      scorer_image: "ghcr.io/andymolecule/gems-match-scorer:v1",
      evaluation_bundle: "ipfs://test",
    },
    artifacts: [
      {
        role: "source_data",
        visibility: "public",
        uri: "ipfs://train",
      },
      {
        role: "reference_output",
        visibility: "public",
        uri: "ipfs://test",
      },
    ],
    submission_contract: {
      version: "v1",
      kind: "csv_table",
      file: {
        extension: ".csv",
        mime: "text/csv",
        max_bytes: 25_000_000,
      },
      columns: {
        required: ["sample_id", "normalized_signal", "condition"],
        allow_extra: true,
      },
    },
    reward: {
      total: "21",
      distribution: "winner_take_all",
    },
    deadline: "2026-03-20T00:00:00.000Z",
  });

  assert.equal(spec.submission_contract.kind, "csv_table");
  if (spec.submission_contract.kind !== "csv_table") {
    return;
  }
  assert.deepEqual(spec.submission_contract.columns.required, [
    "sample_id",
    "normalized_signal",
    "condition",
  ]);
});

test("hydrateChallengeSpec rejects malformed historical specs with a clear error", () => {
  assert.throws(
    () =>
      hydrateChallengeSpec({
        schema_version: 2,
        id: "legacy-repro-without-columns",
        title: "Legacy repro spec",
        domain: "other",
        type: "reproducibility",
        description: "Pinned before submission_contract was added",
        scoring: {
          container: "ghcr.io/andymolecule/gems-match-scorer:v1",
          metric: "custom",
        },
        reward: {
          total: 21,
          distribution: "winner_take_all",
        },
        deadline: "2026-03-20T00:00:00.000Z",
      }),
    /does not match the current Agora schema/,
  );
});
