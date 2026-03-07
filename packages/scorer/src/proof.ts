import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ProofBundle as SharedProofBundle } from "@agora/common";

export interface ProofBundleInput {
  challengeId: string;
  submissionId: string;
  score: number;
  scorerLog?: string | null;
  containerImageDigest: string;
  inputPaths: string[];
  outputPath: string;
  challengeSpecCid?: string | null;
  evaluationBundleCid?: string | null;
  replaySubmissionCid?: string | null;
}

export interface ProofBundle extends SharedProofBundle {
  scorerLog?: string;
  meta: {
    challengeId: string;
    submissionId: string;
    createdAt: string;
  };
}

async function sha256OfFile(filePath: string) {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function hashJoined(values: string[]) {
  return createHash("sha256").update(values.join("|")).digest("hex");
}

export async function buildProofBundle(
  input: ProofBundleInput,
): Promise<ProofBundle> {
  const inputHashes = await Promise.all(
    input.inputPaths.map(
      async (filePath) =>
        `${path.basename(filePath)}:${await sha256OfFile(filePath)}`,
    ),
  );
  const outputHash = await sha256OfFile(input.outputPath);

  return {
    score: input.score,
    inputHash: hashJoined(inputHashes.sort()),
    outputHash,
    containerImageDigest: input.containerImageDigest,
    ...(input.scorerLog ? { scorerLog: input.scorerLog } : {}),
    ...(input.challengeSpecCid !== undefined
      ? { challengeSpecCid: input.challengeSpecCid }
      : {}),
    ...(input.evaluationBundleCid !== undefined
      ? { evaluationBundleCid: input.evaluationBundleCid }
      : {}),
    ...(input.replaySubmissionCid !== undefined
      ? { replaySubmissionCid: input.replaySubmissionCid }
      : {}),
    meta: {
      challengeId: input.challengeId,
      submissionId: input.submissionId,
      createdAt: new Date().toISOString(),
    },
  };
}
