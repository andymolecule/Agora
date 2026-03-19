import assert from "node:assert/strict";
import { createAuthoringSourceDraftRequestSchema } from "../schemas/authoring-source.js";
import {
  authoringDraftSchema,
  challengeAuthoringIrSchema,
  compileManagedAuthoringDraftRequestSchema,
  createAuthoringDraftRequestSchema,
} from "../schemas/managed-authoring.js";

const baseIntent = {
  title: "Dock ligands against KRAS",
  description: "Predict docking scores for the supplied ligand set.",
  payout_condition: "Highest Spearman correlation wins.",
  reward_total: "500",
  distribution: "winner_take_all" as const,
  deadline: "2026-12-31T00:00:00.000Z",
  dispute_window_hours: 168,
  domain: "drug_discovery",
  tags: ["docking"],
  timezone: "UTC",
};

const baseArtifacts = [
  {
    id: "target",
    uri: "ipfs://bafytarget",
    file_name: "target.pdb",
  },
  {
    id: "ligands",
    uri: "ipfs://bafyligands",
    file_name: "ligands.csv",
    detected_columns: ["ligand_id", "smiles"],
  },
];

const validRequest = createAuthoringDraftRequestSchema.parse({
  poster_address: "0x00000000000000000000000000000000000000aa",
  intent: baseIntent,
  uploaded_artifacts: baseArtifacts,
});

assert.equal(validRequest.uploaded_artifacts.length, 2);
assert.equal(validRequest.intent?.dispute_window_hours, 168);

const testnetWindow = createAuthoringDraftRequestSchema.parse({
  intent: {
    ...baseIntent,
    dispute_window_hours: 0,
  },
  uploaded_artifacts: baseArtifacts,
});

assert.equal(
  testnetWindow.intent?.dispute_window_hours,
  0,
  "managed authoring should preserve explicit testnet dispute windows",
);

const duplicateUri = compileManagedAuthoringDraftRequestSchema.safeParse({
  poster_address: "0x00000000000000000000000000000000000000aa",
  intent: baseIntent,
  uploaded_artifacts: [
    baseArtifacts[0],
    {
      id: "duplicate",
      uri: "ipfs://bafytarget",
      file_name: "target-copy.pdb",
    },
  ],
});

assert.equal(
  duplicateUri.success,
  false,
  "managed authoring should reject duplicate artifact URIs",
);

const unsupportedUri = createAuthoringDraftRequestSchema.safeParse({
  intent: baseIntent,
  uploaded_artifacts: [
    {
      id: "local",
      uri: "file:///tmp/secret.csv",
      file_name: "secret.csv",
    },
  ],
});

assert.equal(
  unsupportedUri.success,
  false,
  "managed authoring should only accept pinned or hosted artifact URIs",
);

const tooManyArtifacts = createAuthoringDraftRequestSchema.safeParse({
  intent: baseIntent,
  uploaded_artifacts: Array.from({ length: 13 }, (_value, index) => ({
    id: `artifact-${index}`,
    uri: `ipfs://artifact-${index}`,
    file_name: `artifact-${index}.csv`,
  })),
});

assert.equal(
  tooManyArtifacts.success,
  false,
  "managed authoring should cap uploaded artifacts per draft",
);

const tooManyTags = createAuthoringDraftRequestSchema.safeParse({
  intent: {
    ...baseIntent,
    tags: Array.from({ length: 13 }, (_value, index) => `tag-${index}`),
  },
  uploaded_artifacts: baseArtifacts,
});

assert.equal(
  tooManyTags.success,
  false,
  "managed authoring should cap tag count per draft",
);

const authoringIr = challengeAuthoringIrSchema.parse({
  version: 1,
  origin: {
    provider: "direct",
    external_id: null,
    external_url: null,
    ingested_at: "2026-03-18T00:00:00.000Z",
    raw_context: null,
  },
  source: {
    poster_messages: [],
    uploaded_artifact_ids: [],
  },
  problem: {
    raw_brief: "",
    normalized_summary: null,
    domain_hints: [],
    hard_constraints: [],
  },
  objective: {
    solver_goal: null,
    winning_definition: null,
    comparator: null,
    primary_metric: null,
    minimum_threshold: null,
    secondary_constraints: [],
  },
  artifacts: [],
  submission: {
    solver_deliverable: null,
    artifact_kind: null,
    schema_requirements: null,
    validation_rules: [],
  },
  evaluation: {
    scoreability: "not_objective_yet",
    evaluator_candidates: [],
    selected_evaluator: null,
    runtime_family: null,
    metric: null,
    semi_custom_contract: null,
    compute_hints: [],
    privacy_requirements: [],
  },
  economics: {
    reward_total: null,
    distribution: null,
    submission_deadline: null,
    dispute_window_hours: null,
  },
  ambiguity: {
    classes: ["objective_missing", "deadline_unclear"],
    alternative_interpretations: [],
    confidence_by_section: {
      problem: 0,
      objective: 0,
      artifacts: 0,
      submission: 0,
      evaluation: 0,
      economics: 0.33,
    },
  },
  routing: {
    mode: "not_ready",
    confidence_score: 0.4,
    blocking_reasons: ["objective_missing"],
    recommended_next_action: "State the exact score rule and retry.",
  },
  clarification: {
    open_questions: [
      {
        id: "winning-definition",
        prompt: "How should Agora determine the winner?",
        reason_code: "objective_missing",
        next_step: "Add a deterministic winning rule.",
        blocks_publish: true,
      },
    ],
    resolved_assumptions: [],
    contradictions: [],
  },
});

const authoringDraft = authoringDraftSchema.parse({
  id: "f5567c15-8e0b-4afe-8d0c-7f511b592c05",
  state: "draft",
  intent: baseIntent,
  authoring_ir: authoringIr,
  uploaded_artifacts: baseArtifacts,
  clarification_questions: [],
  expires_at: "2026-12-31T00:00:00.000Z",
});

assert.equal(
  authoringDraft.authoring_ir?.clarification.open_questions[0]?.blocks_publish,
  true,
  "authoring drafts should accept persisted authoring IR state",
);

const sourceDraft = createAuthoringSourceDraftRequestSchema.parse({
  title: "Beach-originated draft",
  external_id: "thread-42",
  external_url: "https://beach.science/thread/42",
  messages: [
    {
      id: "msg-1",
      role: "poster",
      content: "We need a deterministic scoring contract for this dataset.",
    },
  ],
  artifacts: [
    {
      source_url: "https://example.org/data.csv",
      suggested_role: "training_data",
      suggested_filename: "data.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
    },
  ],
});

assert.equal(sourceDraft.messages.length, 1);
assert.equal(sourceDraft.artifacts.length, 1);
assert.equal(sourceDraft.external_id, "thread-42");

assert.equal(
  createAuthoringSourceDraftRequestSchema.safeParse({
    title: "Insecure host draft",
    external_url: "http://beach.science/thread/42",
    messages: [
      {
        id: "msg-1",
        role: "poster",
        content: "We need a deterministic scoring contract for this dataset.",
      },
    ],
  }).success,
  false,
  "external source drafts should reject non-HTTPS external URLs",
);
assert.equal(
  createAuthoringSourceDraftRequestSchema.safeParse({
    title: "Credentialed host draft",
    external_url: "https://user:pass@beach.science/thread/42",
    messages: [
      {
        id: "msg-1",
        role: "poster",
        content: "We need a deterministic scoring contract for this dataset.",
      },
    ],
  }).success,
  false,
  "external source drafts should reject credentialed host URLs",
);

console.log("managed authoring schema guardrails passed");
