import {
  allowance,
  balanceOf,
  createAgoraWalletClientForPrivateKey,
  getFactoryContractVersion,
  getPublicClient,
  parseChallengeCreatedReceipt,
  parseChallengeCreationCall,
  sendWriteWithRetry,
} from "@agora/chain";
import {
  CHALLENGE_LIMITS,
  type ChallengeSpecOutput,
  SUBMISSION_LIMITS,
  defaultMinimumScoreForEvaluation,
  erc20Abi,
  loadConfig,
} from "@agora/common";
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json" with {
  type: "json",
};
import {
  type AuthoringDraftViewRow,
  buildChallengeInsert,
  sumRewardAmountForSourceProvider,
  upsertChallenge,
} from "@agora/db";
import { type Abi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publishDraft } from "./authoring-draft-transitions.js";
import { getAuthoringDraftSourceAttribution } from "./authoring-source-attribution.js";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;

const DISTRIBUTION_TO_ENUM = {
  winner_take_all: 0,
  top_3: 1,
  proportional: 2,
} as const;

function parseRewardAmountUsdc(spec: ChallengeSpecOutput) {
  const rewardAmount = Number(spec.reward.total);
  if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
    throw new Error(
      "Challenge reward total is invalid. Next step: fix the reward amount and retry publishing.",
    );
  }
  return rewardAmount;
}

function toUnixSeconds(iso: string) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      "Challenge deadline is invalid. Next step: fix the draft deadline and retry publishing.",
    );
  }
  return Math.floor(timestamp / 1000);
}

export async function enforceAuthoringSponsorMonthlyBudget(input: {
  db: Parameters<typeof publishDraft>[0]["db"];
  draft: AuthoringDraftViewRow;
  spec: ChallengeSpecOutput;
  sponsorMonthlyBudgetUsdc?: number | null;
  sumRewardAmountForSourceProviderImpl?: typeof sumRewardAmountForSourceProvider;
}) {
  const sourceAttribution = getAuthoringDraftSourceAttribution(input.draft);
  if (
    !sourceAttribution?.provider ||
    typeof input.sponsorMonthlyBudgetUsdc !== "number"
  ) {
    return;
  }

  const rewardAmount = parseRewardAmountUsdc(input.spec);
  const now = new Date();
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const sponsoredThisMonth = await (
    input.sumRewardAmountForSourceProviderImpl ??
    sumRewardAmountForSourceProvider
  )(input.db, {
    provider: sourceAttribution.provider,
    createdAtGte: periodStart.toISOString(),
    createdAtLt: periodEnd.toISOString(),
  });

  if (sponsoredThisMonth + rewardAmount > input.sponsorMonthlyBudgetUsdc) {
    throw new Error(
      `Agora's sponsor budget for ${sourceAttribution.provider} would be exceeded by this publish. Next step: lower the reward, wait for the next budget window, or raise the sponsor cap and retry.`,
    );
  }
}

function assertCreationMatchesSpec(input: {
  spec: ChallengeSpecOutput;
  rewardUnits: bigint;
  deadline: bigint;
  disputeWindowHours: bigint;
  minimumScore: bigint;
  distributionType: number;
  maxSubmissions: bigint;
  maxSubmissionsPerSolver: bigint;
}) {
  if (parseUnits(String(input.spec.reward.total), 6) !== input.rewardUnits) {
    throw new Error(
      "Sponsored challenge reward does not match the compiled spec. Next step: retry publishing and inspect the sponsor transaction builder.",
    );
  }
  if (BigInt(toUnixSeconds(input.spec.deadline)) !== input.deadline) {
    throw new Error(
      "Sponsored challenge deadline does not match the compiled spec. Next step: retry publishing and inspect the sponsor transaction builder.",
    );
  }
  if (
    BigInt(
      input.spec.dispute_window_hours ??
        CHALLENGE_LIMITS.defaultDisputeWindowHours,
    ) !== input.disputeWindowHours
  ) {
    throw new Error(
      "Sponsored challenge dispute window does not match the compiled spec. Next step: retry publishing and inspect the sponsor transaction builder.",
    );
  }
  if (
    parseUnits(
      String(
        input.spec.minimum_score ??
          defaultMinimumScoreForEvaluation(input.spec.evaluation) ??
          0,
      ),
      18,
    ) !== input.minimumScore
  ) {
    throw new Error(
      "Sponsored challenge minimum score does not match the compiled spec. Next step: retry publishing and inspect the sponsor transaction builder.",
    );
  }
  if (
    input.distributionType !==
    (DISTRIBUTION_TO_ENUM[
      input.spec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM
    ] ?? 0)
  ) {
    throw new Error(
      "Sponsored challenge distribution does not match the compiled spec. Next step: retry publishing and inspect the sponsor transaction builder.",
    );
  }
  if (
    input.maxSubmissions !==
    BigInt(
      input.spec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge,
    )
  ) {
    throw new Error(
      "Sponsored challenge max_submissions_total does not match the compiled spec. Next step: retry publishing and inspect the sponsor transaction builder.",
    );
  }
  if (
    input.maxSubmissionsPerSolver !==
    BigInt(
      input.spec.max_submissions_per_solver ??
        SUBMISSION_LIMITS.maxPerSolverPerChallenge,
    )
  ) {
    throw new Error(
      "Sponsored challenge max_submissions_per_solver does not match the compiled spec. Next step: retry publishing and inspect the sponsor transaction builder.",
    );
  }
}

