import fs from "node:fs/promises";
import path from "node:path";
import { downloadToPath, getText } from "@agora/ipfs";
import { Command } from "commander";
import { getChallengeApi, getChallengeSolverStatusApi } from "../lib/api";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import {
  printJson,
  printSuccess,
  printTable,
  printWarning,
} from "../lib/output";
import { resolveOptionalSolverAddress } from "../lib/wallet";

type ChallengeRecord = {
  id: string;
  title: string;
  domain: string;
  challenge_type: string;
  reward_amount: number | string;
  deadline: string;
  status: string;
  spec_cid?: string | null;
  submission_contract?: {
    kind?: string | null;
    file?: {
      extension?: string | null;
    } | null;
  } | null;
};

type PublicArtifactRecord = {
  role: string;
  visibility: "public";
  uri: string;
  file_name?: string | null;
  mime_type?: string | null;
  description?: string | null;
  url?: string | null;
};

type ChallengeArtifactsRecord = {
  public: PublicArtifactRecord[];
  private: Array<{
    role: string;
    visibility: "private";
    file_name?: string | null;
    mime_type?: string | null;
    description?: string | null;
  }>;
  spec_cid: string | null;
  spec_url: string | null;
};

type SubmissionRecord = {
  on_chain_sub_id: number;
  score?: string | null;
  scored: boolean;
  solver_address: string;
};

type SolverStatusRecord = {
  solver_address: string;
  submissions_used: number;
  submissions_remaining: number | null;
  max_submissions_per_solver: number | null;
  claimable: string;
  can_claim: boolean;
};

function filenameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url);
    const base = path.basename(parsed.pathname);
    return base || fallback;
  } catch {
    return fallback;
  }
}

function getArtifactFallbackExtension(
  artifact: PublicArtifactRecord,
  challenge: ChallengeRecord,
) {
  if (artifact.mime_type === "text/csv") {
    return ".csv";
  }
  const extension = challenge.submission_contract?.file?.extension?.trim();
  if (extension) {
    return extension.startsWith(".") ? extension : `.${extension}`;
  }
  return ".data";
}

function artifactBaseName(role: string) {
  switch (role) {
    case "training_data":
      return "train";
    case "evaluation_features":
      return "test";
    case "hidden_labels":
      return "hidden_labels";
    case "source_data":
      return "source_data";
    case "reference_output":
      return "reference_output";
    case "ranking_inputs":
      return "ranking_inputs";
    case "reference_ranking":
      return "reference_ranking";
    default:
      return role;
  }
}

export function resolveArtifactFileName(input: {
  artifact: PublicArtifactRecord;
  index: number;
  challenge: ChallengeRecord;
}) {
  const explicitFileName = input.artifact.file_name;
  if (
    typeof explicitFileName === "string" &&
    explicitFileName.trim().length > 0
  ) {
    return explicitFileName.trim();
  }
  return filenameFromUrl(
    input.artifact.uri,
    `${artifactBaseName(input.artifact.role)}${getArtifactFallbackExtension(input.artifact, input.challenge)}`,
  );
}

export function buildGetCommand() {
  const cmd = new Command("get")
    .description("Get challenge details")
    .argument("<id>", "Challenge id")
    .option("--download <dir>", "Download spec + public artifacts to directory")
    .option(
      "--address <address>",
      "Optional solver wallet address (defaults to the configured private key wallet when available)",
    )
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        id: string,
        opts: { download?: string; address?: string; format: string },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, ["api_url"]);

        const response = await getChallengeApi(id);
        const challenge = response.data.challenge as ChallengeRecord;
        const artifacts = response.data.artifacts as ChallengeArtifactsRecord;
        const submissions = response.data.submissions as SubmissionRecord[];
        const leaderboard = response.data.leaderboard as SubmissionRecord[];
        const solverAddress = resolveOptionalSolverAddress(opts.address);
        const solver = solverAddress
          ? ((await getChallengeSolverStatusApi(challenge.id, solverAddress))
              .data as SolverStatusRecord)
          : null;

        if (opts.download) {
          const targetDir = path.resolve(process.cwd(), opts.download, id);
          await fs.mkdir(targetDir, { recursive: true });
          const specCid = artifacts.spec_cid ?? challenge.spec_cid ?? null;
          if (!specCid) {
            throw new Error(
              "Challenge detail is missing spec_cid. Next step: retry against the canonical Agora API or choose a current-schema challenge.",
            );
          }
          const specText = await getText(specCid);
          await fs.writeFile(
            path.join(targetDir, "challenge.yaml"),
            specText,
            "utf8",
          );

          const usedNames = new Set<string>();
          for (const [index, artifact] of artifacts.public.entries()) {
            let fileName = resolveArtifactFileName({
              artifact,
              index,
              challenge,
            });
            while (usedNames.has(fileName)) {
              const parsed = path.parse(fileName);
              fileName = `${parsed.name}-${index + 1}${parsed.ext}`;
            }
            usedNames.add(fileName);
            await downloadToPath(
              artifact.uri,
              path.join(targetDir, fileName),
            );
          }
          printSuccess(`Downloaded challenge assets to ${targetDir}`);
        }

        if (opts.format === "json") {
          printJson({ challenge, artifacts, submissions, leaderboard, solver });
          return;
        }

        printSuccess(`Challenge ${challenge.id}`);
        printTable([
          {
            id: challenge.id,
            title: challenge.title,
            domain: challenge.domain,
            type: challenge.challenge_type,
            reward: challenge.reward_amount,
            deadline: challenge.deadline,
            status: challenge.status,
          },
        ] as Record<string, unknown>[]);

        if (solver) {
          printWarning("Solver view");
          printTable([
            {
              solver: solver.solver_address,
              my_submissions: solver.submissions_used,
              remaining_submissions:
                solver.submissions_remaining ?? "unlimited",
              claimable: solver.claimable,
              can_claim: solver.can_claim,
            },
          ] as Record<string, unknown>[]);
        }

        if (submissions.length > 0) {
          printWarning("Submissions");
          const submissionRows = submissions.map(
            (submission: SubmissionRecord, index: number) => ({
              rank: index + 1,
              on_chain_sub_id: submission.on_chain_sub_id,
              score: submission.score ?? "",
              scored: submission.scored,
              solver: submission.solver_address,
            }),
          );
          printTable(submissionRows as Record<string, unknown>[]);
        } else {
          printWarning("No submissions yet.");
        }
      },
    );

  return cmd;
}
