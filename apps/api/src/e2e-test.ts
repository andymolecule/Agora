import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  approve,
  claimPayout,
  createChallenge,
  disputeChallenge,
  getChallengePayoutByAddress,
  getPublicClient,
  getWalletClient,
  parseChallengeCreatedReceipt,
  parseChallengeLogs,
  parseFactoryLogs,
  resolveDispute,
  startChallengeScoring,
  submitChallengeResult,
} from "@agora/chain";
import {
  type ChallengeListRow,
  processChallengeLog,
  processFactoryLog,
  reconcileChallengeProjection,
} from "@agora/chain/indexer/handlers";
import {
  OFFICIAL_SCORER_IMAGES,
  SUBMISSION_RESULT_FORMAT,
  createCsvTableSubmissionContract,
  hasSubmissionSealWorkerConfig,
  importSubmissionSealPublicKey,
  loadConfig,
  resolveRuntimePrivateKey,
  sealSubmission,
  type ChallengeSpecOutput,
  type CompilationResultOutput,
} from "@agora/common";
import {
  claimNextJob,
  createSupabaseClient,
  getSubmissionById,
} from "@agora/db";
import { pinFile, pinJSON } from "@agora/ipfs";
import { createApp } from "./app.js";
import { createDraft } from "./lib/authoring-draft-transitions.js";
import { sponsorAndPublishAuthoringDraft } from "./lib/authoring-sponsored-publish.js";
import { processJob } from "./worker/jobs.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const E2E_REWARD_USDC = 1;
const E2E_DISPUTE_WINDOW_HOURS = 1;
const E2E_DEADLINE_SECONDS = 60;
const E2E_POLL_INTERVAL_MS = 1_000;
const E2E_POLL_TIMEOUT_MS = 60_000;

type LifecycleScenarioPrepared = {
  label: string;
  specCid: string;
  submissionSourcePath: string;
  assertPublicApis?: (input: {
    app: ReturnType<typeof createApp>;
    challengeId: string;
    submissionId: string;
  }) => Promise<void>;
};

function repoPath(...segments: string[]) {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    ...segments,
  );
}

function isLocalRpcUrl(value: string | undefined) {
  return Boolean(value && /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value));
}

function requiredConfigPresent() {
  try {
    const config = loadConfig();
    return Boolean(
      config.AGORA_SUPABASE_URL &&
        config.AGORA_SUPABASE_SERVICE_KEY &&
        config.AGORA_PINATA_JWT &&
        (config.AGORA_PRIVATE_KEY ?? config.AGORA_ORACLE_KEY),
    );
  } catch {
    return false;
  }
}

export function canRunLifecycleE2E() {
  try {
    const config = loadConfig();
    return requiredConfigPresent() && isLocalRpcUrl(config.AGORA_RPC_URL);
  } catch {
    return false;
  }
}

async function advanceTimeTo(
  publicClient: ReturnType<typeof getPublicClient>,
  nextTimestamp: bigint,
) {
  const nextTimestampNumber = Number(nextTimestamp);

  try {
    await publicClient.request({
      method: "anvil_setNextBlockTimestamp",
      params: [nextTimestampNumber],
    } as never);
    await publicClient.request({
      method: "evm_mine",
      params: [],
    } as never);
    return;
  } catch {}

  const latestBlock = await publicClient.getBlock();
  const delta = Number(nextTimestamp - latestBlock.timestamp);
  if (delta < 0) {
    throw new Error("Cannot move lifecycle E2E backwards in time.");
  }

  try {
    await publicClient.request({
      method: "evm_increaseTime",
      params: [delta],
    } as never);
    await publicClient.request({
      method: "evm_mine",
      params: [],
    } as never);
  } catch {
    throw new Error(
      "Lifecycle E2E requires a local RPC that supports time travel. Point AGORA_RPC_URL at local Anvil/Hardhat and retry.",
    );
  }
}

