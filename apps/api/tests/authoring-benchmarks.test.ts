import assert from "node:assert/strict";
import test from "node:test";
import { compileManagedAuthoringDraftOutcome } from "../src/lib/managed-authoring.js";
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

  const invariant = artifactRoles.find((artifact) => artifact.file_name === fileName);
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
    process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
    process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
    process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
    process.env.AGORA_MANAGED_AUTHORING_BASE_URL =
      "https://compiler.example/v1";

    try {
      const result = await compileManagedAuthoringDraftOutcome(
        {
          intent: benchmarkCase.intent,
          uploadedArtifacts: benchmarkCase.uploadedArtifacts,
        },
        buildAuthoringBenchmarkDependencies(benchmarkCase),
      );

      assert.equal(
        benchmarkCase.benchmark.acceptable_compile_states.includes(result.state),
        true,
        `${benchmarkLabel} should stay within benchmark-level acceptable states`,
      );

      const variant = benchmarkCase.benchmark.prompt_variants.find(
        (candidate) => candidate.id === benchmarkCase.variantId,
      );
      if (!variant) {
        throw new Error(`Missing prompt variant metadata for ${benchmarkLabel}`);
      }

      assert.equal(
        variant.acceptable_compile_states.includes(result.state),
        true,
        `${benchmarkLabel} should stay within prompt-variant acceptable states`,
      );

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
          result.authoringIr.evaluation.semi_custom_contract?.archetype,
          evaluatorArchetype,
        );
      }

      for (const resolvedArtifact of result.authoringIr.artifacts) {
        const invariant = findArtifactInvariant(
          benchmarkCase.benchmark.id,
          resolvedArtifact.file_name,
          benchmarkCase.benchmark.compile_invariants.artifact_roles,
        );
        assert.equal(resolvedArtifact.selected_role, invariant.role);
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

      if (result.reviewSummary) {
        assert.equal(
          benchmarkCase.benchmark.disallowed_outcomes.recommended_actions.includes(
            result.reviewSummary.recommended_action,
          ),
          false,
          `${benchmarkLabel} should not recommend a disallowed next action`,
        );
      }

      if (benchmarkCase.benchmark.managed_support === "semi_custom_executable") {
        assert.equal(result.compilation.dry_run.status, "validated");
      }
      if (benchmarkCase.benchmark.managed_support === "semi_custom_typed") {
        assert.equal(result.compilation.dry_run.status, "skipped");
      }
    } finally {
      process.env = originalEnv;
    }
  });
}
