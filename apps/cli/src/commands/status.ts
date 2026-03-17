import { Command } from "commander";
import { getChallengeApi, getChallengeSolverStatusApi } from "../lib/api";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printTable } from "../lib/output";
import { resolveOptionalSolverAddress } from "../lib/wallet";

type ChallengeRecord = {
  id: string;
  status: string;
  deadline: string;
  submissions_count?: number;
};

type SubmissionRecord = {
  score?: string | null;
};

type SolverStatusRecord = {
  solver_address: string;
  submissions_used: number;
  submissions_remaining: number | null;
  max_submissions_per_solver: number | null;
  claimable: string;
  can_claim: boolean;
};

function formatCountdown(deadline: string) {
  const deadlineMs = new Date(deadline).getTime();
  if (Number.isNaN(deadlineMs)) return "unknown";
  const diff = deadlineMs - Date.now();
  if (diff <= 0) return "passed";
  const minutes = Math.floor(diff / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return `in ${parts.join(" ")}`;
}

export function buildStatusCommand() {
  const cmd = new Command("status")
    .description("Show quick challenge status")
    .argument("<id>", "Challenge id")
    .option(
      "--address <address>",
      "Optional solver wallet address (defaults to the configured private key wallet when available)",
    )
    .option("--format <format>", "table or json", "table")
    .action(async (id: string, opts: { address?: string; format: string }) => {
      const config = loadCliConfig();
      applyConfigToEnv(config);
      requireConfigValues(config, ["api_url"]);

      const response = await getChallengeApi(id);
      const challenge = response.data.challenge as ChallengeRecord;
      const leaderboard = response.data.leaderboard as SubmissionRecord[];
      const solverAddress = resolveOptionalSolverAddress(opts.address);
      const solver = solverAddress
        ? (await getChallengeSolverStatusApi(challenge.id, solverAddress)).data
        : null;

      const topScore = leaderboard[0]?.score ?? null;
      const summary = {
        id: challenge.id,
        status: challenge.status,
        deadline: challenge.deadline,
        countdown: formatCountdown(challenge.deadline),
        submissions:
          challenge.submissions_count ?? response.data.submissions.length,
        topScore,
      };
      const payload = {
        ...summary,
        solver,
      };

      if (opts.format === "json") {
        printJson(payload);
        return;
      }

      printSuccess(`Challenge ${challenge.id} status`);
      printTable([summary] as Record<string, unknown>[]);
      if (solver) {
        printSuccess(`Solver view for ${solver.solver_address}`);
        printTable([
          {
            solver: solver.solver_address,
            my_submissions: solver.submissions_used,
            remaining_submissions: solver.submissions_remaining ?? "unlimited",
            claimable: solver.claimable,
            can_claim: solver.can_claim,
          },
        ] as Record<string, unknown>[]);
      }
    });

  return cmd;
}
