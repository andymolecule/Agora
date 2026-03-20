import assert from "node:assert/strict";
import test from "node:test";
import {
  compileManagedAuthoringDraftOutcome,
  compileManagedAuthoringSession,
} from "../src/lib/managed-authoring.js";

const baseIntent = {
  title: "Gene expression regression",
  description: "Predict numeric response values for the holdout set.",
  reward_total: "30",
  distribution: "winner_take_all" as const,
  deadline: "2026-12-31T00:00:00.000Z",
  dispute_window_hours: 168,
  domain: "omics",
  tags: [],
  timezone: "UTC",
};

const GENERATED_SCORER_IMAGE_DIGEST_PATTERN =
  /^ghcr\.io\/andymolecule\/gems-generated-scorer@sha256:[a-f0-9]{64}$/;
const GENERATED_SCORER_IMAGE_REFERENCE_PATTERN =
  /^ghcr\.io\/andymolecule\/gems-generated-scorer(?::v1|@sha256:[a-f0-9]{64})$/;

const uploadedArtifacts = [
  {
    id: "train",
    uri: "ipfs://bafytrain",
    file_name: "train.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "feature_a", "feature_b", "label"],
  },
  {
    id: "features",
    uri: "ipfs://bafyeval",
    file_name: "evaluation_features.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "feature_a", "feature_b"],
  },
  {
    id: "labels",
    uri: "ipfs://bafylabels",
    file_name: "hidden_labels.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "label"],
  },
];

const dockingArtifacts = [
  {
    id: "target",
    uri: "ipfs://bafytarget",
    file_name: "target_structure.pdb",
    mime_type: "chemical/x-pdb",
  },
  {
    id: "ligands",
    uri: "ipfs://bafyligands",
    file_name: "ligand_set.csv",
    mime_type: "text/csv",
    detected_columns: ["ligand_id", "smiles"],
  },
  {
    id: "reference",
    uri: "ipfs://bafyreference",
    file_name: "reference_scores.csv",
    mime_type: "text/csv",
    detected_columns: ["ligand_id", "reference_score"],
  },
];

function buildDryRunDependencies() {
  return {
    getTextImpl: async (_uri: string) => "id,label\nrow-1,1.5\nrow-2,2.5\n",
    executeScoringPipelineImpl: async (_input: unknown) => ({
      result: {
        ok: true,
        score: 1,
        details: {
          selected_metric_value: 0,
          selected_metric: "rmse",
        },
        containerImageDigest:
          "ghcr.io/andymolecule/gems-tabular-scorer@sha256:1234",
        log: "",
        outputPath: "/tmp/output/score.json",
      },
      workspaceRoot: "/tmp/workspace",
      inputDir: "/tmp/workspace/input",
      evaluationBundlePath: "/tmp/workspace/input/ground_truth.csv",
      submissionPath: "/tmp/workspace/input/submission.csv",
      runtimeConfigPath: "/tmp/workspace/input/agora-runtime.json",
      inputPaths: [],
      cleanup: async () => undefined,
    }),
  };
}

function buildDockingDryRunDependencies() {
  return {
    getTextImpl: async (_uri: string) =>
      "ligand_id,reference_score\nlig1,-7.3\nlig2,-8.1\n",
    executeScoringPipelineImpl: async (_input: unknown) => ({
      result: {
        ok: true,
        score: 0.97,
        details: {
          selected_metric_value: 0.97,
          selected_metric: "spearman",
        },
        containerImageDigest: "ghcr.io/andymolecule/gems-ranking-scorer@sha256:1234",
        log: "",
        outputPath: "/tmp/output/score.json",
      },
      workspaceRoot: "/tmp/workspace",
      inputDir: "/tmp/workspace/input",
      evaluationBundlePath: "/tmp/workspace/input/ground_truth.csv",
      submissionPath: "/tmp/workspace/input/submission.csv",
      runtimeConfigPath: "/tmp/workspace/input/agora-runtime.json",
      inputPaths: [],
      cleanup: async () => undefined,
    }),
  };
}