async function ensureWalletMatchesOracle(
  publicClient: ReturnType<typeof getPublicClient>,
  factoryAddress: `0x${string}`,
  walletAddress: `0x${string}`,
) {
  const oracle = (await publicClient.readContract({
    address: factoryAddress,
    abi: [
      {
        type: "function",
        name: "oracle",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "address" }],
      },
    ],
    functionName: "oracle",
  })) as `0x${string}`;

  if (oracle.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error(
      `Lifecycle E2E requires the active wallet to match the factory oracle. Set AGORA_ORACLE_KEY or AGORA_PRIVATE_KEY to ${oracle} and retry.`,
    );
  }
}

function buildE2ESpec(input: { trainCid: string; expectedCid: string }) {
  return {
    schema_version: 4 as const,
    id: `e2e-${Date.now()}`,
    title: `E2E Reproducibility ${Date.now()}`,
    description:
      "End-to-end reproducibility flow using canonical worker scoring and settlement projection.",
    domain: "other" as const,
    type: "reproducibility" as const,
    artifacts: [
      {
        role: "source_data",
        visibility: "public" as const,
        uri: input.trainCid,
      },
      {
        role: "reference_output",
        visibility: "public" as const,
        uri: input.expectedCid,
      },
    ],
    evaluation: {
      preset_id: "reproducibility",
      backend_kind: "preset_interpreter" as const,
      execution_runtime_family: "reproducibility",
      metric: "exact_match",
      scorer_image: OFFICIAL_SCORER_IMAGES.reproducibility,
      evaluation_bundle: input.expectedCid,
    },
    submission_contract: createCsvTableSubmissionContract({
      requiredColumns: ["sample_id", "normalized_signal", "condition"],
    }),
    reward: {
      total: String(E2E_REWARD_USDC),
      distribution: "top_3" as const,
    },
    deadline: new Date(Date.now() + E2E_DEADLINE_SECONDS * 1000).toISOString(),
    lab_tba: ZERO_ADDRESS,
  };
}

function buildPredictionE2ESpec(input: {
  trainCid: string;
  testCid: string;
  hiddenLabelsCid: string;
}) {
  return {
    schema_version: 4 as const,
    id: `e2e-prediction-${Date.now()}`,
    title: `E2E Prediction ${Date.now()}`,
    description:
      "End-to-end prediction flow using the regression scorer, hidden labels, and on-chain settlement.",
    domain: "other" as const,
    type: "prediction" as const,
    artifacts: [
      {
        role: "training_data",
        visibility: "public" as const,
        uri: input.trainCid,
      },
      {
        role: "evaluation_features",
        visibility: "public" as const,
        uri: input.testCid,
      },
      {
        role: "hidden_labels",
        visibility: "private" as const,
        uri: input.hiddenLabelsCid,
      },
    ],
    evaluation: {
      preset_id: "tabular_regression",
      backend_kind: "preset_interpreter" as const,
      execution_runtime_family: "tabular_regression",
      metric: "r2",
      scorer_image: OFFICIAL_SCORER_IMAGES.tabular,
      evaluation_bundle: input.hiddenLabelsCid,
    },
    submission_contract: createCsvTableSubmissionContract({
      requiredColumns: ["id", "prediction"],
      idColumn: "id",
      valueColumn: "prediction",
    }),
    reward: {
      total: String(E2E_REWARD_USDC),
      distribution: "top_3" as const,
    },
    deadline: new Date(Date.now() + E2E_DEADLINE_SECONDS * 1000).toISOString(),
    lab_tba: ZERO_ADDRESS,
  };
}

function buildE2EDraftCompilation(
  spec: ChallengeSpecOutput,
): CompilationResultOutput {
  return {
    authoring_path: "preset_supported",
    challenge_type: spec.type,
    preset_id: spec.evaluation.preset_id,
    definition_id: null,
    backend_kind: spec.evaluation.backend_kind,
    execution_runtime_family:
      spec.evaluation.execution_runtime_family ?? null,
    metric: spec.evaluation.metric,
    resolved_artifacts: spec.artifacts,
    submission_contract: spec.submission_contract,
    dry_run: {
      status: "validated",
      summary: "Local E2E draft fixture validated successfully.",
      sample_score: "1.0",
    },
    confidence_score: 0.99,
    reason_codes: ["e2e_fixture"],
    warnings: [],
    confirmation_contract: {
      solver_submission: "Submit the deterministic artifact described in the compiled contract.",
      scoring_summary: `Agora will score submissions with ${spec.evaluation.metric}.`,
      public_private_summary: [
        "Public artifacts are visible to solvers before the challenge opens.",
        "Private evaluation artifacts stay hidden until scoring begins.",
      ],
      reward_summary: `Reward total: ${spec.reward.total} USDC.`,
      deadline_summary: `Submission deadline: ${spec.deadline}.`,
      dry_run_summary: "The compiled scoring contract passed a dry run for the fixture inputs.",
    },
    challenge_spec: spec,
  };
}

