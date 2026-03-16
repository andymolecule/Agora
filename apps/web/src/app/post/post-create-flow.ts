import {
  CHALLENGE_LIMITS,
  SUBMISSION_LIMITS,
  computeSpecHash,
  erc20Abi,
  getPinSpecAuthorizationTypedData,
} from "@agora/common";
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json";
import type { Dispatch, SetStateAction } from "react";
import { type Abi, parseSignature, parseUnits, zeroAddress } from "viem";
import type {
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { accelerateChallengeIndex } from "../../lib/api";
import {
  type ChallengePostStatus,
  createChallengePostStatus,
  getChallengePostIndexingFailureStatus,
  getChallengePostSuccessStatus,
} from "../../lib/challenge-post";
import {
  assertSupportedContractVersion,
  simulateAndWriteContract,
  waitForTransactionReceiptWithTimeout,
} from "../../lib/wallet/tx";
import { type FormState, buildSpec } from "./post-client-model";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;
const PERMIT_LIFETIME_SECONDS = 60 * 60;
const DISTRIBUTION_TO_ENUM = {
  winner_take_all: 0,
  top_3: 1,
  proportional: 2,
} as const;

type WalletPublicClient = NonNullable<ReturnType<typeof usePublicClient>>;
type SignTypedDataAsync = ReturnType<
  typeof useSignTypedData
>["signTypedDataAsync"];
type WriteContractAsync = ReturnType<
  typeof useWriteContract
>["writeContractAsync"];
type ChallengePostStatusSetter = Dispatch<
  SetStateAction<ChallengePostStatus | null>
>;
type PostedChallengeIdSetter = Dispatch<SetStateAction<string | null>>;

export async function prepareChallengeCreation({
  state,
  address,
  chainId,
  setStatus,
  signTypedDataAsync,
}: {
  state: FormState;
  address: `0x${string}`;
  chainId: number;
  setStatus: ChallengePostStatusSetter;
  signTypedDataAsync: SignTypedDataAsync;
}) {
  setStatus(createChallengePostStatus("Pinning spec to IPFS..."));

  const spec = buildSpec(state);
  const specHash = computeSpecHash(spec);
  const nonceResponse = await fetch("/api/pin-spec", {
    method: "GET",
    cache: "no-store",
  });
  if (!nonceResponse.ok) {
    throw new Error(await nonceResponse.text());
  }

  const { nonce } = (await nonceResponse.json()) as { nonce: string };
  const typedData = getPinSpecAuthorizationTypedData({
    chainId,
    wallet: address,
    specHash,
    nonce,
  });
  const signature = await signTypedDataAsync({
    account: address,
    ...typedData,
  });

  const pinResponse = await fetch("/api/pin-spec", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      spec,
      auth: { address, nonce, specHash, signature },
    }),
  });
  if (!pinResponse.ok) {
    throw new Error(await pinResponse.text());
  }

  const { specCid } = (await pinResponse.json()) as { specCid: string };

  return {
    specCid,
    rewardUnits: parseUnits(String(spec.reward.total), 6),
    deadlineSeconds: BigInt(
      Math.floor(new Date(spec.deadline).getTime() / 1000),
    ),
    disputeWindowHours: BigInt(
      spec.dispute_window_hours ?? CHALLENGE_LIMITS.defaultDisputeWindowHours,
    ),
    minimumScoreWad: parseUnits(String(spec.minimum_score ?? 0), 18),
    distributionType:
      DISTRIBUTION_TO_ENUM[
        spec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM
      ] ?? 0,
  };
}

export async function finalizeChallengePost({
  createTx,
  publicClient,
  setStatus,
  setPostedChallengeId,
}: {
  createTx: `0x${string}`;
  publicClient: WalletPublicClient;
  setStatus: ChallengePostStatusSetter;
  setPostedChallengeId: PostedChallengeIdSetter;
}) {
  await waitForTransactionReceiptWithTimeout({
    publicClient,
    hash: createTx,
  });

  setStatus(
    createChallengePostStatus(
      "Challenge posted on-chain. Registering it in Agora now...",
      {
        postedOnChain: true,
      },
    ),
  );

  try {
    const registration = await accelerateChallengeIndex({ txHash: createTx });
    setPostedChallengeId(registration.challengeId);
    setStatus(getChallengePostSuccessStatus(createTx));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setPostedChallengeId(null);
    setStatus(getChallengePostIndexingFailureStatus(createTx, message));
  }
}

