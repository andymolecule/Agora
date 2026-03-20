import {
  type AgoraConfig,
  CHALLENGE_LIMITS,
  CHALLENGE_STATUS,
  type ChallengeStatus,
  SUBMISSION_RESULT_FORMAT,
  buildChallengeCursorKey,
  challengeLifecycleEventSchema,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import {
  buildChallengeInsert,
  clearChallengeSettlement,
  createAuthoringCallbackDelivery,
  type createSupabaseClient,
  deleteChallengeById,
  deleteSubmissionsFromOnChainSubId,
  getAuthoringDraftById,
  getChallengeById,
  getIndexerCursor,
  getPublishedDraftMetadataByChallengeId,
  getSubmissionByChainId,
  findSubmissionIntentByMatch,
  ensureScoreJobForRegisteredSubmission,
  isEventIndexed,
  markChallengePayoutClaimed,
  markEventIndexed,
  replaceChallengePayouts,
  setChallengeFinalized,
  setIndexerCursor,
  updateChallengeStatus,
  upsertChallenge,
  upsertChallengePayoutAllocation,
  upsertSubmissionOnChain,
} from "@agora/db";
import { type Abi, parseEventLogs } from "viem";
import {
  fetchValidatedChallengeSpec,
  loadChallengeDefinitionFromChain,
} from "../challenge-definition.js";
import {
  decodeChallengeStatusValue,
  getChallengeLifecycleState,
  getChallengeSubmissionCount,
  getOnChainSubmission,
} from "../challenge.js";
import type { getPublicClient } from "../client.js";
import { indexerLogger } from "../observability.js";
import {
  type IndexerPollingConfig,
  chunkedGetLogs,
  clearRetryableEvent,
  isRetryableError,
  onRetryableEvent,
  retryKey,
  rewindStartBlock,
  sleep,
} from "./polling.js";

const SPEC_FETCH_MAX_RETRIES = 4;
const SPEC_FETCH_RETRY_BASE_MS = 500;
const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

type DbClient = ReturnType<typeof createSupabaseClient>;
type SubmissionRow = Awaited<ReturnType<typeof getSubmissionByChainId>>;

export interface ParsedLog {
  eventName: string;
  args: unknown;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
  blockHash?: `0x${string}` | null;
}

export interface ChallengeListRow {
  id: string;
  contract_address: string;
  factory_address?: string | null;
  tx_hash: string;
  status: string;
  max_submissions_total?: number | null;
  max_submissions_per_solver?: number | null;
}

export interface ChallengeLogProcessingResult {
  needsRepair: boolean;
}

function eventArg(args: unknown, indexOrName: number | string): unknown {
  if (Array.isArray(args)) return args[indexOrName as number];
  if (args && typeof args === "object") {
    return (args as Record<string, unknown>)[indexOrName as string];
  }
  return undefined;
}

function parseRequiredBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  throw new Error(`Invalid event arg '${field}': expected bigint`);
}

function parseRequiredInteger(value: unknown, field: string): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  throw new Error(`Invalid event arg '${field}': expected integer`);
}

function parseRequiredAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value === "string" && value.startsWith("0x")) {
    return value as `0x${string}`;
  }
  throw new Error(`Invalid event arg '${field}': expected address string`);
}

