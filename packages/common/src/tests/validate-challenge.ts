import assert from "node:assert/strict";
import {
  canonicalizeChallengeSpec,
  challengeSpecSchema,
  parseChallengeSpecDocument,
  resolveChallengeEvaluation,
  validateChallengeScoreability,
  validateChallengeSpec,
} from "../schemas/challenge-spec.js";

const sample = {
  schema_version: 3,
  id: "ch-001",
  title: "Predict assay response",
  domain: "omics",
  type: "prediction",
  description: "Predict the held-out labels.",
  evaluation: {
    runtime_family: "tabular_regression",
    metric: "r2",
    scorer_image: "ghcr.io/placeholder/will-be-overridden:v1",
    evaluation_bundle: "ipfs://QmHiddenLabels",
  },
  artifacts: [
    {
      role: "training_data",
      visibility: "public",
      uri: "ipfs://QmTrain",
      file_name: "train.csv",
    },
    {
      role: "evaluation_features",
      visibility: "public",
      uri: "ipfs://QmTest",
      file_name: "test.csv",
    },
    {
      role: "hidden_labels",
      visibility: "private",
      uri: "ipfs://QmHiddenLabels",
      file_name: "hidden_labels.csv",
    },
  ],
  submission_contract: {
    version: "v1",
    kind: "csv_table",
    file: {
      extension: ".csv",
      mime: "text/csv",
      max_bytes: 10_000_000,
    },
    columns: {
      required: ["id", "prediction"],
      id: "id",
      value: "prediction",
      allow_extra: true,
    },
  },
  reward: {
    total: "25",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
  dispute_window_hours: 0,
};

const result = challengeSpecSchema.safeParse(sample);
assert.equal(result.success, true, "sample spec should validate");

const chainValidated = validateChallengeSpec(sample, 84532);
assert.equal(chainValidated.success, true, "chain validation should succeed");

if (!result.success) {
  throw new Error("Expected sample spec to parse");
}

const resolved = resolveChallengeEvaluation(result.data);
assert.equal(resolved.runtimeFamily, "tabular_regression");
assert.equal(resolved.metric, "r2");
assert.equal(resolved.evaluationBundleCid, "ipfs://QmHiddenLabels");

const scoreability = validateChallengeScoreability(result.data);
assert.equal(scoreability.ok, true, "sample spec should be scoreable");

const canonicalized = await canonicalizeChallengeSpec(result.data, {
  resolveOfficialPresetDigests: false,
});
assert.equal(
  canonicalized.evaluation.scorer_image,
  "ghcr.io/andymolecule/regression-scorer:v1",
  "managed challenges should canonicalize their scorer image from the registry",
);

const invalidMetric = challengeSpecSchema.safeParse({
  ...sample,
  evaluation: {
    ...sample.evaluation,
    metric: "accuracy",
  },
});
assert.equal(invalidMetric.success, false, "unsupported metric should fail");

const expertSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    runtime_family: "expert_custom",
    metric: "custom",
    scorer_image: "ghcr.io/acme/expert@sha256:1234",
  },
});
assert.equal(
  expertSpec.success,
  true,
  "expert spec should accept pinned digests",
);

const semiCustomSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    runtime_family: "semi_custom",
    metric: "validation_score",
    evaluator_contract: {
      version: "v1",
      archetype: "structured_record_score",
      summary: "Validate a JSON report against a deterministic rubric.",
      artifact_roles: {
        solver_visible: ["training_data"],
        hidden: ["hidden_labels"],
      },
      submission: {
        kind: "json_file",
        schema_requirements: {
          expected_kind: "json_file",
        },
        validation_rules: ["Submission must be valid JSON."],
      },
      scoring: {
        metric: "validation_score",
        comparator: "maximize",
        deterministic_rule:
          "Score the JSON report against the hidden rubric and rank by validation score.",
        minimum_threshold: null,
      },
      notes: [],
    },
  },
});
assert.equal(
  semiCustomSpec.success,
  true,
  "semi-custom specs should validate when they include an evaluator contract",
);

