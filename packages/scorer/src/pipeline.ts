import fs from "node:fs/promises";
import path from "node:path";
import { downloadToPath } from "@hermes/ipfs";
import { runScorer, type RunScorerInput, type ScoreResult } from "./runner.js";
import { cleanupWorkspace, createScoringWorkspace } from "./staging.js";

export interface ScoringInputSource {
  cid?: string;
  localPath?: string;
  content?: string;
}

export interface ExecuteScoringPipelineInput {
  image: string;
  groundTruth?: ScoringInputSource;
  submission: ScoringInputSource;
  timeoutMs?: number;
  limits?: RunScorerInput["limits"];
  keepWorkspace?: boolean;
}

export interface ScoringPipelineResult {
  result: ScoreResult;
  workspaceRoot: string;
  inputDir: string;
  groundTruthPath?: string;
  submissionPath: string;
  inputPaths: string[];
  cleanup: () => Promise<void>;
}

async function stageSourceToPath(
  source: ScoringInputSource,
  destinationPath: string,
) {
  const hasCid = typeof source.cid === "string" && source.cid.length > 0;
  const hasLocalPath =
    typeof source.localPath === "string" && source.localPath.length > 0;
  const hasContent =
    typeof source.content === "string" && source.content.length > 0;
  const sourceCount = [hasCid, hasLocalPath, hasContent].filter(Boolean).length;

  if (sourceCount !== 1) {
    throw new Error(
      "Scoring input source must provide exactly one of: cid, localPath, content.",
    );
  }

  if (hasCid) {
    await downloadToPath(source.cid as string, destinationPath);
    return;
  }

  if (hasLocalPath) {
    const content = await fs.readFile(path.resolve(source.localPath as string));
    await fs.writeFile(destinationPath, content);
    return;
  }

  await fs.writeFile(destinationPath, source.content as string, "utf8");
}

export async function executeScoringPipeline(
  input: ExecuteScoringPipelineInput,
): Promise<ScoringPipelineResult> {
  const workspace = await createScoringWorkspace();
  let done = false;

  const cleanup = async () => {
    if (done) return;
    done = true;
    await cleanupWorkspace(workspace.root);
  };

  try {
    const groundTruthPath = input.groundTruth
      ? path.join(workspace.inputDir, "ground_truth.csv")
      : undefined;
    if (groundTruthPath && input.groundTruth) {
      await stageSourceToPath(input.groundTruth, groundTruthPath);
    }

    const submissionPath = path.join(workspace.inputDir, "submission.csv");
    await stageSourceToPath(input.submission, submissionPath);

    const result = await runScorer({
      image: input.image,
      inputDir: workspace.inputDir,
      timeoutMs: input.timeoutMs,
      limits: input.limits,
    });

    const output: ScoringPipelineResult = {
      result,
      workspaceRoot: workspace.root,
      inputDir: workspace.inputDir,
      groundTruthPath,
      submissionPath,
      inputPaths: [groundTruthPath, submissionPath].filter(
        (value): value is string => typeof value === "string",
      ),
      cleanup,
    };

    if (!input.keepWorkspace) {
      await cleanup();
    }

    return output;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
