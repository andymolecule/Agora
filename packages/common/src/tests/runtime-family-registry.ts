import assert from "node:assert/strict";
import {
  DEFAULT_SCORER_MOUNT,
  MANAGED_RUNTIME_REGISTRY,
  OFFICIAL_SCORER_IMAGES,
  lookupManagedRuntimeFamily,
  resolveManagedScorerImage,
  resolveOfficialImageToDigest,
  resolveRuntimeFamilyMount,
  resolveRuntimeFamilyRuntimeDefaults,
  validateExpertScorerImage,
  validateRuntimeMetric,
  validateScorerImage,
} from "../runtime-families.js";

const regression = lookupManagedRuntimeFamily("tabular_regression");
assert.ok(regression, "tabular_regression should exist");
assert.equal(regression?.submissionKind, "csv_table");
assert.equal(
  resolveManagedScorerImage("tabular_regression"),
  OFFICIAL_SCORER_IMAGES.tabular,
);
assert.deepEqual(
  resolveRuntimeFamilyMount("tabular_regression"),
  DEFAULT_SCORER_MOUNT,
);
assert.equal(validateRuntimeMetric("tabular_regression", "r2"), null);
assert.ok(
  validateRuntimeMetric("tabular_regression", "accuracy")?.includes(
    "not supported",
  ),
);

const reproducibilityDefaults =
  resolveRuntimeFamilyRuntimeDefaults("reproducibility");
assert.equal(
  reproducibilityDefaults?.env?.AGORA_TOLERANCE,
  "0.001",
  "reproducibility should expose its default tolerance",
);

assert.ok(
  validateScorerImage("ghcr.io/andymolecule/gems-match-scorer:latest")?.includes(
    "not allowed",
  ),
);
assert.ok(
  validateExpertScorerImage("ghcr.io/andymolecule/gems-match-scorer:v1")?.includes(
    "pinned digest",
  ),
);

assert.ok(
  Object.keys(MANAGED_RUNTIME_REGISTRY).includes("ranking"),
  "ranking runtime family should be registered",
);
assert.equal(
  resolveRuntimeFamilyRuntimeDefaults("ranking")?.evaluationContract?.columns
    .value,
  "label",
  "ranking should expose a csv evaluation contract for scorer previews",
);
assert.equal(
  resolveRuntimeFamilyRuntimeDefaults("docking")?.evaluationContract?.columns.id,
  "ligand_id",
  "docking should expose a ligand_id evaluation contract",
);
assert.equal(validateRuntimeMetric("docking", "spearman"), null);
assert.ok(
  validateRuntimeMetric("docking", "r2")?.includes("not supported"),
);

let ghcrFetchCount = 0;
const ghcrDigest = `sha256:${"a".repeat(64)}`;
const ghcrFetch = async () => {
  ghcrFetchCount += 1;
  return new Response("", {
    status: 200,
    headers: {
      "docker-content-digest": ghcrDigest,
    },
  });
};

await resolveOfficialImageToDigest(OFFICIAL_SCORER_IMAGES.tabular, {
  env: { AGORA_GHCR_TOKEN: "secret-token" },
  fetchImpl: ghcrFetch,
});
await resolveOfficialImageToDigest(OFFICIAL_SCORER_IMAGES.tabular, {
  env: { AGORA_GHCR_TOKEN: "secret-token" },
  fetchImpl: ghcrFetch,
});
await resolveOfficialImageToDigest(OFFICIAL_SCORER_IMAGES.tabular, {
  env: {},
  fetchImpl: ghcrFetch,
});
assert.equal(
  ghcrFetchCount,
  3,
  "authenticated and anonymous GHCR resolution should not share the same cache entry",
);

console.log("runtime family registry validation passed");
