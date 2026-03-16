import {
  formatDeadlineDate,
  formatFinalizationCheckDate,
  formatSubmissionWindowLabel,
} from "../../lib/post-submission-window";
import {
  DISTRIBUTION_SUMMARY_LABELS,
  type FormState,
  TYPE_CONFIG,
  engineDisplayName,
  scoringRuleLabel,
} from "./post-client-model";

export type PostLifecycleStep = {
  label: string;
  detail: string;
  note: string;
  active: boolean;
};

export function getChallengeTypeLabel(state: FormState) {
  return TYPE_CONFIG[state.type].label;
}

export function getDistributionSummaryLabel(
  distribution: FormState["distribution"],
) {
  return DISTRIBUTION_SUMMARY_LABELS[distribution];
}

export function getOfficialScoringSummary(
  state: FormState,
  isCustomType: boolean,
) {
  if (state.type === "reproducibility" || state.type === "prediction") {
    return scoringRuleLabel(state);
  }
  if (isCustomType) {
    return "Custom scorer";
  }
  return engineDisplayName(state.container);
}

export function getLifecycleSteps(state: FormState): PostLifecycleStep[] {
  return [
    {
      label: "Submissions open",
      detail: `Duration: ${formatSubmissionWindowLabel(state.deadlineDays)}`,
      note: "Solvers can start submitting as soon as the contract is deployed.",
      active: true,
    },
    {
      label: "Deadline",
      detail: formatDeadlineDate(state.deadlineDays),
      note: "Submissions lock permanently once the deadline passes.",
      active: false,
    },
    {
      label: "Scoring",
      detail: "Automatic",
      note: "Managed scoring runs deterministically against the posted evaluation spec.",
      active: false,
    },
    {
      label: "Review window",
      detail:
        state.disputeWindow === "0"
          ? "Duration: none"
          : `Duration: ${state.disputeWindow}h`,
      note: "Anyone can challenge the result before settlement can proceed.",
      active: false,
    },
    {
      label: "Earliest finalization check",
      detail: formatFinalizationCheckDate(
        state.deadlineDays,
        state.disputeWindow,
      ),
      note: "Finalization still depends on scoring completion or the scoring grace period.",
      active: false,
    },
  ];
}