if (!semiCustomSpec.success) {
  throw new Error("Expected semi-custom spec to parse");
}

const semiCustomResolved = resolveChallengeEvaluation(semiCustomSpec.data);
assert.equal(semiCustomResolved.runtimeFamily, "semi_custom");
assert.equal(
  semiCustomResolved.evaluatorContract?.archetype,
  "structured_record_score",
);

const semiCustomScoreability = validateChallengeScoreability(
  semiCustomSpec.data,
);
assert.equal(
  semiCustomScoreability.ok,
  false,
  "semi-custom specs should not be treated as executable until the runtime path exists",
);
assert.match(
  semiCustomScoreability.errors[0] ?? "",
  /typed but not executable/i,
);

const executableStructuredRecordSemiCustomSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    runtime_family: "semi_custom",
    metric: "validation_score",
    scorer_image:
      "ghcr.io/andymolecule/repro-scorer@sha256:2222222222222222222222222222222222222222222222222222222222222222",
    evaluator_contract: {
      version: "v1",
      archetype: "structured_record_score",
      summary: "Validate a JSON report against a deterministic hidden rubric.",
      artifact_roles: {
        solver_visible: ["training_data"],
        hidden: ["hidden_labels"],
      },
      submission: {
        kind: "json_file",
        schema_requirements: {
          expected_kind: "json_file",
        },
        validation_rules: ["Submission must be valid JSON."],
      },
      scoring: {
        metric: "validation_score",
        comparator: "maximize",
        deterministic_rule:
          "Score the JSON report against the hidden rubric and rank by validation score.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_structured_record_v1",
        evaluation_artifact_role: "hidden_labels",
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
  artifacts: [
    {
      role: "training_data",
      visibility: "public",
      uri: "ipfs://QmPrompt",
    },
    {
      role: "hidden_labels",
      visibility: "private",
      uri: "ipfs://QmRubric",
      file_name: "validation_rubric.json",
      mime_type: "application/json",
    },
  ],
  submission_contract: {
    version: "v1",
    kind: "opaque_file",
    file: {
      extension: ".json",
      mime: "application/json",
      max_bytes: 1024,
    },
  },
});
assert.equal(
  executableStructuredRecordSemiCustomSpec.success,
  true,
  "semi-custom structured-record specs should validate when they use the supported execution template",
);

if (!executableStructuredRecordSemiCustomSpec.success) {
  throw new Error(
    "Expected executable structured-record semi-custom spec to parse",
  );
}

const executableStructuredRecordResolved = resolveChallengeEvaluation(
  executableStructuredRecordSemiCustomSpec.data,
);
assert.equal(executableStructuredRecordResolved.runtimeFamily, "semi_custom");
assert.equal(
  executableStructuredRecordResolved.semiCustomExecution?.runner_runtime_family,
  "reproducibility",
);
assert.equal(
  executableStructuredRecordResolved.mount.evaluationBundleName,
  "ground_truth.json",
);
assert.equal(
  executableStructuredRecordResolved.mount.submissionFileName,
  "submission.json",
);

const executableStructuredRecordScoreability = validateChallengeScoreability(
  executableStructuredRecordSemiCustomSpec.data,
);
assert.equal(
  executableStructuredRecordScoreability.ok,
  true,
  "supported semi-custom structured-record specs should be scoreable",
);

const mismatchedSemiCustomSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    runtime_family: "semi_custom",
    metric: "validation_score",
    evaluator_contract: {
      version: "v1",
      archetype: "structured_record_score",
      summary: "This should fail because the submission kind is wrong.",
      artifact_roles: {
        solver_visible: ["training_data"],
        hidden: ["hidden_labels"],
      },
      submission: {
        kind: "csv_table",
        schema_requirements: {
          suggested_columns: ["id", "score"],
        },
        validation_rules: ["Submission must be valid CSV."],
      },
      scoring: {
        metric: "validation_score",
        comparator: "maximize",
        deterministic_rule: "Invalid mismatch test.",
        minimum_threshold: null,
      },
      notes: [],
    },
  },
});
assert.equal(
  mismatchedSemiCustomSpec.success,
  false,
  "semi-custom specs should reject mismatched archetype and submission kind pairs",
);

const executableSemiCustomSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    runtime_family: "semi_custom",
    metric: "rmse",
    scorer_image:
      "ghcr.io/andymolecule/regression-scorer@sha256:1111111111111111111111111111111111111111111111111111111111111111",
    evaluator_contract: {
      version: "v1",
      archetype: "structured_table_score",
      summary: "Score a CSV submission against hidden truth with RMSE.",
      artifact_roles: {
        solver_visible: ["training_data", "evaluation_features"],
        hidden: ["hidden_labels"],
      },
      submission: {
        kind: "csv_table",
        schema_requirements: {
          suggested_columns: ["id", "prediction"],
        },
        validation_rules: ["Submission must be valid CSV."],
      },
      scoring: {
        metric: "rmse",
        comparator: "minimize",
        deterministic_rule:
          "Compute RMSE against the hidden labels and rank by the normalized leaderboard score.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_table_metric_v1",
        evaluation_artifact_role: "hidden_labels",
        evaluation_contract: {
          kind: "csv_table",
          columns: {
            required: ["id", "label"],
            id: "id",
            value: "label",
            allow_extra: true,
          },
        },
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
});
assert.equal(
  executableSemiCustomSpec.success,
  true,
  "semi-custom specs should validate when they use a supported execution template",
);

if (!executableSemiCustomSpec.success) {
  throw new Error("Expected executable semi-custom spec to parse");
}

const executableSemiCustomResolved = resolveChallengeEvaluation(
  executableSemiCustomSpec.data,
);
assert.equal(executableSemiCustomResolved.runtimeFamily, "semi_custom");
assert.equal(
  executableSemiCustomResolved.image,
  "ghcr.io/andymolecule/regression-scorer@sha256:1111111111111111111111111111111111111111111111111111111111111111",
);
assert.equal(
  executableSemiCustomResolved.evaluationBundleCid,
  "ipfs://QmHiddenLabels",
);
assert.equal(
  executableSemiCustomResolved.semiCustomExecution?.runner_runtime_family,
  "tabular_regression",
);

const executableSemiCustomScoreability = validateChallengeScoreability(
  executableSemiCustomSpec.data,
);
assert.equal(
  executableSemiCustomScoreability.ok,
  true,
  "supported semi-custom table specs should be scoreable",
);

const executableExactMatchSemiCustomSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    runtime_family: "semi_custom",
    metric: "exact_match",
    scorer_image:
      "ghcr.io/andymolecule/repro-scorer@sha256:3333333333333333333333333333333333333333333333333333333333333333",
    evaluator_contract: {
      version: "v1",
      archetype: "exact_artifact_match",
      summary:
        "Compare a CSV solver output directly against a hidden reference output.",
      artifact_roles: {
        solver_visible: ["training_data", "evaluation_features"],
        hidden: ["hidden_labels"],
      },
      submission: {
        kind: "csv_table",
        schema_requirements: {
          suggested_columns: ["id", "prediction"],
        },
        validation_rules: ["Submission must be valid CSV."],
      },
      scoring: {
        metric: "exact_match",
        comparator: "maximize",
        deterministic_rule:
          "Compare the submission CSV directly against the hidden reference output and rank by exact row match.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_exact_match_v1",
        evaluation_artifact_role: "hidden_labels",
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
});
assert.equal(
  executableExactMatchSemiCustomSpec.success,
  true,
  "semi-custom exact artifact match specs should validate when they use a supported execution template",
);