export async function projectOnChainSubmissionFromRegistration(input: {
  db: DbClient;
  challenge: ChallengeListRow;
  onChainSubmissionId: number;
  onChainSubmission: {
    solver: string;
    resultHash: string;
    proofBundleHash: string;
    score: bigint;
    scored: boolean;
    submittedAt: bigint;
  };
  txHash: string;
  scoredAt?: string | null;
  existingSubmission: SubmissionRow;
  findSubmissionIntentByMatchImpl?: typeof findSubmissionIntentByMatch;
  upsertSubmissionOnChainImpl?: typeof upsertSubmissionOnChain;
  ensureScoreJobForRegisteredSubmissionImpl?: typeof ensureScoreJobForRegisteredSubmission;
}) {
  const existingSubmission = input.existingSubmission;
  const findIntent =
    input.findSubmissionIntentByMatchImpl ?? findSubmissionIntentByMatch;
  const upsert =
    input.upsertSubmissionOnChainImpl ?? upsertSubmissionOnChain;
  const ensureScoreJob =
    input.ensureScoreJobForRegisteredSubmissionImpl ??
    ensureScoreJobForRegisteredSubmission;

  let registration = null;
  if (
    existingSubmission?.submission_intent_id &&
    existingSubmission.result_cid
  ) {
    registration = {
      submission_intent_id: existingSubmission.submission_intent_id,
      result_cid: existingSubmission.result_cid,
      result_format:
        existingSubmission.result_format ?? SUBMISSION_RESULT_FORMAT.plainV0,
      trace_id: existingSubmission.trace_id ?? null,
    };
  } else {
    const intent = await findIntent(input.db, {
      challengeId: input.challenge.id,
      solverAddress: input.onChainSubmission.solver,
      resultHash: input.onChainSubmission.resultHash,
    });
    if (!intent) {
      indexerLogger.warn(
        {
          event: "indexer.submission.unregistered",
          challengeId: input.challenge.id,
          onChainSubmissionId: input.onChainSubmissionId,
          solver: input.onChainSubmission.solver,
        },
        "Observed on-chain submission without a registered submission intent; skipping projection refresh",
      );
      return null;
    }

    registration = {
      submission_intent_id: intent.id,
      result_cid: intent.result_cid,
      result_format: intent.result_format,
      trace_id: existingSubmission?.trace_id ?? intent.trace_id ?? null,
    };

    indexerLogger.info(
      {
        event: "indexer.submission.recovered_from_intent",
        challengeId: input.challenge.id,
        onChainSubmissionId: input.onChainSubmissionId,
        intentId: intent.id,
        solver: input.onChainSubmission.solver,
      },
      "Recovered submission projection from the reserved submission intent",
    );
  }

  const submissionRow = await upsert(input.db, {
    submission_intent_id: registration.submission_intent_id,
    challenge_id: input.challenge.id,
    on_chain_sub_id: input.onChainSubmissionId,
    solver_address: input.onChainSubmission.solver,
    result_hash: input.onChainSubmission.resultHash,
    result_cid: registration.result_cid,
    result_format: registration.result_format,
    proof_bundle_hash: input.onChainSubmission.proofBundleHash,
    score: input.onChainSubmission.scored
      ? input.onChainSubmission.score.toString()
      : null,
    scored: input.onChainSubmission.scored,
    submitted_at: new Date(
      Number(input.onChainSubmission.submittedAt) * 1000,
    ).toISOString(),
    ...(input.scoredAt !== undefined
      ? { scored_at: input.scoredAt }
      : input.onChainSubmission.scored
        ? {}
        : { scored_at: null }),
    tx_hash: input.txHash,
    trace_id: registration.trace_id,
  });

  await ensureScoreJob(
    input.db,
    {
      id: input.challenge.id,
      status: input.challenge.status as ChallengeStatus,
      max_submissions_total: input.challenge.max_submissions_total,
      max_submissions_per_solver: input.challenge.max_submissions_per_solver,
    },
    {
      id: submissionRow.id,
      challenge_id: submissionRow.challenge_id,
      on_chain_sub_id: submissionRow.on_chain_sub_id,
      solver_address: submissionRow.solver_address,
      scored: submissionRow.scored,
      trace_id: submissionRow.trace_id,
    },
    registration.trace_id,
  );

  return submissionRow;
}

function parseStatusValue(value: unknown, field: string) {
  if (typeof value === "bigint") {
    return decodeChallengeStatusValue(value);
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return decodeChallengeStatusValue(value);
  }
  throw new Error(`Invalid event arg '${field}': expected challenge status`);
}