function buildStructuredRecordDryRunDependencies() {
  return {
    getTextImpl: async (_uri: string) =>
      JSON.stringify({
        required_fields: [
          "incident_id",
          "severity",
          "timeline",
          "actions_taken",
        ],
        non_empty_array_fields: ["timeline", "actions_taken"],
        allowed_string_values: {
          severity: ["low", "medium", "high"],
        },
      }),
    executeScoringPipelineImpl: async (_input: unknown) => ({
      result: {
        ok: true,
        score: 1,
        details: {
          selected_metric_value: 1,
          selected_metric: "validation_score",
          checks_passed: 7,
          checks_total: 7,
        },
        containerImageDigest:
          "ghcr.io/andymolecule/gems-match-scorer@sha256:1234",
        log: "",
        outputPath: "/tmp/output/score.json",
      },
      workspaceRoot: "/tmp/workspace",
      inputDir: "/tmp/workspace/input",
      evaluationBundlePath: "/tmp/workspace/input/ground_truth.json",
      submissionPath: "/tmp/workspace/input/submission.json",
      runtimeConfigPath: "/tmp/workspace/input/agora-runtime.json",
      inputPaths: [],
      cleanup: async () => undefined,
    }),
  };
}

test("managed authoring accepts RMSE regression challenges", async () => {
  const result = await compileManagedAuthoringSession(
    {
      intent: {
        ...baseIntent,
        payout_condition: "Lowest RMSE wins.",
      },
      uploadedArtifacts,
    },
    buildDryRunDependencies(),
  );

  assert.equal(result.preset_id, "tabular_regression");
  assert.equal(result.backend_kind, "generated_scorer");
  assert.equal(result.execution_runtime_family, "tabular_regression");
  assert.equal(result.metric, "rmse");
  assert.equal(result.challenge_spec.evaluation.metric, "rmse");
  assert.equal(result.challenge_spec.evaluation.backend_kind, "generated_scorer");
  assert.match(
    result.challenge_spec.evaluation.scorer_image ?? "",
    GENERATED_SCORER_IMAGE_REFERENCE_PATTERN,
  );
  assert.equal(result.challenge_spec.dispute_window_hours, 168);
  assert.equal(result.dry_run.status, "validated");
  assert.match(
    result.confirmation_contract.dry_run_summary,
    /normalized score/,
  );
});

test("managed authoring preserves explicit testnet dispute windows", async () => {
  const result = await compileManagedAuthoringSession(
    {
      intent: {
        ...baseIntent,
        dispute_window_hours: 0,
        payout_condition: "Lowest RMSE wins.",
      },
      uploadedArtifacts,
    },
    buildDryRunDependencies(),
  );

  assert.equal(result.challenge_spec.dispute_window_hours, 0);
  assert.equal(result.challenge_spec.evaluation.backend_kind, "generated_scorer");
});

test("managed authoring compiles docking challenges into the docking runtime family", async () => {
  const result = await compileManagedAuthoringSession(
    {
      intent: {
        ...baseIntent,
        title: "Rank ligands against a kinase pocket",
        description:
          "We provide a target structure and ligand set. Solvers should predict docking scores and rank ligands by expected binding strength.",
        payout_condition:
          "Highest Spearman correlation to the hidden docking scores wins.",
        domain: "drug_discovery",
      },
      uploadedArtifacts: dockingArtifacts,
    },
    buildDockingDryRunDependencies(),
  );

  assert.equal(result.challenge_type, "docking");
  assert.equal(result.preset_id, "docking");
  assert.equal(result.backend_kind, "preset_interpreter");
  assert.equal(result.execution_runtime_family, "docking");
  assert.equal(result.metric, "spearman");
  assert.equal(result.challenge_spec.type, "docking");
  assert.equal(
    result.challenge_spec.submission_contract.columns.id,
    "ligand_id",
  );
  assert.equal(
    result.challenge_spec.submission_contract.columns.value,
    "docking_score",
  );
  assert.equal(result.resolved_artifacts[2]?.role, "reference_scores");
});

