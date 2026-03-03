import {
  createSupabaseClient,
  getChallengeById,
  listChallengesWithDetails,
  listSubmissionsForChallenge,
} from "@hermes/db";
import {
  CHALLENGE_DB_STATUS,
  CHALLENGE_STATUS,
  deriveDisplayStatus,
  isChallengeDbStatus,
  type ChallengeDbStatus,
  type ChallengeDisplayStatus,
} from "@hermes/common";
import { z } from "zod";

export const listChallengesQuerySchema = z.object({
  status: z
    .enum([
      CHALLENGE_STATUS.active,
      CHALLENGE_STATUS.scoring,
      CHALLENGE_STATUS.finalized,
      CHALLENGE_STATUS.disputed,
      CHALLENGE_STATUS.cancelled,
    ])
    .optional(),
  domain: z.string().optional(),
  poster_address: z.string().optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value))
    .optional(),
  min_reward: z
    .string()
    .transform((value) => Number(value))
    .refine((value) => !Number.isNaN(value), {
      message: "min_reward must be a valid number.",
    })
    .optional(),
});

export function sortByScoreDesc<T extends { score: unknown; scored?: unknown }>(
  rows: T[],
) {
  return [...rows]
    .filter((row) => row.scored === true && row.score !== null)
    .sort((a, b) => {
      const aScore = BigInt(String(a.score ?? "0"));
      const bScore = BigInt(String(b.score ?? "0"));
      return bScore > aScore ? 1 : bScore < aScore ? -1 : 0;
    });
}

function withDerivedDisplayStatus<T extends Record<string, unknown>>(row: T) {
  const rawStatus = row.status;
  const dbStatus = isChallengeDbStatus(rawStatus)
    ? rawStatus
    : CHALLENGE_DB_STATUS.active;
  const deadline =
    typeof row.deadline === "string" ? row.deadline : undefined;
  const status = deriveDisplayStatus({
    dbStatus,
    deadline,
  });
  return {
    ...row,
    db_status: dbStatus,
    status,
  };
}

export async function listChallengesFromQuery(
  query: z.output<typeof listChallengesQuerySchema>,
) {
  const db = createSupabaseClient(false);
  const dbStatusFilter: ChallengeDbStatus | undefined =
    query.status === CHALLENGE_STATUS.scoring
      ? CHALLENGE_DB_STATUS.active
      : query.status;
  const rows = await listChallengesWithDetails(db, {
    status: dbStatusFilter,
    domain: query.domain,
    posterAddress: query.poster_address,
    limit: query.limit,
  });
  const displayRows = rows.map((row) => withDerivedDisplayStatus(row));

  const statusFilteredRows = query.status
    ? displayRows.filter(
        (row) =>
          (row.status as ChallengeDisplayStatus) === query.status,
      )
    : displayRows;

  const minReward = query.min_reward;
  return minReward === undefined
    ? statusFilteredRows
    : statusFilteredRows.filter(
      (row: Record<string, unknown>) => Number(row.reward_amount) >= minReward,
    );
}

export async function getChallengeWithLeaderboard(challengeId: string) {
  const db = createSupabaseClient(false);
  const challenge = withDerivedDisplayStatus(await getChallengeById(db, challengeId));
  const submissions = await listSubmissionsForChallenge(db, challengeId);
  const leaderboard = sortByScoreDesc(submissions);
  return { challenge, submissions, leaderboard };
}
