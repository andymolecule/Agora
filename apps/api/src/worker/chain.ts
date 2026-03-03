import { finalizeChallenge, getOnChainSubmission, getPublicClient, postScore } from "@hermes/chain";
import { CHALLENGE_STATUS } from "@hermes/common";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with { type: "json" };
import {
  clearJobPostedTx,
  completeJob,
  markJobPosted,
  requeueJobWithoutAttemptPenalty,
  updateScore,
  type createSupabaseClient,
} from "@hermes/db";
import { type Abi } from "viem";
import type { ScoreJobRow, SubmissionRow, WorkerLogFn } from "./types.js";

const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

type DbClient = ReturnType<typeof createSupabaseClient>;

export async function reconcileScoredSubmission(
  db: DbClient,
  submission: SubmissionRow,
  challengeAddress: `0x${string}`,
  scoreTxHash: string | null,
  jobId: string,
) {
  const onChain = await getOnChainSubmission(
    challengeAddress,
    BigInt(submission.on_chain_sub_id),
  );
  if (!onChain.scored) return false;

  await updateScore(db, {
    submission_id: submission.id,
    score: onChain.score.toString(),
    proof_bundle_cid: submission.proof_bundle_cid ?? "",
    proof_bundle_hash: onChain.proofBundleHash,
    scored_at: new Date().toISOString(),
  });
  await completeJob(db, jobId, scoreTxHash ?? undefined);
  return true;
}

export async function handlePreviouslyPostedScoreTx(
  db: DbClient,
  job: ScoreJobRow,
  submission: SubmissionRow,
  challengeAddress: `0x${string}`,
  publicClient: ReturnType<typeof getPublicClient>,
  log: WorkerLogFn,
) {
  if (!job.score_tx_hash) return false;

  try {
    const postedReceipt = await publicClient.getTransactionReceipt({
      hash: job.score_tx_hash as `0x${string}`,
    });
    if (postedReceipt.status === "success") {
      if (
        await reconcileScoredSubmission(
          db,
          submission,
          challengeAddress,
          job.score_tx_hash,
          job.id,
        )
      ) {
        log("info", "Posted tx succeeded; reconciled and completed job", {
          jobId: job.id,
          submissionId: submission.id,
          txHash: job.score_tx_hash,
        });
        return true;
      }
      const reason =
        "Score tx mined but submission is not marked scored on-chain yet.";
      await requeueJobWithoutAttemptPenalty(db, job.id, job.attempts, reason);
      log("warn", reason, {
        jobId: job.id,
        submissionId: submission.id,
        txHash: job.score_tx_hash,
      });
      return true;
    }

    await clearJobPostedTx(db, job.id);
    log("warn", "Posted tx reverted; cleared score_tx_hash and retrying scoring", {
      jobId: job.id,
      submissionId: submission.id,
      txHash: job.score_tx_hash,
    });
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /not found|could not be found|missing or invalid|unknown transaction/i.test(
        message,
      )
    ) {
      const reason = `Score tx pending confirmation: ${job.score_tx_hash}`;
      await requeueJobWithoutAttemptPenalty(db, job.id, job.attempts, reason);
      log("info", reason, {
        jobId: job.id,
        submissionId: submission.id,
      });
      return true;
    }
    throw error;
  }
}

export async function postScoreAndWaitForConfirmation(
  db: DbClient,
  job: ScoreJobRow,
  challengeAddress: `0x${string}`,
  submission: SubmissionRow,
  scoreWad: bigint,
  proofHash: `0x${string}`,
  publicClient: ReturnType<typeof getPublicClient>,
  log: WorkerLogFn,
) {
  log("info", "Posting score on-chain", {
    submissionId: submission.id,
    scoreWad: scoreWad.toString(),
  });
  const txHash = await postScore(
    challengeAddress,
    BigInt(submission.on_chain_sub_id),
    scoreWad,
    proofHash,
  );
  await markJobPosted(db, job.id, txHash);
  log("info", "Score tx submitted", { submissionId: submission.id, txHash });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`Score transaction reverted: ${txHash}`);
  }
  log("info", "Score tx confirmed on-chain", { submissionId: submission.id, txHash });
  return txHash;
}

export async function sweepFinalizable(
  db: DbClient,
  log: WorkerLogFn,
) {
  const { data: challenges, error } = await db
    .from("challenges")
    .select("id, contract_address, status")
    .eq("status", CHALLENGE_STATUS.active);

  if (error || !challenges || challenges.length === 0) return;

  const publicClient = getPublicClient();

  for (const challenge of challenges) {
    try {
      const [onChainStatusRaw, onChainDeadline, onChainDisputeWindowHours] =
        await Promise.all([
          publicClient.readContract({
            address: challenge.contract_address as `0x${string}`,
            abi: HermesChallengeAbi,
            functionName: "status",
          }),
          publicClient.readContract({
            address: challenge.contract_address as `0x${string}`,
            abi: HermesChallengeAbi,
            functionName: "deadline",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: challenge.contract_address as `0x${string}`,
            abi: HermesChallengeAbi,
            functionName: "disputeWindowHours",
          }) as Promise<bigint>,
        ]);
      const onChainStatus = Number(onChainStatusRaw);
      if (!Number.isFinite(onChainStatus)) continue;

      if (onChainStatus >= 2) continue;

      const finalizeAfterSeconds =
        onChainDeadline + onChainDisputeWindowHours * 3600n;
      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      if (nowSeconds <= finalizeAfterSeconds) continue;

      log("info", `Auto-finalizing challenge ${challenge.id}`, {
        challengeId: challenge.id,
        contract: challenge.contract_address,
      });

      const txHash = await finalizeChallenge(
        challenge.contract_address as `0x${string}`,
      );

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === "success") {
        log("info", "Challenge finalized", { challengeId: challenge.id, txHash });
      } else {
        log("warn", "Finalize tx reverted", { challengeId: challenge.id, txHash });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ChallengeFinalized") || msg.includes("Finalized")) {
        continue;
      }
      log("warn", `Auto-finalize failed for challenge ${challenge.id}`, {
        challengeId: challenge.id,
        error: msg,
      });
    }
  }
}
