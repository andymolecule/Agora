import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClarificationQuestionsFromAuthoringIr,
  buildManagedAuthoringIr,
} from "../src/lib/managed-authoring-ir.js";

test("managed authoring IR exposes missing objective and artifact questions", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: null,
    uploadedArtifacts: [],
  });

  assert.equal(authoringIr.origin.provider, "direct");
  assert.equal(authoringIr.routing.mode, "not_ready");
  assert.deepEqual(authoringIr.routing.blocking_reasons, [
    "problem_statement_missing",
    "objective_missing",
    "missing_artifacts",
    "submission_contract_missing",
    "reward_missing",
    "distribution_missing",
    "deadline_missing",
  ]);
  assert.deepEqual(authoringIr.ambiguity.classes, [
    "not_deterministic_yet",
    "objective_missing",
    "submission_shape_missing",
    "data_format_unclear",
    "reward_unclear",
    "distribution_unclear",
    "deadline_unclear",
  ]);

  const questions = buildClarificationQuestionsFromAuthoringIr(authoringIr);
  assert.equal(questions.length, 6);
  assert.equal(questions[0]?.id, "winning-definition");
  assert.equal(questions[1]?.id, "missing-artifacts");
  assert.equal(questions[2]?.id, "submission-shape");
  assert.equal(questions[3]?.id, "reward-total");
  assert.equal(questions[4]?.id, "reward-distribution");
  assert.equal(questions[5]?.id, "submission-deadline");
});

test("managed authoring IR can represent deterministic semi-custom drafts without a managed runtime family", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: {
      title: "Deterministic report validation",
      description:
        "Solvers submit a JSON report artifact and Agora scores it against a hidden deterministic rubric.",
      payout_condition: "Highest deterministic validation score wins.",
      reward_total: "25",
      distribution: "winner_take_all",
      deadline: "2026-12-31T00:00:00.000Z",
      dispute_window_hours: 168,
      domain: "other",
      tags: [],
      solver_instructions:
        "Submit a JSON file containing the required report fields.",
      timezone: "UTC",
    },
    uploadedArtifacts: [
      {
        id: "source-data",
        uri: "ipfs://source-data",
        file_name: "source_input.csv",
        mime_type: "text/csv",
        detected_columns: ["id", "field_a"],
      },
      {
        id: "reference-output",
        uri: "ipfs://reference-output",
        file_name: "reference_output.json",
        mime_type: "application/json",
      },
    ],
  });

  assert.equal(authoringIr.routing.mode, "semi_custom");
  assert.equal(
    authoringIr.routing.blocking_reasons.includes(
      "submission_contract_missing",
    ),
    false,
  );
  assert.equal(authoringIr.submission.artifact_kind, "json_file");
  assert.equal(
    authoringIr.evaluation.evaluator_candidates[0]?.kind,
    "semi_custom",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.archetype,
    "structured_record_score",
  );
  assert.equal(
    authoringIr.evaluation.selected_evaluator,
    "structured_record_score",
  );
  assert.equal(
    authoringIr.ambiguity.classes.includes("custom_evaluator_needed"),
    true,
  );
});

test("managed authoring IR adds an execution template for supported structured table semi-custom drafts", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: {
      title: "Deterministic score reconciliation",
      description:
        "Solvers submit a CSV of ids and predicted scores. Agora compares them against a hidden reference table.",
      payout_condition: "Lowest RMSE wins.",
      reward_total: "25",
      distribution: "winner_take_all",
      deadline: "2026-12-31T00:00:00.000Z",
      dispute_window_hours: 168,
      domain: "other",
      tags: [],
      solver_instructions: "Submit a CSV with id and prediction columns.",
      timezone: "UTC",
    },
    uploadedArtifacts: [
      {
        id: "public-inputs",
        uri: "ipfs://public-inputs",
        file_name: "evaluation_inputs.csv",
        mime_type: "text/csv",
        detected_columns: ["id", "feature_a"],
      },
      {
        id: "hidden-labels",
        uri: "ipfs://hidden-labels",
        file_name: "hidden_labels.csv",
        mime_type: "text/csv",
        detected_columns: ["id", "label"],
      },
    ],
  });

  assert.equal(authoringIr.routing.mode, "semi_custom");
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.archetype,
    "structured_table_score",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.execution?.template,
    "official_table_metric_v1",
  );
  assert.equal(authoringIr.artifacts[0]?.selected_role, "public_inputs");
  assert.equal(authoringIr.artifacts[1]?.selected_role, "hidden_reference");
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.execution
      ?.evaluation_artifact_role,
    "hidden_reference",
  );
});

