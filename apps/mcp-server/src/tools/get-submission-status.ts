import { getSubmissionStatus } from "./shared.js";

export interface GetSubmissionStatusInput {
  submissionId: string;
}

export async function agoraGetSubmissionStatus(
  input: GetSubmissionStatusInput,
) {
  return getSubmissionStatus(input.submissionId);
}