async function waitFor<T>(
  description: string,
  task: () => Promise<T | null>,
  timeoutMs = E2E_POLL_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await task();
    if (value !== null) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, E2E_POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function assertLifecycleProjectionPrerequisites(
  db: ReturnType<typeof createSupabaseClient>,
) {
  const { error: challengeProjectionError } = await db
    .from("challenges")
    .select("id,evaluation_plan_json")
    .limit(1);
  if (challengeProjectionError) {
    throw new Error(
      `Lifecycle E2E requires challenges.evaluation_plan_json in the PostgREST schema cache. Next step: apply migration 029_add_challenge_evaluation_plan.sql, apply migration 030_make_challenge_runtime_caches_optional.sql, reload the PostgREST schema cache, and retry. ${challengeProjectionError.message}`,
    );
  }

  const { error: budgetReservationError } = await db
    .from("authoring_sponsor_budget_reservations")
    .select("draft_id,status")
    .limit(1);
  if (budgetReservationError) {
    throw new Error(
      `Lifecycle E2E requires authoring_sponsor_budget_reservations in the PostgREST schema cache. Next step: apply migration 028_add_authoring_sponsor_budget_reservations.sql, reload the PostgREST schema cache, and retry. ${budgetReservationError.message}`,
    );
  }
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function getTrackedChallengeRow(
  db: ReturnType<typeof createSupabaseClient>,
  challengeAddress: `0x${string}`,
) {
  const { data, error } = await db
    .from("challenges")
    .select(
      "id, contract_address, factory_address, tx_hash, status, max_submissions_total, max_submissions_per_solver",
    )
    .eq("contract_address", challengeAddress.toLowerCase())
    .single();

  if (error) {
    throw new Error(`Failed to load projected challenge row: ${error.message}`);
  }

  return data as ChallengeListRow;
}

async function projectFactoryReceipt(input: {
  db: ReturnType<typeof createSupabaseClient>;
  publicClient: ReturnType<typeof getPublicClient>;
  txHash: `0x${string}`;
  blockNumber: bigint;
}) {
  const { db, publicClient, txHash, blockNumber } = input;
  const config = loadConfig();
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  const logs = parseFactoryLogs(receipt.logs);
  for (const log of logs) {
    await processFactoryLog({
      db,
      publicClient,
      config,
      log,
      fromBlock: blockNumber,
    });
  }
}

async function projectChallengeReceipt(input: {
  db: ReturnType<typeof createSupabaseClient>;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  challengeFromBlock: bigint;
  txHash: `0x${string}`;
}) {
  const { db, publicClient, challenge, challengeFromBlock, txHash } = input;
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  const logs = parseChallengeLogs(
    receipt.logs,
    challenge.contract_address as `0x${string}`,
  );
  const challengePersistTargets = new Map<string, bigint>();
  const challengeCursorKey = `challenge:e2e:${challenge.id}`;

  for (const log of logs) {
    await processChallengeLog({
      db,
      publicClient,
      challenge,
      log,
      fromBlock: challengeFromBlock,
      challengeFromBlock,
      challengeCursorKey,
      challengePersistTargets,
    });
  }

  await reconcileChallengeProjection({
    db,
    publicClient,
    challenge,
    challengeFromBlock,
    blockNumber: receipt.blockNumber,
  });
}

async function prepareReproducibilityScenario() {
  const reproducibilityDir = repoPath(
    "challenges",
    "test-data",
    "reproducibility",
  );
  const trainCid = await pinFile(
    path.join(reproducibilityDir, "input_dataset.csv"),
    "e2e-input-dataset.csv",
  );
  const expectedCid = await pinFile(
    path.join(reproducibilityDir, "expected_output.csv"),
    "e2e-expected-output.csv",
  );

  return {
    label: "reproducibility",
    specCid: await pinJSON(
      "e2e-reproducibility-spec.json",
      buildE2ESpec({ trainCid, expectedCid }),
    ),
    submissionSourcePath: path.join(
      reproducibilityDir,
      "sample_submission.csv",
    ),
  } satisfies LifecycleScenarioPrepared;
}

async function assertPredictionPublicApis(input: {
  app: ReturnType<typeof createApp>;
  challengeId: string;
  submissionId: string;
}) {
  await waitFor("prediction challenge public routes", async () => {
    try {
      const detailResponse = await input.app.request(
        new Request(`http://localhost/api/challenges/${input.challengeId}`),
      );
      if (detailResponse.status !== 200) {
        throw new Error(
          `Prediction detail route returned ${detailResponse.status}.`,
        );
      }
      const detailBody = (await detailResponse.json()) as {
        data?: {
          challenge?: {
            id?: string;
            type?: string;
            status?: string;
            submissions_count?: unknown;
          };
          leaderboard?: Array<{ id?: string; score?: unknown }>;
        };
      };
      const detailChallenge = detailBody.data?.challenge;
      const detailCount = readNumber(detailChallenge?.submissions_count);
      if (detailChallenge?.id !== input.challengeId) {
        throw new Error("Prediction detail route returned the wrong challenge.");
      }
      if (detailChallenge?.type !== "prediction") {
        throw new Error("Prediction detail route lost the challenge type.");
      }
      if (detailChallenge?.status !== "finalized") {
        throw new Error("Prediction challenge should be finalized.");
      }
      if (detailCount === null || detailCount < 1) {
        throw new Error(
          `Prediction detail route reported submissions_count=${String(detailChallenge?.submissions_count)}.`,
        );
      }
      const detailLeaderboard = detailBody.data?.leaderboard ?? [];
      if (detailLeaderboard.length === 0) {
        throw new Error("Prediction detail route returned an empty leaderboard.");
      }
      if (detailLeaderboard[0]?.id !== input.submissionId) {
        throw new Error("Prediction detail route did not expose the scored submission.");
      }
      if (detailLeaderboard[0]?.score === null || detailLeaderboard[0]?.score === undefined) {
        throw new Error("Prediction detail leaderboard row is missing the score.");
      }

      const leaderboardResponse = await input.app.request(
        new Request(
          `http://localhost/api/challenges/${input.challengeId}/leaderboard`,
        ),
      );
      if (leaderboardResponse.status !== 200) {
        throw new Error(
          `Prediction leaderboard route returned ${leaderboardResponse.status}.`,
        );
      }
      const leaderboardBody = (await leaderboardResponse.json()) as {
        data?: Array<{ id?: string; score?: unknown }>;
      };
      if ((leaderboardBody.data ?? [])[0]?.id !== input.submissionId) {
        throw new Error("Prediction leaderboard route did not expose the scored submission.");
      }

      const listResponse = await input.app.request(
        new Request("http://localhost/api/challenges"),
      );
      if (listResponse.status !== 200) {
        throw new Error(`Prediction list route returned ${listResponse.status}.`);
      }
      const listBody = (await listResponse.json()) as {
        data?: Array<{ id?: string; submissions_count?: unknown; status?: string }>;
      };
      const listRow = (listBody.data ?? []).find(
        (row) => row.id === input.challengeId,
      );
      const listCount = readNumber(listRow?.submissions_count);
      if (!listRow) {
        throw new Error("Prediction challenge was missing from the public list.");
      }
      if (listRow.status !== "finalized") {
        throw new Error("Prediction challenge list row should be finalized.");
      }
      if (listCount === null || listCount < 1) {
        throw new Error(
          `Prediction challenge list row reported submissions_count=${String(listRow.submissions_count)}.`,
        );
      }
      return true;
    } catch {
      return null;
    }
  });
}

async function preparePredictionScenario() {
  const predictionDir = repoPath("challenges", "test-data", "prediction");
  const trainCid = await pinFile(
    path.join(predictionDir, "train.csv"),
    "e2e-prediction-train.csv",
  );
  const testCid = await pinFile(
    path.join(predictionDir, "test.csv"),
    "e2e-prediction-test.csv",
  );
  const hiddenLabelsCid = await pinFile(
    path.join(predictionDir, "hidden_labels.csv"),
    "e2e-prediction-hidden-labels.csv",
  );

  return {
    label: "prediction",
    specCid: await pinJSON(
      "e2e-prediction-spec.json",
      buildPredictionE2ESpec({ trainCid, testCid, hiddenLabelsCid }),
    ),
    submissionSourcePath: path.join(predictionDir, "sample_submission.csv"),
    assertPublicApis: assertPredictionPublicApis,
  } satisfies LifecycleScenarioPrepared;
}

async function runPublishedChallengeLifecycle(input: {
  db: ReturnType<typeof createSupabaseClient>;
  publicClient: ReturnType<typeof getPublicClient>;
  app: ReturnType<typeof createApp>;
  challenge: ChallengeListRow;
  challengeAddress: `0x${string}`;
  challengeFromBlock: bigint;
  accountAddress: `0x${string}`;
  useSealedSubmission: boolean;
  prepared: LifecycleScenarioPrepared;
}) {
  const {
    db,
    publicClient,
    app,
    challenge,
    challengeAddress,
    challengeFromBlock,
    accountAddress,
    useSealedSubmission,
    prepared,
  } = input;
  const config = loadConfig();

  const submissionCid = useSealedSubmission
    ? await (async () => {
        const publicKeyPem = config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM;
        const keyId = config.AGORA_SUBMISSION_SEAL_KEY_ID;
        if (!publicKeyPem || !keyId) {
          throw new Error(
            "Sealed lifecycle E2E requires AGORA_SUBMISSION_SEAL_KEY_ID and AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM.",
          );
        }
        const publicKey = await importSubmissionSealPublicKey(publicKeyPem);
        const sourceBytes = await fs.readFile(prepared.submissionSourcePath);
        const envelope = await sealSubmission({
          challengeId: challenge.id,
          solverAddress: accountAddress.toLowerCase(),
          fileName: path.basename(prepared.submissionSourcePath),
          mimeType: "text/csv",
          bytes: new Uint8Array(sourceBytes),
          keyId,
          publicKey,
        });
        return pinJSON(`e2e-${prepared.label}-sealed-submission.json`, envelope);
      })()
    : await pinFile(
        prepared.submissionSourcePath,
        `e2e-${prepared.label}-sample-submission.csv`,
      );
  console.log(
    `3. Submission payload pinned${useSealedSubmission ? " (sealed path)" : ""}`,
  );

  const intentResponse = await app.request(
    new Request("http://localhost/api/submissions/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.id,
        solverAddress: accountAddress.toLowerCase(),
        resultCid: submissionCid,
        resultFormat: useSealedSubmission
          ? SUBMISSION_RESULT_FORMAT.sealedSubmissionV2
          : SUBMISSION_RESULT_FORMAT.plainV0,
      }),
    }),
  );
  if (intentResponse.status !== 200) {
    throw new Error(
      `Submission intent creation failed (${intentResponse.status}): ${await intentResponse.text()}`,
    );
  }
  const intentBody = (await intentResponse.json()) as {
    data?: { resultHash?: `0x${string}` };
  };
  const resultHash = intentBody.data?.resultHash;
  if (!resultHash) {
    throw new Error("Submission intent route succeeded without a result hash.");
  }

  const submitTxHash = await submitChallengeResult(challengeAddress, resultHash);
  await publicClient.waitForTransactionReceipt({ hash: submitTxHash });
  console.log("4. Submission posted:", submitTxHash);

  const submissionResponse = await app.request(
    new Request("http://localhost/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.id,
        resultCid: submissionCid,
        txHash: submitTxHash,
        resultFormat: useSealedSubmission
          ? SUBMISSION_RESULT_FORMAT.sealedSubmissionV2
          : SUBMISSION_RESULT_FORMAT.plainV0,
      }),
    }),
  );
  if (submissionResponse.status !== 200) {
    throw new Error(
      `Submission projection failed (${submissionResponse.status}): ${await submissionResponse.text()}`,
    );
  }
  const submissionBody = (await submissionResponse.json()) as {
    submission?: { id?: string };
    ok?: boolean;
  };
  const submissionId = submissionBody.submission?.id;
  if (!submissionId) {
    throw new Error("Submission route succeeded without a submission id.");
  }

  const lockedResponse = await app.request(
    new Request(`http://localhost/api/submissions/${submissionId}/public`),
  );
  if (lockedResponse.status !== 403) {
    throw new Error(
      `Expected open challenge public verification to be locked, got ${lockedResponse.status}.`,
    );
  }
  console.log("5. Open gate confirmed on public verification");

  const deadlineSeconds =
    (await publicClient.getBlock()).timestamp + BigInt(E2E_DEADLINE_SECONDS) + 1n;
  await advanceTimeTo(publicClient, deadlineSeconds);

  const startTxHash = await startChallengeScoring(challengeAddress);
  await publicClient.waitForTransactionReceipt({ hash: startTxHash });
  await projectChallengeReceipt({
    db,
    publicClient,
    challenge,
    challengeFromBlock,
    txHash: startTxHash,
  });
  console.log("6. startScoring projected:", startTxHash);

  const scoreJob = await waitFor("score job", async () => {
    await projectChallengeReceipt({
      db,
      publicClient,
      challenge,
      challengeFromBlock,
      txHash: startTxHash,
    });
    return claimNextJob(db, `lifecycle-e2e-${prepared.label}`);
  });
  await processJob(db, scoreJob, (_level, message) =>
    console.log(`[worker] ${message}`),
  );
  const scoredSubmission = await getSubmissionById(db, submissionId);
  if (!scoredSubmission.scored || !scoredSubmission.proof_bundle_cid) {
    throw new Error("Worker scoring did not persist score and proof bundle.");
  }
  console.log(
    "7. Worker scoring completed:",
    scoredSubmission.proof_bundle_cid,
  );

  const verifyResponse = await app.request(
    new Request(`http://localhost/api/submissions/${submissionId}/public`),
  );
  if (verifyResponse.status !== 200) {
    throw new Error(
      `Expected scored challenge public verification to be readable, got ${verifyResponse.status}.`,
    );
  }
  console.log("8. Public verification unlocked after scoring");

  const disputeTxHash = await disputeChallenge(challengeAddress, "e2e dispute");
  await publicClient.waitForTransactionReceipt({ hash: disputeTxHash });
  await projectChallengeReceipt({
    db,
    publicClient,
    challenge,
    challengeFromBlock,
    txHash: disputeTxHash,
  });
  console.log("9. Dispute opened:", disputeTxHash);

  const resolveTxHash = await resolveDispute(challengeAddress, 0n);
  await publicClient.waitForTransactionReceipt({ hash: resolveTxHash });
  await projectChallengeReceipt({
    db,
    publicClient,
    challenge,
    challengeFromBlock,
    txHash: resolveTxHash,
  });

  const projectedPayouts = await waitFor("projected payout rows", async () => {
    await projectChallengeReceipt({
      db,
      publicClient,
      challenge,
      challengeFromBlock,
      txHash: resolveTxHash,
    });
    const { data, error } = await db
      .from("challenge_payouts")
      .select("*")
      .eq("challenge_id", challenge.id)
      .order("rank", { ascending: true });
    if (error) {
      throw new Error(`Failed to load projected payouts: ${error.message}`);
    }
    if ((data ?? []).length !== 3) {
      return null;
    }
    return data;
  });
  console.log(
    `10. Canonical top_3 payout rows projected (${projectedPayouts.length})`,
  );

  if (prepared.assertPublicApis) {
    await prepared.assertPublicApis({
      app,
      challengeId: challenge.id,
      submissionId,
    });
    console.log("11. Public API projections aligned");
  }

  const payoutBeforeClaim = await getChallengePayoutByAddress(
    challengeAddress,
    accountAddress,
  );
  if (payoutBeforeClaim === 0n) {
    throw new Error("Expected a claimable payout after dispute resolution.");
  }

  const claimTxHash = await claimPayout(challengeAddress);
  await publicClient.waitForTransactionReceipt({ hash: claimTxHash });
  await projectChallengeReceipt({
    db,
    publicClient,
    challenge,
    challengeFromBlock,
    txHash: claimTxHash,
  });

  const payoutAfterClaim = await getChallengePayoutByAddress(
    challengeAddress,
    accountAddress,
  );
  if (payoutAfterClaim !== 0n) {
    throw new Error("Expected payout to be zero after claim.");
  }

  const { data: claimedRows, error: claimedRowsError } = await db
    .from("challenge_payouts")
    .select("rank, claimed_at, claim_tx_hash")
    .eq("challenge_id", challenge.id)
    .eq("solver_address", accountAddress.toLowerCase())
    .order("rank", { ascending: true });
  if (claimedRowsError) {
    throw new Error(
      `Failed to load claimed payout rows: ${claimedRowsError.message}`,
    );
  }
  if ((claimedRows ?? []).length !== 3) {
    throw new Error(
      "Expected claim projection to preserve all three payout rows.",
    );
  }
  for (const row of claimedRows ?? []) {
    if (!row.claimed_at || row.claim_tx_hash !== claimTxHash) {
      throw new Error("Claim projection did not repair all payout claim rows.");
    }
  }
  console.log(
    `${prepared.assertPublicApis ? "12" : "11"}. Claim succeeded and all allocation rows were marked claimed`,
  );
}