async function fetchChallengeSpec(specCid: string, chainId: number) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= SPEC_FETCH_MAX_RETRIES; attempt++) {
    try {
      return await fetchValidatedChallengeSpec(specCid, chainId);
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt < SPEC_FETCH_MAX_RETRIES) {
        const delay = SPEC_FETCH_RETRY_BASE_MS * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Failed to fetch challenge spec ${specCid} after ${SPEC_FETCH_MAX_RETRIES} retries: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function blockTimestampIso(
  publicClient: ReturnType<typeof getPublicClient>,
  blockNumber: bigint | null,
) {
  if (!blockNumber) return new Date().toISOString();
  const block = await publicClient.getBlock({ blockNumber });
  return new Date(Number(block.timestamp) * 1000).toISOString();
}

function payoutAmountUsdc(amount: bigint) {
  return Number(amount) / 1_000_000;
}

function payoutAmountMicros(amount: string | number) {
  return BigInt(Math.round(Number(amount) * 1_000_000));
}

export async function enqueueChallengeFinalizedCallback(input: {
  db: DbClient;
  challengeId: string;
  contractAddress: string;
  getPublishedDraftMetadataByChallengeIdImpl?: typeof getPublishedDraftMetadataByChallengeId;
  getAuthoringDraftByIdImpl?: typeof getAuthoringDraftById;
  getChallengeByIdImpl?: typeof getChallengeById;
  createAuthoringCallbackDeliveryImpl?: typeof createAuthoringCallbackDelivery;
}) {
  const link = await (
    input.getPublishedDraftMetadataByChallengeIdImpl ??
    getPublishedDraftMetadataByChallengeId
  )(input.db, input.challengeId);
  if (!link?.draft_id) {
    return;
  }

  const draft = await (
    input.getAuthoringDraftByIdImpl ?? getAuthoringDraftById
  )(input.db, link.draft_id);
  if (!draft?.source_callback_url) {
    return;
  }

  const provider = draft.authoring_ir_json?.origin.provider ?? "direct";
  if (provider === "direct") {
    return;
  }

  const challenge = await (input.getChallengeByIdImpl ?? getChallengeById)(
    input.db,
    input.challengeId,
  );
  const payload = challengeLifecycleEventSchema.parse({
    event: "challenge_finalized",
    occurred_at: new Date().toISOString(),
    draft_id: draft.id,
    provider,
    challenge: {
      challenge_id: challenge.id,
      contract_address: input.contractAddress,
      factory_challenge_id:
        typeof challenge.factory_challenge_id === "number"
          ? challenge.factory_challenge_id
          : challenge.factory_challenge_id == null
            ? null
            : Number(challenge.factory_challenge_id),
      status: challenge.status,
      deadline: challenge.deadline,
      reward_total: String(challenge.reward_amount),
      tx_hash:
        typeof challenge.tx_hash === "string" &&
        /^0x[a-fA-F0-9]{64}$/.test(challenge.tx_hash)
          ? challenge.tx_hash
          : null,
      winner_solver_address: challenge.winner_solver_address ?? null,
    },
  });

  await (
    input.createAuthoringCallbackDeliveryImpl ?? createAuthoringCallbackDelivery
  )(input.db, {
    draft_id: draft.id,
    provider,
    callback_url: draft.source_callback_url,
    event: payload.event,
    payload_json: payload,
    status: "pending",
    attempts: 0,
    max_attempts: 5,
    next_attempt_at: new Date().toISOString(),
    delivered_at: null,
    last_error: null,
  });
}

type CanonicalChallengePayoutRow = {
  challenge_id: string;
  solver_address: string;
  winning_on_chain_sub_id: number;
  rank: number;
  amount: number;
  claimed_at: string | null;
  claim_tx_hash: string | null;
};

async function listExistingChallengePayoutRows(
  db: DbClient,
  challengeId: string,
) {
  const { data, error } = await db
    .from("challenge_payouts")
    .select("*")
    .eq("challenge_id", challengeId)
    .order("solver_address", { ascending: true })
    .order("rank", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to load challenge payouts during reconcile: ${error.message}`,
    );
  }

  return (data ?? []) as CanonicalChallengePayoutRow[];
}

async function loadCurrentChallengeSettlement(
  db: DbClient,
  challengeId: string,
) {
  const { data, error } = await db
    .from("challenges")
    .select("winning_on_chain_sub_id, winner_solver_address")
    .eq("id", challengeId)
    .single();

  if (error) {
    throw new Error(
      `Failed to load challenge settlement during reconcile: ${error.message}`,
    );
  }

  return data as {
    winning_on_chain_sub_id: number | null;
    winner_solver_address: string | null;
  };
}

function payoutRowsMatch(
  left: CanonicalChallengePayoutRow[],
  right: CanonicalChallengePayoutRow[],
) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index++) {
    const current = left[index];
    const next = right[index];
    if (!current || !next) {
      return false;
    }
    if (current.challenge_id !== next.challenge_id) return false;
    if (current.solver_address !== next.solver_address) return false;
    if (current.winning_on_chain_sub_id !== next.winning_on_chain_sub_id) {
      return false;
    }
    if (current.rank !== next.rank) return false;
    if (
      payoutAmountMicros(current.amount) !== payoutAmountMicros(next.amount)
    ) {
      return false;
    }
    if ((current.claimed_at ?? null) !== (next.claimed_at ?? null)) {
      return false;
    }
    if ((current.claim_tx_hash ?? null) !== (next.claim_tx_hash ?? null)) {
      return false;
    }
  }

  return true;
}

async function buildCanonicalChallengeSettlement(input: {
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  challengeFromBlock: bigint;
  blockNumber: bigint | null;
}) {
  const { publicClient, challenge, challengeFromBlock, blockNumber } = input;
  const challengeAddress = challenge.contract_address as `0x${string}`;
  const settlementBlock = blockNumber ?? (await publicClient.getBlockNumber());
  const challengeLogs = await chunkedGetLogs(
    publicClient,
    challengeAddress,
    challengeFromBlock,
    settlementBlock,
  );
  const parsedChallengeLogs = parseEventLogs({
    abi: AgoraChallengeAbi,
    logs: challengeLogs,
    strict: false,
  }) as unknown as ParsedLog[];

  let winnerSubmissionId: number | null = null;
  let winnerSolverAddress: string | null = null;
  const claimStateBySolver = new Map<
    string,
    { claimed_at: string; claim_tx_hash: string }
  >();
  const payoutRows: CanonicalChallengePayoutRow[] = [];

  for (const log of parsedChallengeLogs) {
    if (log.eventName === "SettlementFinalized") {
      winnerSubmissionId = Number(
        parseRequiredBigInt(
          eventArg(log.args, 0) ?? eventArg(log.args, "winningSubmissionId"),
          "winningSubmissionId",
        ),
      );
      winnerSolverAddress = parseRequiredAddress(
        eventArg(log.args, 1) ?? eventArg(log.args, "winnerSolver"),
        "winnerSolver",
      ).toLowerCase();
      continue;
    }

    if (log.eventName === "Claimed" && log.transactionHash) {
      const claimant = parseRequiredAddress(
        eventArg(log.args, 0) ?? eventArg(log.args, "claimant"),
        "claimant",
      ).toLowerCase();
      claimStateBySolver.set(claimant, {
        claimed_at: await blockTimestampIso(
          publicClient,
          log.blockNumber ?? null,
        ),
        claim_tx_hash: log.transactionHash,
      });
      continue;
    }

    if (log.eventName === "PayoutAllocated") {
      const solver = parseRequiredAddress(
        eventArg(log.args, 0) ?? eventArg(log.args, "solver"),
        "solver",
      ).toLowerCase();
      const submissionId = Number(
        parseRequiredBigInt(
          eventArg(log.args, 1) ?? eventArg(log.args, "submissionId"),
          "submissionId",
        ),
      );
      const rank = parseRequiredInteger(
        eventArg(log.args, 2) ?? eventArg(log.args, "rank"),
        "rank",
      );
      const amount = payoutAmountUsdc(
        parseRequiredBigInt(
          eventArg(log.args, 3) ?? eventArg(log.args, "amount"),
          "amount",
        ),
      );
      payoutRows.push({
        challenge_id: challenge.id,
        solver_address: solver,
        winning_on_chain_sub_id: submissionId,
        rank,
        amount,
        claimed_at: null,
        claim_tx_hash: null,
      });
    }
  }

  if (winnerSubmissionId === null || winnerSolverAddress === null) {
    throw new Error(
      `Finalized challenge ${challenge.contract_address} is missing canonical settlement logs.`,
    );
  }

  const canonicalRows = payoutRows
    .map((row) => {
      const claim = claimStateBySolver.get(row.solver_address);
      return {
        ...row,
        claimed_at: claim?.claimed_at ?? null,
        claim_tx_hash: claim?.claim_tx_hash ?? null,
      };
    })
    .sort((left, right) => {
      if (left.solver_address !== right.solver_address) {
        return left.solver_address.localeCompare(right.solver_address);
      }
      return left.rank - right.rank;
    });

  return {
    winnerSubmissionId,
    winnerSolverAddress,
    payoutRows: canonicalRows,
  };
}

async function repairChallengeSettlementFromLogs(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  challengeFromBlock: bigint;
  blockNumber: bigint;
}) {
  const { db, challenge } = input;
  const [currentSettlement, existingPayoutRows, canonicalSettlement] =
    await Promise.all([
      loadCurrentChallengeSettlement(db, challenge.id),
      listExistingChallengePayoutRows(db, challenge.id),
      buildCanonicalChallengeSettlement(input),
    ]);

  const settlementNeedsRepair =
    currentSettlement.winning_on_chain_sub_id !==
      canonicalSettlement.winnerSubmissionId ||
    (currentSettlement.winner_solver_address ?? null) !==
      canonicalSettlement.winnerSolverAddress;
  const payoutsNeedRepair = !payoutRowsMatch(
    existingPayoutRows,
    canonicalSettlement.payoutRows,
  );

  if (settlementNeedsRepair) {
    await setChallengeFinalized(
      db,
      challenge.id,
      canonicalSettlement.winnerSubmissionId,
      canonicalSettlement.winnerSolverAddress,
    );
  }

  if (payoutsNeedRepair) {
    await replaceChallengePayouts(
      db,
      challenge.id,
      canonicalSettlement.payoutRows,
    );
  }
}

export async function reconcileChallengeProjection(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  challengeFromBlock: bigint;
  blockNumber: bigint;
}) {
  const { db, publicClient, challenge, challengeFromBlock, blockNumber } =
    input;
  const challengeAddress = challenge.contract_address as `0x${string}`;
  const code = await publicClient.getCode({
    address: challengeAddress,
    blockNumber,
  });
  if (!code || code === "0x") {
    await deleteChallengeById(db, challenge.id);
    return { deleted: true as const };
  }

  const [lifecycle, submissionCount] = await Promise.all([
    getChallengeLifecycleState(challengeAddress, blockNumber),
    getChallengeSubmissionCount(challengeAddress, blockNumber),
  ]);

  await deleteSubmissionsFromOnChainSubId(
    db,
    challenge.id,
    Number(submissionCount),
  );

  for (let subIndex = 0; subIndex < Number(submissionCount); subIndex++) {
    const submission = await getOnChainSubmission(
      challengeAddress,
      BigInt(subIndex),
      blockNumber,
    );
    const existingSubmission = await getSubmissionByChainId(
      db,
      challenge.id,
      subIndex,
    );
    await projectOnChainSubmissionFromRegistration({
      db,
      challenge,
      onChainSubmissionId: subIndex,
      onChainSubmission: submission,
      txHash: challenge.tx_hash,
      existingSubmission,
    });
  }

  if (lifecycle.status === CHALLENGE_STATUS.cancelled) {
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.cancelled);
    await clearChallengeSettlement(db, challenge.id);
    await replaceChallengePayouts(db, challenge.id, []);
    return { deleted: false as const };
  }

  if (lifecycle.status === CHALLENGE_STATUS.disputed) {
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.disputed);
    await clearChallengeSettlement(db, challenge.id);
    await replaceChallengePayouts(db, challenge.id, []);
    return { deleted: false as const };
  }

  if (lifecycle.status === CHALLENGE_STATUS.open) {
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.open);
    await clearChallengeSettlement(db, challenge.id);
    await replaceChallengePayouts(db, challenge.id, []);
    return { deleted: false as const };
  }

  if (lifecycle.status === CHALLENGE_STATUS.finalized) {
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.finalized);
    await repairChallengeSettlementFromLogs({
      db,
      publicClient,
      challenge,
      challengeFromBlock,
      blockNumber,
    });
    return { deleted: false as const };
  }

  if (
    lifecycle.status === CHALLENGE_STATUS.scoring &&
    challenge.status !== CHALLENGE_STATUS.open &&
    challenge.status !== CHALLENGE_STATUS.scoring
  ) {
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.scoring);
    await clearChallengeSettlement(db, challenge.id);
    await replaceChallengePayouts(db, challenge.id, []);
  }

  return { deleted: false as const };
}

export async function resolveChallengeInitialFromBlock(
  challengeTxHash: unknown,
  publicClient: ReturnType<typeof getPublicClient>,
  fallbackFromBlock: bigint,
) {
  if (
    typeof challengeTxHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(challengeTxHash)
  ) {
    return fallbackFromBlock;
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: challengeTxHash as `0x${string}`,
    });
    const createdAtBlock = receipt.blockNumber;
    return createdAtBlock < fallbackFromBlock
      ? createdAtBlock
      : fallbackFromBlock;
  } catch (error) {
    if (isRetryableError(error)) {
      throw error;
    }
    indexerLogger.warn(
      {
        event: "indexer.challenge_creation_block_fallback",
        txHash: challengeTxHash,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to resolve challenge creation block; falling back to the global cursor",
    );
    return fallbackFromBlock;
  }
}

export async function processFactoryLog(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  config: AgoraConfig;
  pollingConfig?: IndexerPollingConfig;
  log: ParsedLog;
  fromBlock: bigint;
}) {
  const { db, publicClient, config, pollingConfig, log, fromBlock } = input;
  if (!log.eventName || !log.transactionHash) return;
  const txHash = log.transactionHash;
  const logIndex = Number(log.logIndex ?? 0);
  const already = await isEventIndexed(db, txHash, logIndex);
  if (already) return;

  try {
    if (log.eventName === "ChallengeCreated") {
      const id = parseRequiredBigInt(
        eventArg(log.args, 0) ?? eventArg(log.args, "id"),
        "id",
      );
      const challengeAddr = parseRequiredAddress(
        eventArg(log.args, 1) ??
          eventArg(log.args, "challenge") ??
          eventArg(log.args, "challengeAddr") ??
          eventArg(log.args, "challengeAddress"),
        "challenge",
      );
      const poster = parseRequiredAddress(
        eventArg(log.args, 2) ??
          eventArg(log.args, "poster") ??
          eventArg(log.args, "creator"),
        "poster",
      );
      const reward = parseRequiredBigInt(
        eventArg(log.args, 3) ??
          eventArg(log.args, "rewardAmount") ??
          eventArg(log.args, "reward"),
        "rewardAmount",
      );

      const { specCid, spec, contractVersion, onChainDeadlineIso } =
        await loadChallengeDefinitionFromChain({
          publicClient,
          challengeAddress: challengeAddr,
          chainId: config.AGORA_CHAIN_ID,
          ...(log.blockNumber !== null ? { blockNumber: log.blockNumber } : {}),
        });

      const challengeInsert = await buildChallengeInsert({
        chainId: config.AGORA_CHAIN_ID,
        contractVersion,
        factoryChallengeId: Number(id),
        contractAddress: challengeAddr,
        factoryAddress: config.AGORA_FACTORY_ADDRESS,
        posterAddress: poster,
        specCid,
        spec,
        rewardAmountUsdc: Number(reward) / 1_000_000,
        disputeWindowHours:
          spec.dispute_window_hours ??
          CHALLENGE_LIMITS.defaultDisputeWindowHours,
        requirePinnedPresetDigests: config.AGORA_REQUIRE_PINNED_PRESET_DIGESTS,
        txHash,
        // On-chain deadline is the source of truth — spec deadline is informational.
        onChainDeadline: onChainDeadlineIso,
      });

      await upsertChallenge(db, challengeInsert);
    }

    await markEventIndexed(
      db,
      txHash,
      logIndex,
      log.eventName,
      Number(log.blockNumber ?? 0),
      log.blockHash ?? null,
    );
    clearRetryableEvent(retryKey(txHash, logIndex));
  } catch (error) {
    if (isRetryableError(error)) {
      const key = retryKey(txHash, logIndex);
      const retry = onRetryableEvent(
        key,
        log.blockNumber ?? fromBlock,
        pollingConfig,
      );
      if (!retry.shouldRetryNow) {
        return;
      }
      if (retry.exhausted) {
        indexerLogger.error(
          {
            event: "indexer.factory_event.retry_exhausted",
            eventName: log.eventName,
            txHash,
            logIndex,
            attempts: retry.attempts,
          },
          "Retryable factory event exhausted max attempts",
        );
        throw new Error(
          `Retryable factory event exhausted max attempts for ${log.eventName} (${txHash}:${logIndex}). Last error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      indexerLogger.warn(
        {
          event: "indexer.factory_event.retry_scheduled",
          eventName: log.eventName,
          txHash,
          logIndex,
          attempts: retry.attempts,
          retryInMs: retry.waitMs,
          error: error instanceof Error ? error.message : String(error),
        },
        "Retryable factory event processing error; scheduling retry",
      );
      return;
    }
    indexerLogger.error(
      {
        event: "indexer.factory_event.invalid",
        eventName: log.eventName,
        txHash,
        logIndex,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to process factory event",
    );
    await markEventIndexed(
      db,
      txHash,
      logIndex,
      `${log.eventName}:invalid`,
      Number(log.blockNumber ?? 0),
      log.blockHash ?? null,
    );
    clearRetryableEvent(retryKey(txHash, logIndex));
  }
}

export async function processChallengeLog(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  pollingConfig?: IndexerPollingConfig;
  log: ParsedLog;
  fromBlock: bigint;
  challengeFromBlock: bigint;
  challengeCursorKey: string;
  challengePersistTargets: Map<string, bigint>;
  getOnChainSubmissionImpl?: typeof getOnChainSubmission;
  getSubmissionByChainIdImpl?: typeof getSubmissionByChainId;
  projectOnChainSubmissionFromRegistrationImpl?: typeof projectOnChainSubmissionFromRegistration;
}): Promise<ChallengeLogProcessingResult> {
  const {
    db,
    publicClient,
    challenge,
    pollingConfig,
    log,
    fromBlock,
    challengeFromBlock,
    challengeCursorKey,
    challengePersistTargets,
    getOnChainSubmissionImpl,
    getSubmissionByChainIdImpl,
    projectOnChainSubmissionFromRegistrationImpl,
  } = input;

  if (!log.eventName || !log.transactionHash) {
    return { needsRepair: false };
  }
  const txHash = log.transactionHash;
  const logIndex = Number(log.logIndex ?? 0);
  const already = await isEventIndexed(db, txHash, logIndex);
  if (already) {
    return { needsRepair: false };
  }

  const challengeAddress = challenge.contract_address as `0x${string}`;
  const getOnChainSubmissionForEvent =
    getOnChainSubmissionImpl ?? getOnChainSubmission;
  const getSubmissionByChainIdForEvent =
    getSubmissionByChainIdImpl ?? getSubmissionByChainId;
  const projectSubmissionForEvent =
    projectOnChainSubmissionFromRegistrationImpl ??
    projectOnChainSubmissionFromRegistration;
  let needsRepair = false;

  try {
    if (log.eventName === "Submitted") {
      const submissionId = parseRequiredBigInt(
        eventArg(log.args, 0) ??
          eventArg(log.args, "subId") ??
          eventArg(log.args, "submissionId"),
        "submissionId",
      );
      const submission = await getOnChainSubmissionForEvent(
        challengeAddress,
        submissionId,
        log.blockNumber ?? undefined,
      );
      const existingSubmission = await getSubmissionByChainIdForEvent(
        db,
        challenge.id,
        Number(submissionId),
      );
      const projected = await projectSubmissionForEvent({
        db,
        challenge,
        onChainSubmissionId: Number(submissionId),
        onChainSubmission: submission,
        txHash,
        existingSubmission,
      });
      if (!projected) {
        needsRepair = true;
        indexerLogger.warn(
          {
            event: "indexer.submission.unregistered_requires_repair",
            challengeId: challenge.id,
            challengeAddress,
            onChainSubmissionId: Number(submissionId),
            txHash,
          },
          "On-chain submission is missing a registered intent and now requires repair",
        );
      }
    }

    if (log.eventName === "Scored") {
      const submissionId = parseRequiredBigInt(
        eventArg(log.args, 0) ??
          eventArg(log.args, "subId") ??
          eventArg(log.args, "submissionId"),
        "submissionId",
      );
      const score = parseRequiredBigInt(
        eventArg(log.args, 1) ?? eventArg(log.args, "score"),
        "score",
      );
      const proofBundleHash = parseRequiredAddress(
        eventArg(log.args, 2) ?? eventArg(log.args, "proofBundleHash"),
        "proofBundleHash",
      );

      const submission = await getOnChainSubmissionForEvent(
        challengeAddress,
        submissionId,
        log.blockNumber ?? undefined,
      );
      // upsertSubmissionOnChain writes all on-chain-owned fields (score,
      // scored, scored_at, proof_bundle_hash).  proof_bundle_cid is owned
      // exclusively by the oracle worker via updateScore — the indexer
      // must never touch it.
      const existingSubmission = await getSubmissionByChainIdForEvent(
        db,
        challenge.id,
        Number(submissionId),
      );
      const projected = await projectSubmissionForEvent({
        db,
        challenge,
        onChainSubmissionId: Number(submissionId),
        onChainSubmission: {
          ...submission,
          proofBundleHash,
          score,
          scored: true,
        },
        txHash,
        scoredAt: new Date().toISOString(),
        existingSubmission,
      });
      if (!projected) {
        needsRepair = true;
        indexerLogger.warn(
          {
            event: "indexer.submission.unregistered_requires_repair",
            challengeId: challenge.id,
            challengeAddress,
            onChainSubmissionId: Number(submissionId),
            txHash,
          },
          "Scored on-chain submission is missing a registered intent and now requires repair",
        );
      }
    }

    if (log.eventName === "StatusChanged") {
      const nextStatus = parseStatusValue(
        eventArg(log.args, 1) ?? eventArg(log.args, "toStatus"),
        "toStatus",
      );
      await updateChallengeStatus(db, challenge.id, nextStatus);
      if (nextStatus !== CHALLENGE_STATUS.finalized) {
        await clearChallengeSettlement(db, challenge.id);
        await replaceChallengePayouts(db, challenge.id, []);
      }
    }

    if (log.eventName === "DisputeResolved") {
      await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.finalized);
    }

    if (log.eventName === "SettlementFinalized") {
      const winningSubmissionId = parseRequiredBigInt(
        eventArg(log.args, 0) ?? eventArg(log.args, "winningSubmissionId"),
        "winningSubmissionId",
      );
      const winnerSolver = parseRequiredAddress(
        eventArg(log.args, 1) ?? eventArg(log.args, "winnerSolver"),
        "winnerSolver",
      );
      await setChallengeFinalized(
        db,
        challenge.id,
        Number(winningSubmissionId),
        winnerSolver,
      );
      await enqueueChallengeFinalizedCallback({
        db,
        challengeId: challenge.id,
        contractAddress: challenge.contract_address,
      });
    }

    if (log.eventName === "PayoutAllocated") {
      const solver = parseRequiredAddress(
        eventArg(log.args, 0) ?? eventArg(log.args, "solver"),
        "solver",
      );
      const submissionId = parseRequiredBigInt(
        eventArg(log.args, 1) ?? eventArg(log.args, "submissionId"),
        "submissionId",
      );
      const rank = parseRequiredInteger(
        eventArg(log.args, 2) ?? eventArg(log.args, "rank"),
        "rank",
      );
      const amount = parseRequiredBigInt(
        eventArg(log.args, 3) ?? eventArg(log.args, "amount"),
        "amount",
      );
      await upsertChallengePayoutAllocation(db, {
        challenge_id: challenge.id,
        solver_address: solver,
        winning_on_chain_sub_id: Number(submissionId),
        rank,
        amount: payoutAmountUsdc(amount),
      });
    }

    if (log.eventName === "Claimed") {
      const claimant = parseRequiredAddress(
        eventArg(log.args, 0) ?? eventArg(log.args, "claimant"),
        "claimant",
      );
      const updatedPayoutRows = await markChallengePayoutClaimed(
        db,
        challenge.id,
        claimant,
        await blockTimestampIso(publicClient, log.blockNumber ?? null),
        txHash,
      );
      if (updatedPayoutRows === 0) {
        needsRepair = true;
        indexerLogger.warn(
          {
            event: "indexer.challenge_payout_projection_missing",
            challengeId: challenge.id,
            challengeAddress,
            claimant,
            txHash,
          },
          "Challenge payout claim arrived without projected payout rows",
        );
      }
    }

    await markEventIndexed(
      db,
      txHash,
      logIndex,
      log.eventName,
      Number(log.blockNumber ?? 0),
      log.blockHash ?? null,
    );
    clearRetryableEvent(retryKey(txHash, logIndex));
    return { needsRepair };
  } catch (error) {
    if (isRetryableError(error)) {
      const key = retryKey(txHash, logIndex);
      const retry = onRetryableEvent(
        key,
        log.blockNumber ?? fromBlock,
        pollingConfig,
      );
      const currentTarget = challengePersistTargets.get(challengeCursorKey);
      const fallbackTarget = rewindStartBlock(
        log.blockNumber ?? challengeFromBlock,
        pollingConfig,
      );
      const safeTarget =
        currentTarget === undefined
          ? fallbackTarget
          : currentTarget < fallbackTarget
            ? currentTarget
            : fallbackTarget;
      challengePersistTargets.set(challengeCursorKey, safeTarget);
      if (!retry.shouldRetryNow) {
        return { needsRepair: false };
      }
      if (retry.exhausted) {
        indexerLogger.error(
          {
            event: "indexer.challenge_event.retry_exhausted",
            challengeId: challenge.id,
            challengeAddress,
            eventName: log.eventName,
            txHash,
            logIndex,
            attempts: retry.attempts,
          },
          "Retryable challenge event exhausted max attempts",
        );
        throw new Error(
          `Retryable challenge event exhausted max attempts for ${log.eventName} (${txHash}:${logIndex}). Last error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      indexerLogger.warn(
        {
          event: "indexer.challenge_event.retry_scheduled",
          challengeId: challenge.id,
          challengeAddress,
          eventName: log.eventName,
          txHash,
          logIndex,
          attempts: retry.attempts,
          retryInMs: retry.waitMs,
          error: error instanceof Error ? error.message : String(error),
        },
        "Retryable challenge event processing error; scheduling retry",
      );
      return { needsRepair: false };
    }
    indexerLogger.error(
      {
        event: "indexer.challenge_event.invalid",
        challengeId: challenge.id,
        challengeAddress,
        eventName: log.eventName,
        txHash,
        logIndex,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to process challenge event",
    );
    await markEventIndexed(
      db,
      txHash,
      logIndex,
      `${log.eventName}:invalid`,
      Number(log.blockNumber ?? 0),
      log.blockHash ?? null,
    );
    clearRetryableEvent(retryKey(txHash, logIndex));
    return { needsRepair: false };
  }
}

export async function loadChallengeCursor(input: {
  db: DbClient;
  challenge: ChallengeListRow;
  chainId: number;
  publicClient: ReturnType<typeof getPublicClient>;
  fromBlock: bigint;
  resolvedChallengeKeys: Set<string>;
}) {
  const {
    db,
    challenge,
    chainId,
    publicClient,
    fromBlock,
    resolvedChallengeKeys,
  } = input;
  const challengeAddress = challenge.contract_address as `0x${string}`;
  const challengeCursorKey = buildChallengeCursorKey(chainId, challengeAddress);

  const challengeCursor = await getIndexerCursor(db, challengeCursorKey);
  let challengeFromBlock: bigint;

  if (challengeCursor !== null) {
    challengeFromBlock = challengeCursor;
    resolvedChallengeKeys.add(challengeCursorKey);
  } else {
    try {
      challengeFromBlock = await resolveChallengeInitialFromBlock(
        challenge.tx_hash,
        publicClient,
        fromBlock,
      );
      resolvedChallengeKeys.add(challengeCursorKey);
    } catch {
      challengeFromBlock = fromBlock;
      indexerLogger.warn(
        {
          event: "indexer.challenge_cursor.bootstrap_failed",
          challengeId: challenge.id,
          challengeAddress,
        },
        "Skipping cursor persist for challenge with failed bootstrap",
      );
    }
  }

  return {
    challengeAddress,
    challengeCursorKey,
    challengeFromBlock,
  };
}

export async function persistChallengeCursors(input: {
  db: DbClient;
  resolvedChallengeKeys: Set<string>;
  challengePersistTargets: Map<string, bigint>;
  nextBlock: bigint;
  pollingConfig?: IndexerPollingConfig;
}) {
  const {
    db,
    resolvedChallengeKeys,
    challengePersistTargets,
    nextBlock,
    pollingConfig,
  } = input;
  const quietReplayBlock = rewindStartBlock(nextBlock, pollingConfig);
  for (const challengeKey of resolvedChallengeKeys) {
    const persistTarget =
      challengePersistTargets.get(challengeKey) ?? quietReplayBlock;
    await setIndexerCursor(db, challengeKey, persistTarget);
  }
}
