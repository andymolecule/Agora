import type { Challenge } from "./types";

export type ChallengeListSort = "newest" | "deadline" | "reward";

function toTimestamp(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function getNewestTimestamp(challenge: Challenge) {
  const createdAt = toTimestamp(challenge.created_at);
  return createdAt !== Number.NEGATIVE_INFINITY
    ? createdAt
    : toTimestamp(challenge.deadline);
}

export function sortChallenges(
  challenges: Challenge[],
  sort: ChallengeListSort,
) {
  const rows = [...challenges];
  rows.sort((left, right) => {
    if (sort === "reward") {
      return Number(right.reward_amount) - Number(left.reward_amount);
    }
    if (sort === "deadline") {
      return toTimestamp(left.deadline) - toTimestamp(right.deadline);
    }
    return getNewestTimestamp(right) - getNewestTimestamp(left);
  });
  return rows;
}
