import { getChallenge } from "./shared.js";

export interface GetLeaderboardInput {
  challengeId: string;
}

export async function agoraGetLeaderboard(input: GetLeaderboardInput) {
  const { leaderboard } = await getChallenge(input.challengeId);
  return leaderboard;
}
