import {
  CHALLENGE_LIMITS,
  validateChallengeScoreability,
  validateChallengeSpec,
  validatePresetIntegrity,
  validateScoringContainer,
} from "@agora/common";
import { CHAIN_ID } from "../../lib/config";
import { type FormState, TYPE_CONFIG, buildSpec } from "./post-client-model";

export function isCustomChallengeType(type: FormState["type"]) {
  return type === "custom" || type === "optimization" || type === "red_team";
}

export function validatePostForm(state: FormState) {
  const rewardValue = Number(state.reward || 0);

  if (!state.title.trim() || !state.description.trim()) {
    return "Title and description are required.";
  }

  if (state.referenceLink.trim()) {
    try {
      new URL(state.referenceLink.trim());
    } catch {
      return "Reference paper or protocol link must be a valid URL.";
    }
  }

  if (!Number.isFinite(rewardValue) || rewardValue <= 0) {
    return "Reward must be a positive number.";
  }
  if (
    rewardValue < CHALLENGE_LIMITS.rewardMinUsdc ||
    rewardValue > CHALLENGE_LIMITS.rewardMaxUsdc
  ) {
    return `Reward must be between ${CHALLENGE_LIMITS.rewardMinUsdc} and ${CHALLENGE_LIMITS.rewardMaxUsdc} USDC.`;
  }

  if (state.type === "prediction") {
    if (!state.train.trim()) {
      return "Training dataset is required for prediction challenges.";
    }
    if (!state.test.trim()) {
      return "Test dataset is required for prediction challenges.";
    }
    if (!state.hiddenLabels.trim()) {
      return "Hidden labels are required for prediction challenges. Upload the ground truth used for scoring.";
    }
    if (!state.idColumn.trim()) {
      return "Row ID column is required for prediction challenges.";
    }
    if (!state.labelColumn.trim()) {
      return "Prediction column name is required for prediction challenges.";
    }
    if (state.idColumn.trim() === state.labelColumn.trim()) {
      return "Row ID column and prediction column must be different.";
    }
  } else if (state.type === "reproducibility") {
    if (!state.train.trim()) {
      return "Input dataset is required for reproducibility challenges.";
    }
    if (!state.test.trim()) {
      return "Reference output is required for reproducibility challenges. Upload the CSV the scorer compares submissions against.";
    }
    if (state.detectedColumns.length === 0) {
      return "Reference output must be a CSV with a header row so Agora can lock the submission contract.";
    }
  } else if (state.type === "optimization") {
    if (!state.train.trim()) {
      return "Evaluation bundle is required for optimization challenges.";
    }
  } else if (state.type === "docking") {
    if (!state.train.trim()) {
      return "Target structure is required for docking challenges.";
    }
    if (!state.test.trim()) {
      return "Ligand set is required for docking challenges.";
    }
  } else if (state.type === "red_team" && !state.train.trim()) {
    return "Baseline data is required for red team challenges.";
  }

  if (!state.container.trim()) {
    return "Scoring container is required.";
  }

  const containerError = validateScoringContainer(state.container);
  if (containerError) {
    return containerError;
  }

  const presetId =
    state.type === "reproducibility"
      ? state.reproPresetId
      : TYPE_CONFIG[state.type].defaultPresetId;
  const presetIntegrityError = validatePresetIntegrity(
    presetId,
    state.container,
  );
  if (presetIntegrityError) {
    return presetIntegrityError;
  }

  const minimumScore = Number(state.minimumScore);
  if (state.minimumScore.trim() && !Number.isFinite(minimumScore)) {
    return "Minimum score must be a valid number.";
  }

  if (state.tolerance.trim() && !Number.isFinite(Number(state.tolerance))) {
    return "Tolerance must be a valid number (e.g. 1e-4 or 0.001).";
  }
  if (state.tolerance.trim() && Number(state.tolerance) < 0) {
    return "Tolerance must be zero or greater.";
  }

  if (state.disputeWindow.trim()) {
    const disputeWindow = Number(state.disputeWindow);
    if (
      !Number.isFinite(disputeWindow) ||
      disputeWindow < 0 ||
      disputeWindow > CHALLENGE_LIMITS.disputeWindowMaxHours
    ) {
      return `Dispute window must be between 0 and ${CHALLENGE_LIMITS.disputeWindowMaxHours} hours.`;
    }
  }

  let draftSpec: ReturnType<typeof buildSpec>;
  try {
    draftSpec = buildSpec(state);
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Challenge spec is invalid.";
  }

  const specResult = validateChallengeSpec(draftSpec, CHAIN_ID);
  if (!specResult.success) {
    return specResult.error.issues[0]?.message ?? "Challenge spec is invalid.";
  }

  const scoreability = validateChallengeScoreability(specResult.data);
  if (!scoreability.ok) {
    return scoreability.errors[0] ?? "Challenge is not scoreable.";
  }

  return null;
}
