import { getChallenge } from "./shared.js";

export interface GetChallengeInput {
  challengeId: string;
}

export async function agoraGetChallenge(input: GetChallengeInput) {
  return getChallenge(input.challengeId);
}