async function runLifecycleScenario(input: {
  db: ReturnType<typeof createSupabaseClient>;
  publicClient: ReturnType<typeof getPublicClient>;
  app: ReturnType<typeof createApp>;
  accountAddress: `0x${string}`;
  useSealedSubmission: boolean;
  prepared: LifecycleScenarioPrepared;
}) {
  const { db, publicClient, app, accountAddress, useSealedSubmission, prepared } =
    input;
  const config = loadConfig();

  console.log(`\n=== E2E TEST: ${prepared.label} ===\n`);
  console.log("1. Base fixtures pinned");

  const approveTxHash = await approve(
    config.AGORA_FACTORY_ADDRESS,
    E2E_REWARD_USDC,
  );
  await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

  const latestBlock = await publicClient.getBlock();
  const createTxHash = await createChallenge({
    specCid: prepared.specCid,
    rewardAmount: E2E_REWARD_USDC,
    deadline: Number(latestBlock.timestamp + BigInt(E2E_DEADLINE_SECONDS)),
    disputeWindowHours: E2E_DISPUTE_WINDOW_HOURS,
    minimumScore: 0n,
    distributionType: 1,
    labTba: ZERO_ADDRESS,
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({
    hash: createTxHash,
  });
  const { challengeAddress } = parseChallengeCreatedReceipt(createReceipt);
  console.log("2. Challenge created:", challengeAddress);

  await projectFactoryReceipt({
    db,
    publicClient,
    txHash: createTxHash,
    blockNumber: createReceipt.blockNumber,
  });

  const challenge = await waitFor("projected challenge row", async () => {
    await projectFactoryReceipt({
      db,
      publicClient,
      txHash: createTxHash,
      blockNumber: createReceipt.blockNumber,
    });
    try {
      return await getTrackedChallengeRow(db, challengeAddress);
    } catch {
      return null;
    }
  });

  await runPublishedChallengeLifecycle({
    db,
    publicClient,
    app,
    challenge,
    challengeAddress,
    challengeFromBlock: createReceipt.blockNumber,
    accountAddress,
    useSealedSubmission,
    prepared,
  });
}

async function runAuthoringPublishLifecycleScenario(input: {
  db: ReturnType<typeof createSupabaseClient>;
  publicClient: ReturnType<typeof getPublicClient>;
  app: ReturnType<typeof createApp>;
  accountAddress: `0x${string}`;
  sponsorPrivateKey: `0x${string}`;
  useSealedSubmission: boolean;
}) {
  const reproducibilityDir = repoPath(
    "challenges",
    "test-data",
    "reproducibility",
  );
  const trainCid = await pinFile(
    path.join(reproducibilityDir, "input_dataset.csv"),
    "e2e-authoring-input-dataset.csv",
  );
  const expectedCid = await pinFile(
    path.join(reproducibilityDir, "expected_output.csv"),
    "e2e-authoring-expected-output.csv",
  );
  const spec = buildE2ESpec({ trainCid, expectedCid });
  const specCid = await pinJSON("e2e-authoring-publish-spec.json", spec);

  console.log("\n=== E2E TEST: authoring_publish ===\n");
  console.log("1. Authoring draft fixtures pinned");

  const draft = await createDraft({
    db: input.db,
    state: "ready",
    posterAddress: input.accountAddress,
    intentJson: {
      title: spec.title,
      description: spec.description,
      payout_condition: "Highest exact match wins.",
      reward_total: spec.reward.total,
      distribution: spec.reward.distribution,
      deadline: spec.deadline,
      domain: spec.domain,
      tags: [],
      timezone: "UTC",
    },
    compilationJson: buildE2EDraftCompilation(spec),
    expiresInMs: 10 * 60 * 1000,
  });

  const publishResult = await sponsorAndPublishAuthoringDraft({
    db: input.db,
    draft,
    spec,
    specCid,
    sponsorPrivateKey: input.sponsorPrivateKey,
    expiresInMs: 10 * 60 * 1000,
  });
  console.log("2. Draft published through sponsor path:", publishResult.challenge.challengeAddress);

  const createReceipt = await input.publicClient.getTransactionReceipt({
    hash: publishResult.txHash,
  });
  const challenge = await getTrackedChallengeRow(
    input.db,
    publishResult.challenge.challengeAddress as `0x${string}`,
  );

  await runPublishedChallengeLifecycle({
    db: input.db,
    publicClient: input.publicClient,
    app: input.app,
    challenge,
    challengeAddress: publishResult.challenge.challengeAddress as `0x${string}`,
    challengeFromBlock: createReceipt.blockNumber,
    accountAddress: input.accountAddress,
    useSealedSubmission: input.useSealedSubmission,
    prepared: {
      label: "authoring_publish",
      specCid,
      submissionSourcePath: path.join(
        reproducibilityDir,
        "sample_submission.csv",
      ),
    },
  });
}

export async function runLifecycleE2E() {
  const config = loadConfig();
  if (!config.AGORA_SUPABASE_SERVICE_KEY) {
    throw new Error(
      "Lifecycle E2E requires AGORA_SUPABASE_SERVICE_KEY. Provide it and retry.",
    );
  }
  if (!config.AGORA_PINATA_JWT) {
    throw new Error(
      "Lifecycle E2E requires AGORA_PINATA_JWT. Provide it and retry.",
    );
  }

  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const account = walletClient.account;
  const sponsorPrivateKey = resolveRuntimePrivateKey(config);
  if (!account || !sponsorPrivateKey) {
    throw new Error(
      "Wallet client account is not configured. Set AGORA_PRIVATE_KEY or AGORA_ORACLE_KEY and retry.",
    );
  }

  await ensureWalletMatchesOracle(
    publicClient,
    config.AGORA_FACTORY_ADDRESS,
    account.address,
  );

  const db = createSupabaseClient(true);
  await assertLifecycleProjectionPrerequisites(db);
  const app = createApp();
  const useSealedSubmission = hasSubmissionSealWorkerConfig(config);
  const scenarios = await Promise.all([
    prepareReproducibilityScenario(),
    preparePredictionScenario(),
  ]);

  for (const prepared of scenarios) {
    await runLifecycleScenario({
      db,
      publicClient,
      app,
      accountAddress: account.address,
      useSealedSubmission,
      prepared,
    });
  }

  await runAuthoringPublishLifecycleScenario({
    db,
    publicClient,
    app,
    accountAddress: account.address,
    sponsorPrivateKey,
    useSealedSubmission,
  });
}

function maybeRunLifecycleE2ECli(importMetaUrl: string, argv1?: string) {
  const isEntrypoint = argv1
    ? pathToFileURL(argv1).href === importMetaUrl
    : false;
  if (!isEntrypoint) return;

  runLifecycleE2E()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

maybeRunLifecycleE2ECli(import.meta.url, process.argv[1]);