test("managed authoring IR adds an execution template for supported exact-match semi-custom drafts", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: {
      title: "Reference output match",
      description:
        "Solvers submit a CSV output artifact and Agora compares it against a hidden reference output.",
      payout_condition: "Exact match against the hidden reference output wins.",
      reward_total: "25",
      distribution: "winner_take_all",
      deadline: "2026-12-31T00:00:00.000Z",
      dispute_window_hours: 168,
      domain: "other",
      tags: [],
      solver_instructions: "Submit a CSV output file with deterministic rows.",
      timezone: "UTC",
    },
    uploadedArtifacts: [
      {
        id: "public-inputs",
        uri: "ipfs://public-inputs",
        file_name: "source_input.csv",
        mime_type: "text/csv",
        detected_columns: ["id", "value"],
      },
      {
        id: "reference-output",
        uri: "ipfs://reference-output",
        file_name: "reference_output.csv",
        mime_type: "text/csv",
        detected_columns: ["id", "value"],
      },
    ],
  });

  assert.equal(authoringIr.routing.mode, "semi_custom");
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.archetype,
    "exact_artifact_match",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.execution?.template,
    "official_exact_match_v1",
  );
  assert.equal(authoringIr.artifacts[0]?.selected_role, "public_inputs");
  assert.equal(authoringIr.artifacts[1]?.selected_role, "hidden_reference");
});

test("managed authoring IR adds a JSON exact-match execution template when the draft is deterministic", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: {
      title: "Reference document match",
      description:
        "Solvers submit a JSON report artifact and Agora compares it against a hidden reference output.",
      payout_condition: "Exact match against the hidden reference output wins.",
      reward_total: "25",
      distribution: "winner_take_all",
      deadline: "2026-12-31T00:00:00.000Z",
      dispute_window_hours: 168,
      domain: "other",
      tags: [],
      solver_instructions: "Submit a JSON report with deterministic fields.",
      timezone: "UTC",
    },
    uploadedArtifacts: [
      {
        id: "public-inputs",
        uri: "ipfs://public-inputs",
        file_name: "source_input.json",
        mime_type: "application/json",
      },
      {
        id: "reference-output",
        uri: "ipfs://reference-output",
        file_name: "reference_output.json",
        mime_type: "application/json",
      },
    ],
  });

  assert.equal(authoringIr.routing.mode, "semi_custom");
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.archetype,
    "exact_artifact_match",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.submission.kind,
    "json_file",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.execution?.template,
    "official_exact_match_v1",
  );
  assert.equal(authoringIr.artifacts[0]?.selected_role, "public_inputs");
  assert.equal(authoringIr.artifacts[1]?.selected_role, "hidden_reference");
});

test("managed authoring IR adds a structured-record execution template when the draft is deterministic", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: {
      title: "Deterministic report validation",
      description:
        "Solvers submit a JSON report artifact and Agora validates it against a hidden deterministic rubric.",
      payout_condition: "Highest deterministic validation score wins.",
      reward_total: "25",
      distribution: "winner_take_all",
      deadline: "2026-12-31T00:00:00.000Z",
      dispute_window_hours: 168,
      domain: "other",
      tags: [],
      solver_instructions:
        "Submit one JSON report with the required machine-readable fields.",
      timezone: "UTC",
    },
    uploadedArtifacts: [
      {
        id: "report-schema",
        uri: "ipfs://report-schema",
        file_name: "report_schema.json",
        mime_type: "application/json",
      },
      {
        id: "validation-rubric",
        uri: "ipfs://validation-rubric",
        file_name: "validation_rubric.json",
        mime_type: "application/json",
      },
    ],
  });

  assert.equal(authoringIr.routing.mode, "semi_custom");
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.archetype,
    "structured_record_score",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.submission.kind,
    "json_file",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.scoring.metric,
    "validation_score",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.execution?.template,
    "official_structured_record_v1",
  );
  assert.equal(authoringIr.artifacts[0]?.selected_role, "public_inputs");
  assert.equal(authoringIr.artifacts[1]?.selected_role, "hidden_reference");
});