export async function sponsorAndPublishAuthoringDraft(input: {
  db: Parameters<typeof publishDraft>[0]["db"];
  draft: AuthoringDraftViewRow;
  spec: ChallengeSpecOutput;
  specCid: string;
  sponsorPrivateKey: `0x${string}`;
  sponsorMonthlyBudgetUsdc?: number | null;
  returnTo?: string | null;
  expiresInMs: number;
  updateAuthoringDraftImpl?: Parameters<
    typeof publishDraft
  >[0]["updateAuthoringDraftImpl"];
  upsertPublishedChallengeLinkImpl?: Parameters<
    typeof publishDraft
  >[0]["upsertPublishedChallengeLinkImpl"];
  getAuthoringDraftViewByIdImpl?: Parameters<
    typeof publishDraft
  >[0]["getAuthoringDraftViewByIdImpl"];
}) {
  if (!input.draft.compilation_json) {
    throw new Error(
      "Authoring draft compilation is missing. Next step: compile the draft successfully before publishing.",
    );
  }

  const config = loadConfig();
  const publicClient = getPublicClient();
  const sponsorWalletClient = createAgoraWalletClientForPrivateKey(
    input.sponsorPrivateKey,
  );
  const sponsorAccount = privateKeyToAccount(input.sponsorPrivateKey);
  const sponsorAddress = sponsorAccount.address;
  const rewardAmount = parseRewardAmountUsdc(input.spec);
  const rewardUnits = parseUnits(String(input.spec.reward.total), 6);
  await enforceAuthoringSponsorMonthlyBudget({
    db: input.db,
    draft: input.draft,
    spec: input.spec,
    sponsorMonthlyBudgetUsdc: input.sponsorMonthlyBudgetUsdc,
  });

  const gasBalance = await publicClient.getBalance({
    address: sponsorAddress,
  });
  if (gasBalance <= 0n) {
    throw new Error(
      "Agora's internal sponsor wallet has no native gas balance. Next step: fund the sponsor wallet with Base gas and retry.",
    );
  }

  const usdcBalance = await balanceOf(sponsorAddress);
  if (usdcBalance < rewardUnits) {
    throw new Error(
      "Agora's internal sponsor wallet does not have enough USDC to fund this bounty. Next step: top up the sponsor wallet and retry.",
    );
  }

  const currentAllowance = await allowance(
    sponsorAddress,
    config.AGORA_FACTORY_ADDRESS,
  );
  if (currentAllowance < rewardUnits) {
    const approveTxHash = await sendWriteWithRetry({
      accountAddress: sponsorAddress,
      label: "Authoring sponsor USDC approval",
      publicClient,
      write: () =>
        sponsorWalletClient.writeContract({
          address: config.AGORA_USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [config.AGORA_FACTORY_ADDRESS, rewardUnits],
        }),
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
  }

  const minimumScore = parseUnits(
    String(
      input.spec.minimum_score ??
        defaultMinimumScoreForEvaluation(input.spec.evaluation) ??
        0,
    ),
    18,
  );
  const distributionType =
    DISTRIBUTION_TO_ENUM[
      input.spec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM
    ] ?? 0;
  const deadlineSeconds = toUnixSeconds(input.spec.deadline);
  const disputeWindowHours =
    input.spec.dispute_window_hours ??
    CHALLENGE_LIMITS.defaultDisputeWindowHours;
  const maxSubmissions =
    input.spec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge;
  const maxSubmissionsPerSolver =
    input.spec.max_submissions_per_solver ??
    SUBMISSION_LIMITS.maxPerSolverPerChallenge;

  const createTxHash = await sendWriteWithRetry({
    accountAddress: sponsorAddress,
    label: "Authoring sponsor challenge creation",
    publicClient,
    write: () =>
      sponsorWalletClient.writeContract({
        address: config.AGORA_FACTORY_ADDRESS,
        abi: AgoraFactoryAbi,
        functionName: "createChallenge",
        args: [
          input.specCid,
          rewardUnits,
          BigInt(deadlineSeconds),
          BigInt(disputeWindowHours),
          minimumScore,
          distributionType,
          (input.spec.lab_tba ??
            "0x0000000000000000000000000000000000000000") as `0x${string}`,
          BigInt(maxSubmissions),
          BigInt(maxSubmissionsPerSolver),
        ],
      }),
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: createTxHash,
  });
  if (receipt.status !== "success") {
    throw new Error(
      "Sponsored challenge creation transaction failed. Next step: inspect the sponsor wallet and retry.",
    );
  }

  const {
    challengeId: factoryChallengeId,
    challengeAddress,
    posterAddress,
  } = parseChallengeCreatedReceipt(receipt);
  const transaction = await publicClient.getTransaction({ hash: createTxHash });
  const transactionInput =
    (transaction as { input?: `0x${string}`; data?: `0x${string}` }).input ??
    (transaction as { data?: `0x${string}` }).data;
  if (!transactionInput) {
    throw new Error(
      "Sponsored challenge transaction calldata is unavailable. Next step: retry once the transaction is indexed by your RPC provider.",
    );
  }

  const creation = parseChallengeCreationCall(transactionInput);
  if (creation.specCid !== input.specCid) {
    throw new Error(
      "Sponsored challenge transaction does not match the pinned spec CID. Next step: retry publishing and inspect the sponsor transaction builder.",
    );
  }
  assertCreationMatchesSpec({
    spec: input.spec,
    rewardUnits,
    deadline: creation.deadline,
    disputeWindowHours: creation.disputeWindowHours,
    minimumScore: creation.minimumScore,
    distributionType: creation.distributionType,
    maxSubmissions: creation.maxSubmissions,
    maxSubmissionsPerSolver: creation.maxSubmissionsPerSolver,
  });

  const contractVersion = await getFactoryContractVersion(
    config.AGORA_FACTORY_ADDRESS,
    receipt.blockNumber,
  );
  const challengeInsert = await buildChallengeInsert({
    chainId: config.AGORA_CHAIN_ID,
    contractVersion,
    factoryChallengeId: Number(factoryChallengeId),
    contractAddress: challengeAddress,
    factoryAddress: config.AGORA_FACTORY_ADDRESS,
    posterAddress,
    specCid: input.specCid,
    spec: input.spec,
    rewardAmountUsdc: rewardAmount,
    disputeWindowHours:
      input.spec.dispute_window_hours ??
      CHALLENGE_LIMITS.defaultDisputeWindowHours,
    requirePinnedPresetDigests: config.AGORA_REQUIRE_PINNED_PRESET_DIGESTS,
    txHash: createTxHash,
    onChainDeadline: input.spec.deadline,
  });
  const challengeRow = await upsertChallenge(input.db, challengeInsert);

  const publishedDraft = await publishDraft({
    db: input.db,
    session: input.draft,
    posterAddress: sponsorAddress,
    compilationJson: {
      ...input.draft.compilation_json,
      challenge_spec: input.spec,
    },
    publishedSpecJson: input.spec,
    publishedSpecCid: input.specCid,
    challengeId: challengeRow.id,
    returnTo: input.returnTo ?? null,
    expiresInMs: input.expiresInMs,
    updateAuthoringDraftImpl: input.updateAuthoringDraftImpl,
    upsertPublishedChallengeLinkImpl: input.upsertPublishedChallengeLinkImpl,
    getAuthoringDraftViewByIdImpl: input.getAuthoringDraftViewByIdImpl,
  });

  return {
    draft: publishedDraft,
    txHash: createTxHash,
    sponsorAddress,
    challenge: {
      challengeId: challengeRow.id,
      challengeAddress,
      factoryChallengeId: Number(factoryChallengeId),
      refs: {
        challengeId: challengeRow.id,
        challengeAddress,
        factoryAddress: config.AGORA_FACTORY_ADDRESS,
        factoryChallengeId: Number(factoryChallengeId),
      },
    },
  };
}