test("managed authoring rejects lower-is-better payout thresholds", async () => {
  await assert.rejects(
    () =>
      compileManagedAuthoringSession(
        {
          intent: {
            ...baseIntent,
            payout_condition: "Pay if RMSE < 0.1.",
          },
          uploadedArtifacts,
        },
        buildDryRunDependencies(),
      ),
    /lower-is-better metrics like RMSE and MAE/,
  );
});

test("managed authoring uses openai-compatible compiler responses when configured", async () => {
  const originalEnv = { ...process.env };
  process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL = "https://compiler.example/v1";

  try {
    const result = await compileManagedAuthoringSession(
      {
        intent: {
          ...baseIntent,
          payout_condition: "Highest R2 wins.",
        },
        uploadedArtifacts,
      },
      {
        ...buildDryRunDependencies(),
        fetchImpl: async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      preset_id: "tabular_regression",
                      metric: "r2",
                      confidence_score: 0.94,
                      reason_codes: ["model_selected_runtime"],
                      warnings: [],
                      artifact_assignments: [
                        {
                          artifact_index: 0,
                          role: "training_data",
                          visibility: "public",
                        },
                        {
                          artifact_index: 1,
                          role: "evaluation_features",
                          visibility: "public",
                        },
                        {
                          artifact_index: 2,
                          role: "hidden_labels",
                          visibility: "private",
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      },
    );

    assert.equal(result.preset_id, "tabular_regression");
    assert.equal(result.metric, "r2");
    assert.deepEqual(result.reason_codes, ["model_selected_runtime"]);
  } finally {
    process.env = originalEnv;
  }
});

test("managed authoring routes low-confidence drafts into operator review", async () => {
  const originalEnv = { ...process.env };
  process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL = "https://compiler.example/v1";

  try {
    const result = await compileManagedAuthoringDraftOutcome(
      {
        intent: {
          ...baseIntent,
          payout_condition: "Predict the holdout values as well as you can.",
        },
        uploadedArtifacts,
      },
      {
        ...buildDryRunDependencies(),
        fetchImpl: async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      preset_id: "tabular_regression",
                      metric: "r2",
                      confidence_score: 0.62,
                      reason_codes: ["weak_artifact_role_signals"],
                      warnings: [
                        "Poster language does not name the hidden labels explicitly.",
                      ],
                      artifact_assignments: [
                        {
                          artifact_index: 0,
                          role: "training_data",
                          visibility: "public",
                        },
                        {
                          artifact_index: 1,
                          role: "evaluation_features",
                          visibility: "public",
                        },
                        {
                          artifact_index: 2,
                          role: "hidden_labels",
                          visibility: "private",
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      },
    );

    assert.equal(result.state, "needs_review");
    assert.equal(result.compilation?.preset_id, "tabular_regression");
    assert.equal(
      result.reviewSummary?.recommended_action,
      "approve_after_review",
    );
    assert.match(result.reviewSummary?.summary ?? "", /confidence is 62%/i);
  } finally {
    process.env = originalEnv;
  }
});

test("managed authoring routes low-confidence non-managed drafts into definition-backed review", async () => {
  const originalEnv = { ...process.env };
  process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL = "https://compiler.example/v1";

  try {
    const result = await compileManagedAuthoringDraftOutcome(
      {
        intent: {
          ...baseIntent,
          title: "Deterministic report validation",
          description:
            "Validate solver-submitted JSON reports against a hidden deterministic rubric.",
          payout_condition: "Highest deterministic validation score wins.",
          domain: "other",
          solver_instructions:
            "Solvers submit a JSON report artifact with the required fields.",
        },
        uploadedArtifacts,
      },
      {
        ...buildDryRunDependencies(),
        fetchImpl: async (url: string | URL | Request, _init?: RequestInit) => {
          const requestUrl =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (requestUrl.includes("ghcr.io/v2/")) {
            return new Response(null, {
              status: 200,
              headers: {
                "docker-content-digest":
                  "sha256:2222222222222222222222222222222222222222222222222222222222222222",
              },
            });
          }

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      preset_id: "tabular_regression",
                      metric: "r2",
                      confidence_score: 0.41,
                      reason_codes: ["no_supported_runtime_signal"],
                      warnings: [
                        "Challenge description does not fit a managed template cleanly.",
                      ],
                      artifact_assignments: [
                        {
                          artifact_index: 0,
                          role: "training_data",
                          visibility: "public",
                        },
                        {
                          artifact_index: 1,
                          role: "evaluation_features",
                          visibility: "public",
                        },
                        {
                          artifact_index: 2,
                          role: "hidden_labels",
                          visibility: "private",
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    assert.equal(result.state, "needs_review");
    assert.equal(result.compilation?.authoring_path, "definition_backed");
    assert.equal(result.compilation?.definition_id, "structured_record_score");
    assert.equal(
      result.compilation?.challenge_spec.evaluation.preset_id,
      "structured_record_score",
    );
    assert.equal(
      result.compilation?.challenge_spec.evaluation.backend_kind,
      "generated_scorer",
    );
    assert.match(
      result.compilation?.challenge_spec.evaluation.scorer_image ?? "",
      GENERATED_SCORER_IMAGE_DIGEST_PATTERN,
    );
    assert.equal(
      result.compilation?.challenge_spec.evaluation.evaluator_contract
        ?.archetype,
      "structured_record_score",
    );
    assert.equal(
      result.compilation?.challenge_spec.evaluation.generated_scorer?.language,
      "python",
    );
    assert.equal(result.compilation?.dry_run.status, "validated");
    assert.equal(result.authoringIr.routing.mode, "definition_backed");
    assert.equal(
      result.authoringIr.evaluation.path_candidates[0]?.kind,
      "definition_backed",
    );
    assert.equal(
      result.reviewSummary?.recommended_action,
      "approve_after_review",
    );
    assert.match(
      result.reviewSummary?.summary ?? "",
      /definition-backed evaluator/i,
    );
  } finally {
    process.env = originalEnv;
  }
});

test("managed authoring can build an executable definition-backed table contract for review", async () => {
  const originalEnv = { ...process.env };
  process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL = "https://compiler.example/v1";

  try {
    const result = await compileManagedAuthoringDraftOutcome(
      {
        intent: {
          ...baseIntent,
          title: "Deterministic score reconciliation",
          description:
            "Participants submit a CSV of ids and predicted scores. Agora compares them against a hidden reference table.",
          payout_condition: "Lowest RMSE wins.",
          domain: "other",
          solver_instructions: "Submit a CSV with columns id and prediction.",
        },
        uploadedArtifacts,
      },
      {
        ...buildDryRunDependencies(),
        fetchImpl: async (url: string | URL | Request, _init?: RequestInit) => {
          const requestUrl =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (requestUrl.includes("ghcr.io/v2/")) {
            return new Response(null, {
              status: 200,
              headers: {
                "docker-content-digest":
                  "sha256:2222222222222222222222222222222222222222222222222222222222222222",
              },
            });
          }

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      preset_id: "tabular_regression",
                      metric: "rmse",
                      confidence_score: 0.43,
                      reason_codes: ["no_supported_runtime_signal"],
                      warnings: [
                        "Challenge description does not fit a managed template cleanly.",
                      ],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    assert.equal(result.state, "needs_review");
    assert.equal(result.compilation?.authoring_path, "definition_backed");
    assert.equal(result.compilation?.definition_id, "structured_table_score");
    assert.equal(result.compilation?.backend_kind, "generated_scorer");
    assert.equal(
      result.compilation?.execution_runtime_family,
      "tabular_regression",
    );
    assert.equal(result.compilation?.dry_run.status, "validated");
    assert.equal(
      result.compilation?.challenge_spec.evaluation.evaluator_contract
        ?.execution?.template,
      "official_table_metric_v1",
    );
    assert.equal(
      result.compilation?.challenge_spec.evaluation.backend_kind,
      "generated_scorer",
    );
    assert.match(
      result.compilation?.challenge_spec.evaluation.scorer_image ?? "",
      GENERATED_SCORER_IMAGE_DIGEST_PATTERN,
    );
    assert.equal(
      result.reviewSummary?.recommended_action,
      "approve_after_review",
    );
  } finally {
    process.env = originalEnv;
  }
});

test("managed authoring can build an executable definition-backed exact-match contract for review", async () => {
  const originalEnv = { ...process.env };
  process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL = "https://compiler.example/v1";

  try {
    const result = await compileManagedAuthoringDraftOutcome(
      {
        intent: {
          ...baseIntent,
          title: "Reference output match",
          description:
            "Participants submit a CSV output artifact and Agora compares it against a hidden reference output.",
          payout_condition:
            "Exact match against the hidden reference output wins.",
          domain: "other",
          solver_instructions:
            "Submit a CSV output artifact with deterministic rows.",
        },
        uploadedArtifacts,
      },
      {
        ...buildDryRunDependencies(),
        fetchImpl: async (url: string | URL | Request, _init?: RequestInit) => {
          const requestUrl =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (requestUrl.includes("ghcr.io/v2/")) {
            return new Response(null, {
              status: 200,
              headers: {
                "docker-content-digest":
                  "sha256:4444444444444444444444444444444444444444444444444444444444444444",
              },
            });
          }

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      preset_id: "reproducibility",
                      metric: "exact_match",
                      confidence_score: 0.41,
                      reason_codes: ["no_supported_runtime_signal"],
                      warnings: [
                        "Challenge description does not fit a managed template cleanly.",
                      ],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    assert.equal(result.state, "needs_review");
    assert.equal(result.compilation?.authoring_path, "definition_backed");
    assert.equal(result.compilation?.definition_id, "exact_artifact_match");
    assert.equal(result.compilation?.backend_kind, "generated_scorer");
    assert.equal(
      result.compilation?.execution_runtime_family,
      "reproducibility",
    );
    assert.equal(result.compilation?.dry_run.status, "validated");
    assert.equal(
      result.compilation?.challenge_spec.evaluation.evaluator_contract
        ?.execution?.template,
      "official_exact_match_v1",
    );
    assert.equal(
      result.compilation?.challenge_spec.evaluation.backend_kind,
      "generated_scorer",
    );
    assert.match(
      result.compilation?.challenge_spec.evaluation.scorer_image ?? "",
      GENERATED_SCORER_IMAGE_DIGEST_PATTERN,
    );
    assert.equal(
      result.reviewSummary?.recommended_action,
      "approve_after_review",
    );
  } finally {
    process.env = originalEnv;
  }
});

test("managed authoring can build an executable JSON exact-match contract for review", async () => {
  const originalEnv = { ...process.env };
  process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL = "https://compiler.example/v1";

  try {
    const result = await compileManagedAuthoringDraftOutcome(
      {
        intent: {
          ...baseIntent,
          title: "Reference document match",
          description:
            "Participants submit a JSON report artifact and Agora compares it against a hidden reference output.",
          payout_condition:
            "Exact match against the hidden reference output wins.",
          domain: "other",
          solver_instructions:
            "Submit a JSON report artifact with deterministic fields.",
        },
        uploadedArtifacts: [
          {
            id: "source-data",
            uri: "ipfs://bafysourcejson",
            file_name: "source_data.json",
            mime_type: "application/json",
          },
          {
            id: "reference-output",
            uri: "ipfs://bafyreferencejson",
            file_name: "reference_output.json",
            mime_type: "application/json",
          },
        ],
      },
      {
        ...buildDryRunDependencies(),
        fetchImpl: async (url: string | URL | Request, _init?: RequestInit) => {
          const requestUrl =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (requestUrl.includes("ghcr.io/v2/")) {
            return new Response(null, {
              status: 200,
              headers: {
                "docker-content-digest":
                  "sha256:6666666666666666666666666666666666666666666666666666666666666666",
              },
            });
          }

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      preset_id: "reproducibility",
                      metric: "exact_match",
                      confidence_score: 0.39,
                      reason_codes: ["no_supported_runtime_signal"],
                      warnings: [
                        "Challenge description does not fit a managed template cleanly.",
                      ],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    assert.equal(result.state, "needs_review");
    assert.equal(result.compilation?.authoring_path, "definition_backed");
    assert.equal(result.compilation?.definition_id, "exact_artifact_match");
    assert.equal(result.compilation?.backend_kind, "generated_scorer");
    assert.equal(result.compilation?.dry_run.status, "validated");
    assert.equal(
      result.compilation?.challenge_spec.evaluation.evaluator_contract
        ?.submission.kind,
      "json_file",
    );
    assert.equal(
      result.compilation?.challenge_spec.evaluation.evaluator_contract
        ?.execution?.template,
      "official_exact_match_v1",
    );
    assert.match(
      result.compilation?.challenge_spec.evaluation.scorer_image ?? "",
      GENERATED_SCORER_IMAGE_DIGEST_PATTERN,
    );
    assert.equal(
      result.compilation?.challenge_spec.submission_contract.kind,
      "opaque_file",
    );
    assert.equal(
      result.compilation?.challenge_spec.submission_contract.kind === "opaque_file"
        ? result.compilation.challenge_spec.submission_contract.file.extension
        : null,
      ".json",
    );
    assert.equal(
      result.compilation?.challenge_spec.submission_contract.kind === "opaque_file"
        ? result.compilation.challenge_spec.submission_contract.file.mime
        : null,
      "application/json",
    );
    assert.equal(
      result.reviewSummary?.recommended_action,
      "approve_after_review",
    );
  } finally {
    process.env = originalEnv;
  }
});

test("managed authoring can build an executable structured-record contract for review", async () => {
  const originalEnv = { ...process.env };
  process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL = "https://compiler.example/v1";

  try {
    const result = await compileManagedAuthoringDraftOutcome(
      {
        intent: {
          ...baseIntent,
          title: "Deterministic report validation",
          description:
            "Participants submit a JSON incident report and Agora validates it against a hidden deterministic rubric.",
          payout_condition: "Highest deterministic validation score wins.",
          domain: "other",
          solver_instructions:
            "Submit one JSON report artifact with incident_id, severity, timeline, and actions_taken fields.",
        },
        uploadedArtifacts: [
          {
            id: "report-schema",
            uri: "ipfs://bafyreportschema",
            file_name: "report_schema.json",
            mime_type: "application/json",
          },
          {
            id: "validation-rubric",
            uri: "ipfs://bafyrubric",
            file_name: "validation_rubric.json",
            mime_type: "application/json",
          },
        ],
      },
      {
        ...buildStructuredRecordDryRunDependencies(),
        fetchImpl: async (url: string | URL | Request, _init?: RequestInit) => {
          const requestUrl =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (requestUrl.includes("ghcr.io/v2/")) {
            return new Response(null, {
              status: 200,
              headers: {
                "docker-content-digest":
                  "sha256:8888888888888888888888888888888888888888888888888888888888888888",
              },
            });
          }

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      preset_id: "reproducibility",
                      metric: "exact_match",
                      confidence_score: 0.4,
                      reason_codes: ["no_supported_runtime_signal"],
                      warnings: [
                        "Challenge description does not fit a managed template cleanly.",
                      ],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    assert.equal(result.state, "needs_review");
    assert.equal(result.compilation?.authoring_path, "definition_backed");
    assert.equal(result.compilation?.definition_id, "structured_record_score");
    assert.equal(result.compilation?.backend_kind, "generated_scorer");
    assert.equal(result.compilation?.dry_run.status, "validated");
    assert.equal(
      result.compilation?.challenge_spec.evaluation.evaluator_contract
        ?.archetype,
      "structured_record_score",
    );
    assert.equal(
      result.compilation?.challenge_spec.evaluation.evaluator_contract
        ?.execution?.template,
      "official_structured_record_v1",
    );
    assert.equal(
      result.compilation?.challenge_spec.submission_contract.kind,
      "opaque_file",
    );
    assert.equal(
      result.compilation?.challenge_spec.submission_contract.kind === "opaque_file"
        ? result.compilation.challenge_spec.submission_contract.file.extension
        : null,
      ".json",
    );
    assert.equal(
      result.compilation?.challenge_spec.submission_contract.kind === "opaque_file"
        ? result.compilation.challenge_spec.submission_contract.file.mime
        : null,
      "application/json",
    );
    assert.match(
      result.compilation?.challenge_spec.evaluation.scorer_image ?? "",
      GENERATED_SCORER_IMAGE_DIGEST_PATTERN,
    );
    assert.equal(
      result.reviewSummary?.recommended_action,
      "approve_after_review",
    );
  } finally {
    process.env = originalEnv;
  }
});

test("managed authoring can build an executable opaque exact-match contract for review", async () => {
  const originalEnv = { ...process.env };
  process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL = "https://compiler.example/v1";

  try {
    const result = await compileManagedAuthoringDraftOutcome(
      {
        intent: {
          ...baseIntent,
          title: "Reference PDF match",
          description:
            "Participants submit a PDF artifact and Agora compares it against a hidden reference document.",
          payout_condition:
            "Exact match against the hidden reference document wins.",
          domain: "other",
          solver_instructions:
            "Submit a deterministic PDF document artifact.",
        },
        uploadedArtifacts: [
          {
            id: "source-data",
            uri: "ipfs://bafysourcepdf",
            file_name: "source_data.pdf",
            mime_type: "application/pdf",
          },
          {
            id: "reference-output",
            uri: "ipfs://bafyreferencepdf",
            file_name: "reference_output.pdf",
            mime_type: "application/pdf",
          },
        ],
      },
      {
        ...buildDryRunDependencies(),
        fetchImpl: async (url: string | URL | Request, _init?: RequestInit) => {
          const requestUrl =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (requestUrl.includes("ghcr.io/v2/")) {
            return new Response(null, {
              status: 200,
              headers: {
                "docker-content-digest":
                  "sha256:7777777777777777777777777777777777777777777777777777777777777777",
              },
            });
          }

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      preset_id: "reproducibility",
                      metric: "exact_match",
                      confidence_score: 0.4,
                      reason_codes: ["no_supported_runtime_signal"],
                      warnings: [
                        "Challenge description does not fit a managed template cleanly.",
                      ],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    assert.equal(result.state, "needs_review");
    assert.equal(result.compilation?.authoring_path, "definition_backed");
    assert.equal(result.compilation?.definition_id, "exact_artifact_match");
    assert.equal(result.compilation?.backend_kind, "generated_scorer");
    assert.equal(result.compilation?.dry_run.status, "validated");
    assert.equal(
      result.compilation?.challenge_spec.evaluation.evaluator_contract
        ?.submission.kind,
      "opaque_file",
    );
    assert.equal(
      result.compilation?.challenge_spec.evaluation.evaluator_contract
        ?.execution?.template,
      "official_exact_match_v1",
    );
    assert.match(
      result.compilation?.challenge_spec.evaluation.scorer_image ?? "",
      GENERATED_SCORER_IMAGE_DIGEST_PATTERN,
    );
    assert.equal(
      result.compilation?.challenge_spec.submission_contract.kind,
      "opaque_file",
    );
    assert.equal(
      result.compilation?.challenge_spec.submission_contract.kind === "opaque_file"
        ? result.compilation.challenge_spec.submission_contract.file.extension
        : null,
      ".pdf",
    );
    assert.equal(
      result.compilation?.challenge_spec.submission_contract.kind === "opaque_file"
        ? result.compilation.challenge_spec.submission_contract.file.mime
        : null,
      "application/pdf",
    );
    assert.equal(
      result.reviewSummary?.recommended_action,
      "approve_after_review",
    );
  } finally {
    process.env = originalEnv;
  }
});

test("managed authoring returns clarification questions for unsupported thresholds", async () => {
  const result = await compileManagedAuthoringDraftOutcome(
    {
      intent: {
        ...baseIntent,
        payout_condition: "Pay if RMSE < 0.1.",
      },
      uploadedArtifacts,
    },
    buildDryRunDependencies(),
  );

  assert.equal(result.state, "needs_clarification");
  assert.equal(result.authoringIr.routing.mode, "not_ready");
  assert.equal(result.clarificationQuestions?.length, 1);
  assert.equal(
    result.authoringIr.clarification.open_questions[0]?.id,
    "threshold-policy",
  );
  assert.match(
    result.clarificationQuestions?.[0]?.next_step ?? "",
    /remove the explicit RMSE\/MAE threshold/i,
  );
});
