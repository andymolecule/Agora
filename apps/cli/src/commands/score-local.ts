import { createSupabaseClient, getChallengeById } from "@hermes/db";
import { executeScoringPipeline } from "@hermes/scorer";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";

type ChallengeRecord = {
  id: string;
  title: string;
  scoring_container: string;
  dataset_test_cid: string | null;
};

export function buildScoreLocalCommand() {
  const cmd = new Command("score-local")
    .description("Run scorer locally for a challenge + submission file")
    .argument("<challengeId>", "Challenge id")
    .requiredOption("--submission <path>", "Path to local submission file")
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        challengeId: string,
        opts: { submission: string; format: string },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, ["supabase_url", "supabase_anon_key"]);

        const db = createSupabaseClient(false);
        const challenge = (await getChallengeById(
          db,
          challengeId,
        )) as ChallengeRecord;
        if (!challenge.dataset_test_cid) {
          throw new Error("Challenge missing test dataset CID.");
        }

        const runSpinner = createSpinner("Running scorer container...");
        const run = await executeScoringPipeline({
          image: challenge.scoring_container,
          groundTruth: { cid: challenge.dataset_test_cid },
          submission: { localPath: opts.submission },
        });
        runSpinner.succeed("Scorer finished");

        const output = {
          challengeId: challenge.id,
          score: run.result.score,
          details: run.result.details,
          containerImageDigest: run.result.containerImageDigest,
          inputFiles: run.inputPaths,
        };

        if (opts.format === "json") {
          printJson(output);
          return;
        }

        printSuccess(`Score: ${run.result.score}`);
        printWarning(`Image: ${run.result.containerImageDigest}`);
        printJson(run.result.details);
      },
    );

  return cmd;
}