if (!executableExactMatchSemiCustomSpec.success) {
  throw new Error("Expected executable exact-match semi-custom spec to parse");
}

const executableExactMatchResolved = resolveChallengeEvaluation(
  executableExactMatchSemiCustomSpec.data,
);
assert.equal(executableExactMatchResolved.runtimeFamily, "semi_custom");
assert.equal(
  executableExactMatchResolved.image,
  "ghcr.io/andymolecule/repro-scorer@sha256:3333333333333333333333333333333333333333333333333333333333333333",
);
assert.equal(
  executableExactMatchResolved.semiCustomExecution?.runner_runtime_family,
  "reproducibility",
);

const executableExactMatchScoreability = validateChallengeScoreability(
  executableExactMatchSemiCustomSpec.data,
);
assert.equal(
  executableExactMatchScoreability.ok,
  true,
  "supported semi-custom exact-match specs should be scoreable",
);

const executableJsonExactMatchSemiCustomSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    runtime_family: "semi_custom",
    metric: "exact_match",
    scorer_image:
      "ghcr.io/andymolecule/repro-scorer@sha256:5555555555555555555555555555555555555555555555555555555555555555",
    evaluator_contract: {
      version: "v1",
      archetype: "exact_artifact_match",
      summary:
        "Compare a JSON solver output directly against a hidden reference document.",
      artifact_roles: {
        solver_visible: ["source_data"],
        hidden: ["reference_output"],
      },
      submission: {
        kind: "json_file",
        schema_requirements: {
          expected_kind: "json_file",
        },
        validation_rules: ["Submission must be valid JSON."],
      },
      scoring: {
        metric: "exact_match",
        comparator: "maximize",
        deterministic_rule:
          "Compare the submission JSON directly against the hidden reference output.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_exact_match_v1",
        evaluation_artifact_role: "reference_output",
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
  artifacts: [
    {
      role: "source_data",
      visibility: "public",
      uri: "ipfs://QmJsonInput",
    },
    {
      role: "reference_output",
      visibility: "private",
      uri: "ipfs://QmHiddenJson",
      file_name: "reference_output.json",
      mime_type: "application/json",
    },
  ],
  submission_contract: {
    version: "v1",
    kind: "opaque_file",
    file: {
      extension: ".json",
      mime: "application/json",
      max_bytes: 1024,
    },
  },
});
assert.equal(
  executableJsonExactMatchSemiCustomSpec.success,
  true,
  "semi-custom JSON exact-match specs should validate when they use the supported execution template",
);

if (!executableJsonExactMatchSemiCustomSpec.success) {
  throw new Error(
    "Expected executable JSON exact-match semi-custom spec to parse",
  );
}

const executableJsonExactMatchResolved = resolveChallengeEvaluation(
  executableJsonExactMatchSemiCustomSpec.data,
);
assert.equal(
  executableJsonExactMatchResolved.evaluationBundleCid,
  "ipfs://QmHiddenJson",
);
assert.equal(
  executableJsonExactMatchResolved.mount.evaluationBundleName,
  "ground_truth.json",
);
assert.equal(
  executableJsonExactMatchResolved.mount.submissionFileName,
  "submission.json",
);

const executableJsonExactMatchScoreability = validateChallengeScoreability(
  executableJsonExactMatchSemiCustomSpec.data,
);
assert.equal(
  executableJsonExactMatchScoreability.ok,
  true,
  "supported semi-custom JSON exact-match specs should be scoreable",
);

