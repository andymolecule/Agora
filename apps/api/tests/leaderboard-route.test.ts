import assert from "node:assert/strict";
import test from "node:test";
import { createLeaderboardRouter } from "../src/routes/leaderboard.js";

test("leaderboard route reads finalized data with the service client", async () => {
  let createSupabaseClientArg: boolean | null = null;
  const router = createLeaderboardRouter({
    createSupabaseClient: ((useServiceKey?: boolean) => {
      createSupabaseClientArg = useServiceKey ?? false;
      return {} as never;
    }) as never,
    getPublicLeaderboard: async () =>
      [
        {
          address: "0x00000000000000000000000000000000000000aa",
          totalSubmissions: 2,
          challengesParticipated: 1,
          scoredSubmissions: 2,
          wins: 1,
          winRate: 100,
          totalEarnedUsdc: 18,
          challenges: [],
        },
      ] as never,
  });

  const response = await router.request(new Request("http://localhost/"));
  assert.equal(response.status, 200);
  assert.equal(createSupabaseClientArg, true);

  const body = (await response.json()) as {
    data: Array<{ totalEarnedUsdc: number }>;
  };
  assert.equal(body.data[0]?.totalEarnedUsdc, 18);
});