test("managed authoring IR adds an opaque-file exact-match execution template when the draft is deterministic", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: {
      title: "Reference document match",
      description:
        "Solvers submit a PDF report artifact and Agora compares it against a hidden reference document.",
      payout_condition: "Exact match against the hidden reference document wins.",
      reward_total: "25",
      distribution: "winner_take_all",
      deadline: "2026-12-31T00:00:00.000Z",
      dispute_window_hours: 168,
      domain: "other",
      tags: [],
      solver_instructions: "Submit a deterministic PDF report artifact.",
      timezone: "UTC",
    },
    uploadedArtifacts: [
      {
        id: "public-inputs",
        uri: "ipfs://public-inputs",
        file_name: "source_input.pdf",
        mime_type: "application/pdf",
      },
      {
        id: "reference-output",
        uri: "ipfs://reference-output",
        file_name: "reference_output.pdf",
        mime_type: "application/pdf",
      },
    ],
  });

  assert.equal(authoringIr.routing.mode, "semi_custom");
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.archetype,
    "exact_artifact_match",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.submission.kind,
    "opaque_file",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.submission
      .schema_requirements?.expected_extension,
    ".pdf",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.submission
      .schema_requirements?.expected_mime,
    "application/pdf",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.execution?.template,
    "official_exact_match_v1",
  );
  assert.equal(authoringIr.artifacts[0]?.selected_role, "public_inputs");
  assert.equal(authoringIr.artifacts[1]?.selected_role, "hidden_reference");
});

test("managed authoring IR keeps bundle-based deterministic drafts in generic roles", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: {
      title: "Deterministic code bundle judge",
      description:
        "Solvers submit a zip bundle and Agora runs a deterministic judge over it against a hidden reference rubric.",
      payout_condition: "Highest deterministic judge score wins.",
      reward_total: "25",
      distribution: "winner_take_all",
      deadline: "2026-12-31T00:00:00.000Z",
      dispute_window_hours: 168,
      domain: "other",
      tags: [],
      solver_instructions:
        "Submit a public_inputs_bundle.zip artifact with the required files.",
      timezone: "UTC",
    },
    uploadedArtifacts: [
      {
        id: "starter-bundle",
        uri: "ipfs://starter-bundle",
        file_name: "public_inputs_bundle.zip",
        mime_type: "application/zip",
      },
      {
        id: "rubric",
        uri: "ipfs://rubric",
        file_name: "hidden_reference_rubric.json",
        mime_type: "application/json",
      },
    ],
  });

  assert.equal(authoringIr.routing.mode, "semi_custom");
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.archetype,
    "bundle_or_code_judge",
  );
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.submission.kind,
    "bundle_or_code",
  );
  assert.equal(authoringIr.artifacts[0]?.selected_role, "public_inputs");
  assert.equal(authoringIr.artifacts[1]?.selected_role, "hidden_reference");
  assert.equal(
    authoringIr.artifacts.some(
      (artifact) =>
        artifact.selected_role === "training_data" ||
        artifact.selected_role === "hidden_labels",
    ),
    false,
  );
});

test("managed authoring IR keeps opaque report validation drafts in generic roles", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: {
      title: "Deterministic report validation",
      description:
        "Solvers submit a PDF report artifact and Agora validates it against a hidden reference checklist.",
      payout_condition: "Highest deterministic validation score wins.",
      reward_total: "25",
      distribution: "winner_take_all",
      deadline: "2026-12-31T00:00:00.000Z",
      dispute_window_hours: 168,
      domain: "other",
      tags: [],
      solver_instructions: "Submit a deterministic report artifact.",
      timezone: "UTC",
    },
    uploadedArtifacts: [
      {
        id: "report-template",
        uri: "ipfs://report-template",
        file_name: "public_input_report_template.pdf",
        mime_type: "application/pdf",
      },
      {
        id: "checklist",
        uri: "ipfs://checklist",
        file_name: "hidden_reference_checklist.pdf",
        mime_type: "application/pdf",
      },
    ],
  });

  assert.equal(authoringIr.routing.mode, "semi_custom");
  assert.equal(
    authoringIr.evaluation.semi_custom_contract?.archetype,
    "opaque_file_judge",
  );
  assert.equal(authoringIr.submission.artifact_kind, "opaque_file");
  assert.equal(authoringIr.artifacts[0]?.selected_role, "public_inputs");
  assert.equal(authoringIr.artifacts[1]?.selected_role, "hidden_reference");
});
