import { SUBMISSION_LIMITS, loadConfig } from "@agora/common";
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json" with { type: "json" };
import { type Abi, parseUnits } from "viem";
import { getWalletClient } from "./client.js";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;

export interface CreateChallengeParams {
  specCid: string;
  rewardAmount: number;
  deadline: number;
  disputeWindowHours: number;
  minimumScore: bigint;
  distributionType: number;
  labTba: `0x${string}`;
  maxSubmissions?: number;
  maxSubmissionsPerSolver?: number;
}

export async function createChallenge(params: CreateChallengeParams) {
  const config = loadConfig();
  const walletClient = getWalletClient();
  const factoryAddress = config.AGORA_FACTORY_ADDRESS;
  const reward = parseUnits(params.rewardAmount.toString(), 6);

  return walletClient.writeContract({
    address: factoryAddress,
    abi: AgoraFactoryAbi,
    functionName: "createChallenge",
    args: [
      params.specCid,
      reward,
      BigInt(params.deadline),
      BigInt(params.disputeWindowHours),
      params.minimumScore,
      params.distributionType,
      params.labTba,
      BigInt(params.maxSubmissions ?? SUBMISSION_LIMITS.maxPerChallenge),
      BigInt(
        params.maxSubmissionsPerSolver ??
          SUBMISSION_LIMITS.maxPerSolverPerChallenge,
      ),
    ],
  });
}