export async function assertFactoryIsSupported({
  publicClient,
  factoryAddress,
}: {
  publicClient: WalletPublicClient;
  factoryAddress: `0x${string}`;
}) {
  await assertSupportedContractVersion({
    publicClient,
    address: factoryAddress,
    abi: AgoraFactoryAbi,
    contractLabel: "factory",
  });
}

export async function signRewardPermit({
  publicClient,
  address,
  tokenName,
  permitVersion,
  chainId,
  usdcAddress,
  factoryAddress,
  rewardUnits,
  signTypedDataAsync,
}: {
  publicClient: WalletPublicClient;
  address: `0x${string}`;
  tokenName: string;
  permitVersion: string;
  chainId: number;
  usdcAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  rewardUnits: bigint;
  signTypedDataAsync: SignTypedDataAsync;
}) {
  const permitDeadline = BigInt(
    Math.floor(Date.now() / 1000) + PERMIT_LIFETIME_SECONDS,
  );
  const permitNonce = (await publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "nonces",
    args: [address],
  })) as bigint;

  const signature = await signTypedDataAsync({
    account: address,
    domain: {
      name: tokenName,
      version: permitVersion,
      chainId,
      verifyingContract: usdcAddress,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner: address,
      spender: factoryAddress,
      value: rewardUnits,
      nonce: permitNonce,
      deadline: permitDeadline,
    },
  });

  const parsedSignature = parseSignature(signature);
  return {
    permitDeadline,
    permitV: Number(parsedSignature.v ?? BigInt(27 + parsedSignature.yParity)),
    permitR: parsedSignature.r,
    permitS: parsedSignature.s,
  };
}

export async function createChallengeWithApproval({
  publicClient,
  writeContractAsync,
  address,
  factoryAddress,
  prepared,
}: {
  publicClient: WalletPublicClient;
  writeContractAsync: WriteContractAsync;
  address: `0x${string}`;
  factoryAddress: `0x${string}`;
  prepared: Awaited<ReturnType<typeof prepareChallengeCreation>>;
}) {
  return simulateAndWriteContract({
    publicClient,
    writeContractAsync,
    account: address,
    address: factoryAddress,
    abi: AgoraFactoryAbi,
    functionName: "createChallenge",
    args: [
      prepared.specCid,
      prepared.rewardUnits,
      prepared.deadlineSeconds,
      prepared.disputeWindowHours,
      prepared.minimumScoreWad,
      prepared.distributionType,
      zeroAddress,
      BigInt(SUBMISSION_LIMITS.maxPerChallenge),
      BigInt(SUBMISSION_LIMITS.maxPerSolverPerChallenge),
    ],
  });
}

export async function createChallengeWithPermit({
  publicClient,
  writeContractAsync,
  address,
  factoryAddress,
  prepared,
  permit,
}: {
  publicClient: WalletPublicClient;
  writeContractAsync: WriteContractAsync;
  address: `0x${string}`;
  factoryAddress: `0x${string}`;
  prepared: Awaited<ReturnType<typeof prepareChallengeCreation>>;
  permit: Awaited<ReturnType<typeof signRewardPermit>>;
}) {
  return simulateAndWriteContract({
    publicClient,
    writeContractAsync,
    account: address,
    address: factoryAddress,
    abi: AgoraFactoryAbi,
    functionName: "createChallengeWithPermit",
    args: [
      prepared.specCid,
      prepared.rewardUnits,
      prepared.deadlineSeconds,
      prepared.disputeWindowHours,
      prepared.minimumScoreWad,
      prepared.distributionType,
      zeroAddress,
      BigInt(SUBMISSION_LIMITS.maxPerChallenge),
      BigInt(SUBMISSION_LIMITS.maxPerSolverPerChallenge),
      permit.permitDeadline,
      permit.permitV,
      permit.permitR,
      permit.permitS,
    ],
  });
}