const executableOpaqueExactMatchSemiCustomSpec = challengeSpecSchema.safeParse({
  ...sample,
  type: "custom",
  evaluation: {
    runtime_family: "semi_custom",
    metric: "exact_match",
    scorer_image:
      "ghcr.io/andymolecule/repro-scorer@sha256:7777777777777777777777777777777777777777777777777777777777777777",
    evaluator_contract: {
      version: "v1",
      archetype: "exact_artifact_match",
      summary:
        "Compare a solver-uploaded PDF directly against a hidden reference document.",
      artifact_roles: {
        solver_visible: ["source_documents"],
        hidden: ["reference_output"],
      },
      submission: {
        kind: "opaque_file",
        schema_requirements: {
          expected_kind: "opaque_file",
        },
        validation_rules: ["Submission must be a deterministic PDF artifact."],
      },
      scoring: {
        metric: "exact_match",
        comparator: "maximize",
        deterministic_rule:
          "Compare the solver document byte-for-byte against the hidden reference output.",
        minimum_threshold: null,
      },
      execution: {
        template: "official_exact_match_v1",
        evaluation_artifact_role: "reference_output",
        policies: {
          coverage_policy: "reject",
          duplicate_id_policy: "reject",
          invalid_value_policy: "reject",
        },
      },
      notes: [],
    },
  },
  artifacts: [
    {
      role: "source_documents",
      visibility: "public",
      uri: "ipfs://QmPublicPdf",
    },
    {
      role: "reference_output",
      visibility: "private",
      uri: "ipfs://QmHiddenPdf",
      file_name: "reference_output.pdf",
      mime_type: "application/pdf",
    },
  ],
  submission_contract: {
    version: "v1",
    kind: "opaque_file",
    file: {
      extension: ".pdf",
      mime: "application/pdf",
      max_bytes: 1024,
    },
  },
});
assert.equal(
  executableOpaqueExactMatchSemiCustomSpec.success,
  true,
  "semi-custom opaque exact-match specs should validate when they use the supported execution template",
);

if (!executableOpaqueExactMatchSemiCustomSpec.success) {
  throw new Error(
    "Expected executable opaque exact-match semi-custom spec to parse",
  );
}

const executableOpaqueExactMatchResolved = resolveChallengeEvaluation(
  executableOpaqueExactMatchSemiCustomSpec.data,
);
assert.equal(
  executableOpaqueExactMatchResolved.evaluationBundleCid,
  "ipfs://QmHiddenPdf",
);
assert.equal(
  executableOpaqueExactMatchResolved.mount.evaluationBundleName,
  "ground_truth.bin",
);
assert.equal(
  executableOpaqueExactMatchResolved.mount.submissionFileName,
  "submission.bin",
);

const executableOpaqueExactMatchScoreability = validateChallengeScoreability(
  executableOpaqueExactMatchSemiCustomSpec.data,
);
assert.equal(
  executableOpaqueExactMatchScoreability.ok,
  true,
  "supported semi-custom opaque exact-match specs should be scoreable",
);

const missingBundleParse = challengeSpecSchema.safeParse({
  ...sample,
  evaluation: {
    ...sample.evaluation,
    evaluation_bundle: undefined,
  },
});
assert.equal(
  missingBundleParse.success,
  false,
  "managed runtime families should require an evaluation bundle",
);

const yamlDocument = `
schema_version: 3
id: ch-yaml
title: YAML challenge
domain: omics
type: prediction
description: Parse from pinned YAML
evaluation:
  runtime_family: tabular_regression
  metric: r2
  scorer_image: ghcr.io/placeholder/will-be-overridden:v1
  evaluation_bundle: ipfs://QmHiddenLabels
artifacts:
  - role: training_data
    visibility: public
    uri: ipfs://QmTrain
submission_contract:
  version: v1
  kind: csv_table
  file:
    extension: .csv
    mime: text/csv
    max_bytes: 10485760
  columns:
    required: [id, prediction]
    id: id
    value: prediction
    allow_extra: true
reward:
  total: "5"
  distribution: winner_take_all
deadline: 2026-03-20T00:00:00Z
`;
const parsedYaml = challengeSpecSchema.safeParse(
  parseChallengeSpecDocument(yamlDocument),
);
assert.equal(
  parsedYaml.success,
  true,
  "pinned YAML specs should parse through the canonical schema",
);

console.log("challengeSpecSchema validation passed");
