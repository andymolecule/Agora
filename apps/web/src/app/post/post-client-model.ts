import {
  CHALLENGE_LIMITS,
  type ChallengeSpec,
  type ChallengeType,
  PRESET_REGISTRY,
  buildChallengeSpecDraft,
  getChallengeTypeTemplate,
  resolveChallengePresetId,
} from "@agora/common";
import { zeroAddress } from "viem";
import { computeDeadlineIso } from "../../lib/post-submission-window";
export type UploadField = "train" | "test" | "hiddenLabels";

export const METRIC_OPTIONS = [
  { value: "rmse", label: "RMSE", hint: "Lower is better" },
  { value: "r2", label: "R²", hint: "Higher is better" },
  { value: "mae", label: "MAE", hint: "Lower is better" },
  { value: "pearson", label: "Pearson", hint: "Higher is better" },
  { value: "spearman", label: "Spearman", hint: "Higher is better" },
  { value: "custom", label: "Custom metric", hint: "" },
] as const;

export const WINNER_LABELS: Record<string, string> = {
  winner_take_all: "Winner takes entire reward pool",
  top_3: "Reward split among top 3 scorers",
  proportional: "Reward distributed proportionally by score",
};

export const DISTRIBUTION_SUMMARY_LABELS = {
  winner_take_all: "Winner Take All",
  top_3: "Top 3",
  proportional: "Proportional",
} as const;

export function getMetricOption(metric: string) {
  return METRIC_OPTIONS.find((option) => option.value === metric);
}

export function getMetricDisplayLabel(metric: string) {
  return getMetricOption(metric)?.label ?? metric;
}

export function getMetricDisplaySummary(metric: string) {
  const option = getMetricOption(metric);
  if (!option) return metric;
  return option.hint ? `${option.label} (${option.hint})` : option.label;
}

const registryPresets = Object.values(PRESET_REGISTRY);

export const TYPE_CONFIG = {
  prediction: getChallengeTypeTemplate("prediction"),
  optimization: getChallengeTypeTemplate("optimization"),
  reproducibility: getChallengeTypeTemplate("reproducibility"),
  docking: getChallengeTypeTemplate("docking"),
  red_team: getChallengeTypeTemplate("red_team"),
  custom: getChallengeTypeTemplate("custom"),
} as const;

export const AVAILABLE_TYPE_OPTIONS: ChallengeType[] = [
  "reproducibility",
  "prediction",
];

export const COMING_SOON_TYPE_OPTIONS: ChallengeType[] = [
  "optimization",
  "docking",
  "red_team",
];

export const TYPE_FORM_COPY: Record<
  "reproducibility" | "prediction",
  {
    titlePlaceholder: string;
    descriptionPlaceholder: string;
    tagPlaceholder: string;
  }
> = {
  reproducibility: {
    titlePlaceholder:
      "e.g. Reproduce normalized assay summary statistics from the Lee et al. pipeline",
    descriptionPlaceholder:
      "Describe the reference artifact solvers should reproduce, what source data they should work from, and any constraints on ordering, preprocessing, or rounding.",
    tagPlaceholder: "e.g. reproducibility, assay, csv",
  },
  prediction: {
    titlePlaceholder:
      "e.g. Predict assay response from tabular feature measurements",
    descriptionPlaceholder:
      "Describe the target outcome, what the training and evaluation rows represent, and any scientific context solvers need to build a credible model.",
    tagPlaceholder: "e.g. prediction, tabular, assay",
  },
};

export const MARKETPLACE_CATEGORY_OPTIONS = [
  { value: "longevity", label: "Longevity" },
  { value: "drug_discovery", label: "Drug Discovery" },
  { value: "protein_design", label: "Protein Design" },
  { value: "omics", label: "Omics" },
  { value: "neuroscience", label: "Neuroscience" },
  { value: "other", label: "Other" },
] as const;

export type FormState = {
  title: string;
  description: string;
  referenceLink: string;
  domain: string;
  type: ChallengeType;
  train: string;
  test: string;
  hiddenLabels: string;
  metric: string;
  container: string;
  reward: string;
  distribution: "winner_take_all" | "top_3" | "proportional";
  deadlineDays: string;
  minimumScore: string;
  disputeWindow: string;
  evaluationCriteria: string;
  successDefinition: string;
  idColumn: string;
  labelColumn: string;
  reproPresetId: string;
  tolerance: string;
  tags: string[];
  detectedColumns: string[];
};

