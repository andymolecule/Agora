import {
  ACTIVE_CONTRACT_VERSION,
  type ChallengeSpecOutput,
  isValidPinnedSpecCid,
  validateChallengeSpec,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import { getText } from "@agora/ipfs";
import type { Abi } from "viem";
import yaml from "yaml";
import { getPublicClient } from "./client.js";
import { readImmutableContractWithLatestFallback } from "./contract-read.js";

const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

async function readChallengeDefinitionValue<T>(input: {
  publicClient: ReturnType<typeof getPublicClient>;
  challengeAddress: `0x${string}`;
  functionName: "specCid" | "deadline" | "contractVersion";
  blockNumber?: bigint;
}): Promise<T> {
  // These constructor-set fields are immutable, so the latest-state read is
  // equivalent when the RPC has the receipt but not the historical header/code
  // available yet at the pinned block.
  return readImmutableContractWithLatestFallback<T>({
    publicClient: input.publicClient,
    address: input.challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: input.functionName,
    blockNumber: input.blockNumber,
  });
}

export async function fetchValidatedChallengeSpec(
  specCid: string,
  chainId: number,
): Promise<ChallengeSpecOutput> {
  if (!isValidPinnedSpecCid(specCid)) {
    throw new Error(`Invalid or placeholder spec CID: ${specCid}`);
  }

  const rawSpec = await getText(specCid);
  const parsedSpec = yaml.parse(rawSpec) as Record<string, unknown>;
  if (parsedSpec.deadline instanceof Date) {
    parsedSpec.deadline = parsedSpec.deadline.toISOString();
  }

  const specResult = validateChallengeSpec(parsedSpec, chainId);
  if (!specResult.success) {
    throw new Error(
      `Invalid challenge spec: ${specResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }

  return specResult.data;
}

export async function loadChallengeDefinitionFromChain(input: {
  publicClient?: ReturnType<typeof getPublicClient>;
  challengeAddress: `0x${string}`;
  chainId: number;
  blockNumber?: bigint;
}) {
  const { specCid, onChainDeadline, contractVersion } =
    await readChallengeDefinitionMetadataFromChain(input);

  const spec = await fetchValidatedChallengeSpec(specCid, input.chainId);
  if (contractVersion !== ACTIVE_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported challenge contract version ${contractVersion}. Point the runtime at the active v${ACTIVE_CONTRACT_VERSION} deployment and retry.`,
    );
  }

  return {
    specCid,
    spec,
    contractVersion,
    onChainDeadline,
    onChainDeadlineIso: new Date(Number(onChainDeadline) * 1000).toISOString(),
  };
}

export async function readChallengeDefinitionMetadataFromChain(input: {
  publicClient?: ReturnType<typeof getPublicClient>;
  challengeAddress: `0x${string}`;
  blockNumber?: bigint;
}) {
  const publicClient = input.publicClient ?? getPublicClient();

  const [specCid, onChainDeadline, contractVersion] = await Promise.all([
    readChallengeDefinitionValue<string>({
      publicClient,
      challengeAddress: input.challengeAddress,
      functionName: "specCid",
      blockNumber: input.blockNumber,
    }),
    readChallengeDefinitionValue<bigint>({
      publicClient,
      challengeAddress: input.challengeAddress,
      functionName: "deadline",
      blockNumber: input.blockNumber,
    }),
    readChallengeDefinitionValue<bigint>({
      publicClient,
      challengeAddress: input.challengeAddress,
      functionName: "contractVersion",
      blockNumber: input.blockNumber,
    }),
  ]);

  return {
    specCid,
    onChainDeadline,
    contractVersion: Number(contractVersion),
  };
}
