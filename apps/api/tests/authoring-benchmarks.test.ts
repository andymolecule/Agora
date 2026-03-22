import assert from "node:assert/strict";
import test from "node:test";
import { compileManagedAuthoringSessionOutcome } from "../src/lib/managed-authoring.js";
import {
  buildAuthoringBenchmarkDependencies,
  loadAuthoringBenchmarkCases,
} from "./authoring-benchmark-fixtures.js";

const benchmarkCases = loadAuthoringBenchmarkCases();

function findArtifactInvariant(
  benchmarkId: string,
  fileName: string | null | undefined,
  artifactRoles: Array<{
    file_name: string;
    role: string;
    visibility: "public" | "private";
  }>,
) {
  if (!fileName) {
    throw new Error(
      `Benchmark ${benchmarkId} resolved an artifact without a file name.`,
    );
  }

  const invariant = artifactRoles.find(
    (artifact) => artifact.file_name === fileName,
  );
  if (!invariant) {
    throw new Error(
      `Benchmark ${benchmarkId} is missing compile invariants for ${fileName}.`,
    );
  }
  return invariant;
}

for (const benchmarkCase of benchmarkCases) {
  const benchmarkLabel = `${benchmarkCase.benchmark.id}/${benchmarkCase.variantId}`;

  test(`authoring benchmark ${benchmarkLabel} matches compile invariants`, async () => {
    const originalEnv = { ...process.env };
    process.env.AGORA_MANAGED_AUTHORING_MODEL = "claude-haiku-4-5";
    process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
    process.env.AGORA_MANAGED_AUTHORING_BASE_URL =
      "https://api.anthropic.test/v1";

    try {
      const result = await compileManagedAuthoringSessionOutcome(
        {
          intent: benchmarkCase.intent,
          uploadedArtifacts: benchmarkCase.uploadedArtifacts,
        },
        buildAuthoringBenchmarkDependencies(benchmarkCase),
      );

      assert.equal(
        benchmarkCase.benchmark.acceptable_compile_states.includes(
          result.state,
        ),
        true,
        `${benchmarkLabel} should stay within benchmark-level acceptable states`,
      );

      const variant = benchmarkCase.benchmark.prompt_variants.find(
        (candidate) => candidate.id === benchmarkCase.variantId,
      );
      if (!variant) {
        throw new Error(
          `Missing prompt variant metadata for ${benchmarkLabel}`,
        );
      }

      assert.equal(
        variant.acceptable_compile_states.includes(result.state),
        true,
        `${benchmarkLabel} should stay within prompt-variant acceptable states`,
      );

      if (
        benchmarkCase.benchmark.managed_support === "custom_workflow_required"
      ) {
        assert.equal(
          result.state,
          "rejected",
          `${benchmarkLabel} should reject cleanly into the explicit custom workflow path`,
        );
        assert.equal(
          result.compilation,
          undefined,
          `${benchmarkLabel} should not produce a managed compilation result`,
        );
        assert.equal(
          result.authoringIr.evaluation.rejection_reasons.includes(
            "custom_scorer_workflow_required",
          ) ||
            result.authoringIr.evaluation.compile_error_codes.includes(
              "MANAGED_COMPILER_UNSUPPORTED",
            ),
          true,
          `${benchmarkLabel} should record the managed-runtime rejection`,
        );
        return;
      }

      if (!result.compilation) {
        throw new Error(
          `Benchmark ${benchmarkLabel} did not produce a compilation result.`,
        );
      }

      assert.equal(
        result.compilation.runtime_family,
        benchmarkCase.benchmark.compile_invariants.runtime_family,
      );
      assert.equal(
        result.compilation.metric,
        benchmarkCase.benchmark.compile_invariants.metric,
      );
      assert.equal(
        benchmarkCase.benchmark.disallowed_outcomes.runtime_families.includes(
          result.compilation.runtime_family,
        ),
        false,
        `${benchmarkLabel} should not route to a disallowed runtime family`,
      );

      const challengeType =
        benchmarkCase.benchmark.compile_invariants.challenge_type;
      if (challengeType) {
        assert.equal(result.compilation.challenge_type, challengeType);
      }

      const evaluatorArchetype =
        benchmarkCase.benchmark.compile_invariants.evaluator_archetype;
      if (evaluatorArchetype) {
        assert.equal(
          result.compilation.challenge_spec.evaluation.evaluator_contract
            ?.archetype ?? null,
          evaluatorArchetype ?? null,
        );
      }

      for (const resolvedArtifact of result.compilation.resolved_artifacts) {
        const invariant = findArtifactInvariant(
          benchmarkCase.benchmark.id,
          resolvedArtifact.file_name,
          benchmarkCase.benchmark.compile_invariants.artifact_roles,
        );
        assert.equal(resolvedArtifact.role, invariant.role);
        assert.equal(resolvedArtifact.visibility, invariant.visibility);
      }

      const submissionContract =
        result.compilation.challenge_spec.submission_contract;
      const submissionInvariant =
        benchmarkCase.benchmark.compile_invariants.submission_contract;
      assert.equal(submissionContract.kind, submissionInvariant.kind);
      if (
        submissionContract.kind === "csv_table" &&
        submissionInvariant.kind === "csv_table"
      ) {
        assert.deepEqual(
          submissionContract.columns.required,
          submissionInvariant.required_columns,
        );
        assert.equal(
          submissionContract.columns.id,
          submissionInvariant.id_column,
        );
        assert.equal(
          submissionContract.columns.value,
          submissionInvariant.value_column,
        );
      }
      if (
        submissionContract.kind === "opaque_file" &&
        submissionInvariant.kind === "opaque_file"
      ) {
        assert.equal(
          submissionContract.file.extension,
          submissionInvariant.extension,
        );
        assert.equal(submissionContract.file.mime, submissionInvariant.mime);
      }

      assert.equal(result.compilation.dry_run.status, "validated");
    } finally {
      process.env = originalEnv;
    }
  });
}
