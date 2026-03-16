import {
  getSubmissionStatus,
  getSubmissionStatusByProtocolRefs,
} from "./shared.js";

export interface GetSubmissionStatusInput {
  submissionId?: string;
  challengeAddress?: string;
  onChainSubmissionId?: number;
}

export async function agoraGetSubmissionStatus(
  input: GetSubmissionStatusInput,
) {
  if (input.submissionId) {
    return getSubmissionStatus(input.submissionId);
  }
  if (input.challengeAddress && typeof input.onChainSubmissionId === "number") {
    return getSubmissionStatusByProtocolRefs({
      challengeAddress: input.challengeAddress,
      onChainSubmissionId: input.onChainSubmissionId,
    });
  }
  throw new Error(
    "Missing submission status identifier. Next step: provide submissionId or challengeAddress with onChainSubmissionId.",
  );
}
