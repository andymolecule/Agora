import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = path.resolve(
  TEST_DIR,
  "../../../../challenges/test-data/authoring-benchmarks",
);

const compileStateSchema = z.enum([
  "ready",
  "needs_review",
  "needs_clarification",
]);

const benchmarkSchema = z.object({
  id: z.string().min(1),
  authoring_path_support: z.enum([
    "supported",
    "definition_backed_executable",
    "definition_backed_typed",
  ]),
  intent_family: z.string().min(1),
  artifacts_root: z.string().min(1),
  prompt_variants_root: z.string().min(1),
  solver_submissions_root: z.string().min(1),
  compile_invariants: z.object({
    preset_id: z.string().min(1),
    backend_kind: z.enum([
      "preset_interpreter",
      "definition_only",
      "generated_scorer",
      "oci_image",
    ]),
    execution_runtime_family: z.string().min(1).nullable().optional(),
    metric: z.string().min(1),
    artifact_roles: z
      .array(
        z.object({
          file_name: z.string().min(1),
          role: z.string().min(1),
          visibility: z.enum(["public", "private"]),
        }),
      )
      .min(1),
    submission_contract: z.object({
      kind: z.enum(["csv_table", "opaque_file"]),
      required_columns: z.array(z.string().min(1)).optional(),
      id_column: z.string().min(1).optional(),
      value_column: z.string().min(1).optional(),
      extension: z.string().min(1).optional(),
      mime: z.string().min(1).optional(),
    }),
    challenge_type: z.string().min(1).optional(),
    evaluator_archetype: z.string().min(1).optional(),
  }),
  acceptable_compile_states: z.array(compileStateSchema).min(1),
  disallowed_outcomes: z.object({
    preset_ids: z.array(z.string().min(1)),
    recommended_actions: z.array(z.string().min(1)),
  }),
  prompt_variants: z
    .array(
      z.object({
        id: z.string().min(1),
        file: z.string().min(1),
        acceptable_compile_states: z.array(compileStateSchema).min(1),
        expected_follow_up_topics: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

async function assertExists(targetPath: string, label: string) {
  const stat = await fs.stat(targetPath).catch(() => null);
  assert.ok(stat, `${label} should exist at ${targetPath}`);
}

const benchmarkEntries = (
  await fs.readdir(benchmarkRoot, {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.ok(
  benchmarkEntries.length >= 3,
  "authoring benchmark corpus should cover more than one narrow benchmark family",
);

let sawDefinitionBackedExecutable = false;
let sawDefinitionBackedTyped = false;

for (const benchmarkId of benchmarkEntries) {
  const benchmarkDir = path.join(benchmarkRoot, benchmarkId);
  const benchmarkJsonPath = path.join(benchmarkDir, "benchmark.json");
  const benchmark = benchmarkSchema.parse(
    JSON.parse(await fs.readFile(benchmarkJsonPath, "utf8")),
  );

  assert.equal(
    benchmark.id,
    benchmarkId,
    `benchmark id should match directory name for ${benchmarkId}`,
  );
  await assertExists(
    path.join(benchmarkDir, "README.md"),
    `${benchmarkId} README`,
  );
  await assertExists(
    path.join(benchmarkDir, "evaluation-guide.md"),
    `${benchmarkId} evaluation guide`,
  );

  const promptVariantsDir = path.join(
    benchmarkDir,
    benchmark.prompt_variants_root,
  );
  const uploadsDir = path.join(benchmarkDir, benchmark.artifacts_root);
  const solverSubmissionsDir = path.join(
    benchmarkDir,
    benchmark.solver_submissions_root,
  );

  await assertExists(promptVariantsDir, `${benchmarkId} prompt variants root`);
  await assertExists(uploadsDir, `${benchmarkId} uploads root`);
  await assertExists(
    solverSubmissionsDir,
    `${benchmarkId} solver submissions root`,
  );
  await assertExists(
    path.join(solverSubmissionsDir, "valid"),
    `${benchmarkId} valid solver submissions`,
  );
  await assertExists(
    path.join(solverSubmissionsDir, "invalid"),
    `${benchmarkId} invalid solver submissions`,
  );

  for (const variant of benchmark.prompt_variants) {
    await assertExists(
      path.join(benchmarkDir, variant.file),
      `${benchmarkId} prompt variant ${variant.id}`,
    );
  }

  for (const artifact of benchmark.compile_invariants.artifact_roles) {
    await assertExists(
      path.join(uploadsDir, artifact.file_name),
      `${benchmarkId} upload fixture ${artifact.file_name}`,
    );
  }

  sawDefinitionBackedExecutable ||=
    benchmark.authoring_path_support === "definition_backed_executable";
  sawDefinitionBackedTyped ||=
    benchmark.authoring_path_support === "definition_backed_typed";
}

assert.ok(
  sawDefinitionBackedExecutable,
  "authoring benchmark corpus should include an executable definition-backed benchmark",
);
assert.ok(
  sawDefinitionBackedTyped,
  "authoring benchmark corpus should include a typed-only definition-backed benchmark",
);

console.log("authoring benchmark corpus validation passed");
