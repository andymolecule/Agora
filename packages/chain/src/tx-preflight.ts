import {
  ACTIVE_CONTRACT_VERSION,
  AGORA_ERROR_CODES,
  AgoraError,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import { type Abi } from "viem";
import { getPublicClient } from "./client.js";
import { getChallengeContractVersion } from "./challenge.js";

const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;
const MIN_GAS_BUFFER = 21_000n;
const GAS_BUFFER_NUMERATOR = 12n;
const GAS_BUFFER_DENOMINATOR = 10n;

type ChallengeWriteFunction = "submit" | "claim" | "finalize";
type EstimateCapablePublicClient = Pick<
  ReturnType<typeof getPublicClient>,
  "estimateContractGas" | "estimateFeesPerGas" | "getGasPrice" | "getBalance"
>;

function withGasBuffer(estimatedGas: bigint) {
  const scaled = (estimatedGas * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
  const additive = estimatedGas + MIN_GAS_BUFFER;
  return scaled > additive ? scaled : additive;
}

function classifyEstimateError(error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (/execution reverted|revert/i.test(message)) {
    return new AgoraError(`${label} cannot be submitted in the current challenge state.`, {
      code: AGORA_ERROR_CODES.txReverted,
      retriable: false,
      nextAction:
        "Confirm the challenge state, deadline, submission limits, and wallet eligibility before retrying.",
      cause: error,
      details: { label },
    });
  }

  return new AgoraError(`${label} gas estimate failed.`, {
    code: AGORA_ERROR_CODES.chainEstimateFailed,
    retriable: true,
    nextAction: "Retry in a few seconds or inspect the RPC endpoint if the problem persists.",
    cause: error,
    details: { label },
  });
}

async function estimateChallengeWriteCost(input: {
  accountAddress: `0x${string}`;
  challengeAddress: `0x${string}`;
  functionName: ChallengeWriteFunction;
  args: readonly unknown[];
  label: string;
  publicClient?: EstimateCapablePublicClient;
  contractVersion?: number;
}) {
  const publicClient = input.publicClient ?? getPublicClient();
  const contractVersion =
    input.contractVersion ??
    (await getChallengeContractVersion(input.challengeAddress));
  if (contractVersion !== ACTIVE_CONTRACT_VERSION) {
    throw new AgoraError(
      `${input.label} targets unsupported challenge contract version ${contractVersion}.`,
      {
        code: AGORA_ERROR_CODES.chainEstimateFailed,
        retriable: false,
        nextAction: `Point the runtime at the active v${ACTIVE_CONTRACT_VERSION} challenge deployment and retry.`,
        details: {
          label: input.label,
          contractVersion,
          supportedVersion: ACTIVE_CONTRACT_VERSION,
        },
      },
    );
  }

  let estimatedGas: bigint;
  try {
    estimatedGas = await publicClient.estimateContractGas({
      account: input.accountAddress,
      address: input.challengeAddress,
      abi: AgoraChallengeAbi,
      functionName: input.functionName,
      args: input.args,
    });
  } catch (error) {
    throw classifyEstimateError(error, input.label);
  }

  const feeEstimate = await publicClient.estimateFeesPerGas().catch(() => null);
  const maxFeePerGas =
    feeEstimate?.maxFeePerGas ??
    feeEstimate?.gasPrice ??
    (await publicClient.getGasPrice());
  const bufferedGas = withGasBuffer(estimatedGas);
  const requiredBalanceWei = bufferedGas * maxFeePerGas;
  const currentBalanceWei = await publicClient.getBalance({
    address: input.accountAddress,
  });

  return {
    estimatedGas,
    bufferedGas,
    maxFeePerGas,
    requiredBalanceWei,
    currentBalanceWei,
  };
}

function assertEstimatedBalance(input: {
  actionLabel: string;
  accountAddress: `0x${string}`;
  challengeAddress: `0x${string}`;
  requiredBalanceWei: bigint;
  currentBalanceWei: bigint;
  estimatedGas: bigint;
  bufferedGas: bigint;
  maxFeePerGas: bigint;
}) {
  if (input.currentBalanceWei >= input.requiredBalanceWei) {
    return;
  }

  throw new AgoraError(
    `Wallet ${input.accountAddress} does not have enough gas for ${input.actionLabel}.`,
    {
      code: AGORA_ERROR_CODES.insufficientGas,
      retriable: false,
      nextAction: "Fund the wallet with native gas and retry.",
      details: {
        action: input.actionLabel,
        accountAddress: input.accountAddress,
        challengeAddress: input.challengeAddress,
        estimatedGas: input.estimatedGas.toString(),
        bufferedGas: input.bufferedGas.toString(),
        maxFeePerGasWei: input.maxFeePerGas.toString(),
        requiredBalanceWei: input.requiredBalanceWei.toString(),
        currentBalanceWei: input.currentBalanceWei.toString(),
      },
    },
  );
}

export async function assertSubmitChallengeResultAffordable(input: {
  accountAddress: `0x${string}`;
  challengeAddress: `0x${string}`;
  resultHash?: `0x${string}`;
  publicClient?: EstimateCapablePublicClient;
  contractVersion?: number;
}) {
  const estimate = await estimateChallengeWriteCost({
    accountAddress: input.accountAddress,
    challengeAddress: input.challengeAddress,
    functionName: "submit",
    args: [
      input.resultHash ??
        ("0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`),
    ],
    label: "Submission transaction",
    publicClient: input.publicClient,
    contractVersion: input.contractVersion,
  });
  assertEstimatedBalance({
    actionLabel: "submission",
    accountAddress: input.accountAddress,
    challengeAddress: input.challengeAddress,
    ...estimate,
  });
  return estimate;
}

export async function assertClaimChallengePayoutAffordable(input: {
  accountAddress: `0x${string}`;
  challengeAddress: `0x${string}`;
  publicClient?: EstimateCapablePublicClient;
  contractVersion?: number;
}) {
  const estimate = await estimateChallengeWriteCost({
    accountAddress: input.accountAddress,
    challengeAddress: input.challengeAddress,
    functionName: "claim",
    args: [],
    label: "Claim transaction",
    publicClient: input.publicClient,
    contractVersion: input.contractVersion,
  });
  assertEstimatedBalance({
    actionLabel: "claim",
    accountAddress: input.accountAddress,
    challengeAddress: input.challengeAddress,
    ...estimate,
  });
  return estimate;
}

export async function assertFinalizeChallengeAffordable(input: {
  accountAddress: `0x${string}`;
  challengeAddress: `0x${string}`;
  publicClient?: EstimateCapablePublicClient;
  contractVersion?: number;
}) {
  const estimate = await estimateChallengeWriteCost({
    accountAddress: input.accountAddress,
    challengeAddress: input.challengeAddress,
    functionName: "finalize",
    args: [],
    label: "Finalize transaction",
    publicClient: input.publicClient,
    contractVersion: input.contractVersion,
  });
  assertEstimatedBalance({
    actionLabel: "finalize",
    accountAddress: input.accountAddress,
    challengeAddress: input.challengeAddress,
    ...estimate,
  });
  return estimate;
}