export const PAYOUT_RULE_OPTIONS: Array<{
  value: FormState["distribution"];
  label: string;
  hint: string;
}> = [
  {
    value: "winner_take_all",
    label: "Winner takes all",
    hint: "Best when the reward pool is small or you care most about the single top result.",
  },
  {
    value: "top_3",
    label: "Top 3 (60 / 25 / 15%)",
    hint: "1st gets 60%, 2nd gets 25%, 3rd gets 15%. Encourages broader participation.",
  },
  {
    value: "proportional",
    label: "Proportional",
    hint: "Distributes payout by score when you want many valid submissions to earn something.",
  },
] as const;

export const SUBMISSION_WINDOW_OPTIONS: Array<{
  value: FormState["deadlineDays"];
  label: string;
  testnetOnly?: true;
}> = [
  { value: "15m", label: "15 min - Testing", testnetOnly: true },
  { value: "0", label: "30 min - Testing", testnetOnly: true },
  { value: "7", label: "7 days - Standard" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days - Maximum" },
];

export type PipelineFlow = {
  stages: Array<{
    title: string;
    action: string;
    schemaLabel: "IN" | "OUT" | "EVAL";
    schemaValue: string;
    tone: "poster" | "solver" | "scorer";
  }>;
  helper: string;
  systemNote?: string;
};

export const PIPELINE_FLOWS: Record<ChallengeType, PipelineFlow> = {
  prediction: {
    stages: [
      {
        title: "Poster",
        action: "Publishes dataset",
        schemaLabel: "IN",
        schemaValue: "{train, test, hidden_labels}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Computes predictions",
        schemaLabel: "OUT",
        schemaValue: "[predictions.csv]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Validates + scores",
        schemaLabel: "EVAL",
        schemaValue: "(hidden_labels -> metric)",
        tone: "scorer",
      },
    ],
    helper:
      "Public benchmark workflow: training data and evaluation inputs go in, solver predictions come back, and Agora scores them against the posted benchmark targets.",
    systemNote:
      "All three artifacts in this step become challenge materials. Use this flow for public benchmark evaluation, not private holdout scoring.",
  },
  reproducibility: {
    stages: [
      {
        title: "Poster",
        action: "Publishes reference run",
        schemaLabel: "IN",
        schemaValue: "{inputs, expected_output}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Recreates output",
        schemaLabel: "OUT",
        schemaValue: "[reproduced_output.csv]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Diffs + scores",
        schemaLabel: "EVAL",
        schemaValue: "(expected_output -> diff)",
        tone: "scorer",
      },
    ],
    helper:
      "Public benchmark workflow: source data goes in, reproduced CSV output comes back, and the official scorer compares it deterministically against the posted reference.",
    systemNote:
      "The official reference output is published with the challenge and becomes the benchmark artifact every solver is judged against.",
  },
  optimization: {
    stages: [
      {
        title: "Poster",
        action: "Publishes eval bundle",
        schemaLabel: "IN",
        schemaValue: "{evaluation_bundle}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Searches parameters",
        schemaLabel: "OUT",
        schemaValue: "[parameters.json]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Runs simulation",
        schemaLabel: "EVAL",
        schemaValue: "(bundle + params -> score)",
        tone: "scorer",
      },
    ],
    helper:
      "The compute-heavy step lives inside the scorer stage, which executes your simulation bundle against solver-supplied parameters.",
    systemNote:
      "There is no extra actor between solver and scorer here; the simulation engine is the scorer itself.",
  },
  docking: {
    stages: [
      {
        title: "Poster",
        action: "Publishes docking inputs",
        schemaLabel: "IN",
        schemaValue: "{target, ligands}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Ranks candidates",
        schemaLabel: "OUT",
        schemaValue: "[docking_scores.csv]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Benchmarks ranking",
        schemaLabel: "EVAL",
        schemaValue: "(reference_scores -> rank_score)",
        tone: "scorer",
      },
    ],
    helper:
      "The docking workflow is a single compute lane: shared inputs in, ranked scores out, then deterministic benchmark scoring.",
    systemNote:
      "The reference docking data belongs to the scorer stage. It is the critical function between raw solver output and the final score.",
  },
  red_team: {
    stages: [
      {
        title: "Poster",
        action: "Publishes target model",
        schemaLabel: "IN",
        schemaValue: "{model, baseline_data}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Crafts attacks",
        schemaLabel: "OUT",
        schemaValue: "[adversarial_inputs]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Measures degradation",
        schemaLabel: "EVAL",
        schemaValue: "(baseline -> delta_score)",
        tone: "scorer",
      },
    ],
    helper:
      "The red-team path stays linear: target model context in, adversarial examples out, then degradation measured deterministically.",
    systemNote:
      "Baseline evaluation is the important hidden function here. It lives inside the scorer stage rather than as a separate actor.",
  },
  custom: {
    stages: [
      {
        title: "Poster",
        action: "Publishes protocol",
        schemaLabel: "IN",
        schemaValue: "{public_inputs, eval_bundle}",
        tone: "poster",
      },
      {
        title: "Solver",
        action: "Submits solution",
        schemaLabel: "OUT",
        schemaValue: "[solution_payload]",
        tone: "solver",
      },
      {
        title: "Scorer",
        action: "Executes custom logic",
        schemaLabel: "EVAL",
        schemaValue: "(custom_eval -> score)",
        tone: "scorer",
      },
    ],
    helper:
      "Custom challenges still follow the same three-stage pipeline, but the scoring function is fully defined by your protocol.",
    systemNote:
      "The only extra function is your custom evaluation container, which is represented directly in the scorer stage.",
  },
};

export function engineDisplayName(container: string): string {
  const linkedPresets = registryPresets.filter(
    (preset) => preset.container === container,
  );
  if (linkedPresets.length === 0) {
    return container.length > 40 ? `${container.slice(0, 40)}...` : container;
  }
  const names = Array.from(
    new Set(linkedPresets.map((preset) => preset.label)),
  );
  if (names.length === 1) return `${names[0]} (official)`;
  return `${names[0]} (+${names.length - 1} preset${names.length > 2 ? "s" : ""})`;
}

export function scoringRuleLabel(state: FormState): string {
  if (state.type === "reproducibility") return "Deterministic CSV comparison";
  if (state.type === "prediction") {
    const metricLabel = getMetricDisplayLabel(state.metric);
    return `${metricLabel} on hidden labels`;
  }
  return engineDisplayName(state.container);
}

const defaultPreset = TYPE_CONFIG.reproducibility;

export const initialState: FormState = {
  title: "",
  description: "",
  referenceLink: "",
  domain: defaultPreset.defaultDomain,
  type: "reproducibility",
  train: "",
  test: "",
  hiddenLabels: "",
  metric: defaultPreset.defaultMetric,
  container: defaultPreset.defaultContainer,
  reward: "10",
  distribution: "winner_take_all",
  deadlineDays: "7",
  minimumScore: String(defaultPreset.defaultMinimumScore),
  disputeWindow: String(CHALLENGE_LIMITS.defaultDisputeWindowHours),
  evaluationCriteria: defaultPreset.scoringTemplate,
  successDefinition: "",
  idColumn: "id",
  labelColumn: "prediction",
  reproPresetId: TYPE_CONFIG.reproducibility.defaultPresetId,
  tolerance: "0.001",
  tags: [],
  detectedColumns: [],
};

export function buildSpec(state: FormState) {
  const train = state.train.trim();
  const test = state.test.trim();
  const hiddenLabels = state.hiddenLabels.trim();
  const dataset =
    train || test || hiddenLabels
      ? {
          ...(train ? { train } : {}),
          ...(test ? { test } : {}),
          ...(hiddenLabels ? { hidden_labels: hiddenLabels } : {}),
        }
      : undefined;

  const presetId = resolveChallengePresetId({
    type: state.type,
    presetId:
      state.type === "reproducibility"
        ? state.reproPresetId
        : TYPE_CONFIG[state.type].defaultPresetId,
  });

  const minimumScore = state.minimumScore.trim();
  const disputeWindow = state.disputeWindow.trim();

  return buildChallengeSpecDraft({
    id: `web-${Date.now()}`,
    title: state.title,
    domain: state.domain as ChallengeSpec["domain"],
    type: state.type,
    description: state.description,
    referenceUrl: state.referenceLink,
    dataset,
    scoring: {
      container: state.container,
      metric: state.metric as ChallengeSpec["scoring"]["metric"],
    },
    reward: {
      total: Number(state.reward),
      distribution: state.distribution,
    },
    deadline: computeDeadlineIso(state.deadlineDays),
    submission:
      state.type === "prediction"
        ? {
            type: "prediction",
            idColumn: state.idColumn,
            valueColumn: state.labelColumn,
          }
        : state.type === "reproducibility"
          ? {
              type: "reproducibility",
              requiredColumns: state.detectedColumns,
            }
          : state.type === "docking"
            ? { type: "docking" }
            : { type: state.type },
    minimumScore: minimumScore ? Number(minimumScore) : undefined,
    disputeWindowHours: disputeWindow ? Number(disputeWindow) : undefined,
    evaluation: {
      criteria: state.evaluationCriteria,
      success_definition: state.successDefinition,
      tolerance: state.tolerance,
    },
    tags: state.tags,
    labTba: zeroAddress,
    presetId,
  });
}
