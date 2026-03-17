import {
  CHALLENGE_STATUS,
  type ChallengeStatus,
  SCORE_JOB_STATUS,
  SUBMISSION_RESULT_CID_MISSING_ERROR,
  SUBMISSION_RESULT_FORMAT,
  type SubmissionResultFormat,
  getSubmissionLimitViolation,
  resolveSubmissionLimits,
} from "@agora/common";
import type { AgoraDbClient } from "../index";
import {
  attachScoreJobTraceIdIfMissing,
  createScoreJob,
  getScoreJobBySubmissionId,
  markScoreJobSkipped,
  reviveMetadataBlockedScoreJob,
} from "./score-jobs.js";
import {
  attachSubmissionResultMetadata,
  countSubmissionsBySolverForChallengeUpToOnChainSubId,
  countSubmissionsForChallengeUpToOnChainSubId,
  findPendingSubmissionByMatch,
  findSubmissionByExactMetadata,
} from "./submissions.js";

export interface SubmissionIntentInsert {
  challenge_id: string;
  solver_address: string;
  result_hash: string;
  result_cid: string;
  result_format?: SubmissionResultFormat;
  expires_at: string;
  trace_id?: string | null;
}

export interface SubmissionIntentRow {
  id: string;
  challenge_id: string;
  solver_address: string;
  result_hash: string;
  result_cid: string;
  result_format: SubmissionResultFormat;
  matched_submission_id: string | null;
  matched_at: string | null;
  trace_id: string | null;
  expires_at: string;
  created_at: string;
}

export interface SubmissionIntentChallengeContext {
  id: string;
  status: ChallengeStatus;
  max_submissions_total?: number | null;
  max_submissions_per_solver?: number | null;
}

export type SubmissionIntentScoreJobAction =
  | "queued"
  | "revived"
  | "skipped"
  | "unchanged"
  | "not_applicable";

export interface ReconcileSubmissionIntentResult {
  matched: boolean;
  intent: SubmissionIntentRow | null;
  submission: {
    id: string;
    challenge_id: string;
    on_chain_sub_id: number;
    solver_address: string;
    result_hash: string;
    result_cid: string | null;
    result_format: SubmissionResultFormat;
    scored: boolean;
    trace_id?: string | null;
  } | null;
  scoreJobAction: SubmissionIntentScoreJobAction;
  warning: string | null;
}

export async function createSubmissionIntent(
  db: AgoraDbClient,
  payload: SubmissionIntentInsert,
) {
  const { data, error } = await db
    .from("submission_intents")
    .insert({
      ...payload,
      solver_address: payload.solver_address.toLowerCase(),
      result_format: payload.result_format ?? SUBMISSION_RESULT_FORMAT.plainV0,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create submission intent: ${error.message}`);
  }

  return data as SubmissionIntentRow;
}

export async function findOldestUnmatchedSubmissionIntent(
  db: AgoraDbClient,
  input: {
    challengeId: string;
    solverAddress: string;
    resultHash: string;
    nowIso?: string;
  },
) {
  const { data, error } = await db
    .from("submission_intents")
    .select("*")
    .eq("challenge_id", input.challengeId)
    .eq("solver_address", input.solverAddress.toLowerCase())
    .eq("result_hash", input.resultHash)
    .is("matched_submission_id", null)
    .gt("expires_at", input.nowIso ?? new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to fetch unmatched submission intent: ${error.message}`,
    );
  }

  return (data as SubmissionIntentRow | null) ?? null;
}

export async function getSubmissionIntentById(
  db: AgoraDbClient,
  intentId: string,
) {
  const { data, error } = await db
    .from("submission_intents")
    .select("*")
    .eq("id", intentId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch submission intent: ${error.message}`);
  }

  return (data as SubmissionIntentRow | null) ?? null;
}

export async function deleteUnmatchedSubmissionIntentById(
  db: AgoraDbClient,
  intentId: string,
) {
  const { data, error } = await db
    .from("submission_intents")
    .delete()
    .eq("id", intentId)
    .is("matched_submission_id", null)
    .select("*")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to delete submission intent: ${error.message}`);
  }

  return (data as SubmissionIntentRow | null) ?? null;
}

export async function countUnmatchedSubmissionIntentsByResultCid(
  db: AgoraDbClient,
  resultCid: string,
  input?: {
    excludeIntentId?: string;
  },
) {
  let query = db
    .from("submission_intents")
    .select("id", { count: "exact", head: true })
    .eq("result_cid", resultCid)
    .is("matched_submission_id", null);

  if (input?.excludeIntentId) {
    query = query.neq("id", input.excludeIntentId);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(
      `Failed to count unmatched submission intents: ${error.message}`,
    );
  }

  return count ?? 0;
}

export async function markSubmissionIntentMatched(
  db: AgoraDbClient,
  intentId: string,
  submissionId: string,
) {
  const { data, error } = await db
    .from("submission_intents")
    .update({
      matched_submission_id: submissionId,
      matched_at: new Date().toISOString(),
    })
    .eq("id", intentId)
    .is("matched_submission_id", null)
    .select("*")
    .maybeSingle();

  if (!error) {
    return (data as SubmissionIntentRow | null) ?? null;
  }

  if (error.code === "PGRST116" || error.code === "23505") {
    return null;
  }

  throw new Error(`Failed to mark submission intent matched: ${error.message}`);
}

async function ensureScoreJobForSubmission(
  db: AgoraDbClient,
  challenge: SubmissionIntentChallengeContext,
  submission: {
    id: string;
    challenge_id: string;
    on_chain_sub_id: number;
    solver_address: string;
    scored: boolean;
    trace_id?: string | null;
  },
  traceId?: string | null,
): Promise<{
  action: SubmissionIntentScoreJobAction;
  warning: string | null;
}> {
  if (
    submission.scored ||
    (challenge.status !== CHALLENGE_STATUS.open &&
      challenge.status !== CHALLENGE_STATUS.scoring)
  ) {
    return { action: "not_applicable", warning: null };
  }

  const limits = resolveSubmissionLimits({
    max_submissions_total: challenge.max_submissions_total,
    max_submissions_per_solver: challenge.max_submissions_per_solver,
  });
  const [totalSubmissions, solverSubmissions] = await Promise.all([
    countSubmissionsForChallengeUpToOnChainSubId(
      db,
      challenge.id,
      submission.on_chain_sub_id,
    ),
    countSubmissionsBySolverForChallengeUpToOnChainSubId(
      db,
      challenge.id,
      submission.solver_address,
      submission.on_chain_sub_id,
    ),
  ]);

  const violation = getSubmissionLimitViolation({
    totalSubmissions,
    solverSubmissions,
    limits,
  });
  if (violation) {
    await markScoreJobSkipped(
      db,
      {
        submission_id: submission.id,
        challenge_id: challenge.id,
        trace_id: traceId ?? submission.trace_id ?? null,
      },
      violation,
    );
    return { action: "skipped", warning: violation };
  }

  const revived = await reviveMetadataBlockedScoreJob(db, submission.id);
  if (revived) {
    return { action: "revived", warning: null };
  }

  const existingJob = await getScoreJobBySubmissionId(db, submission.id);
  if (existingJob) {
    if (traceId && !existingJob.trace_id) {
      await attachScoreJobTraceIdIfMissing(db, existingJob.id, traceId);
    }
    if (
      existingJob.status === SCORE_JOB_STATUS.failed &&
      existingJob.last_error?.startsWith(SUBMISSION_RESULT_CID_MISSING_ERROR)
    ) {
      return { action: "unchanged", warning: null };
    }
    return { action: "unchanged", warning: null };
  }

  await createScoreJob(db, {
    submission_id: submission.id,
    challenge_id: challenge.id,
    trace_id: traceId ?? submission.trace_id ?? null,
  });
  return { action: "queued", warning: null };
}

export async function reconcileSubmissionIntentMatch(
  db: AgoraDbClient,
  input: {
    challenge: SubmissionIntentChallengeContext;
    solverAddress: string;
    resultHash: string;
  },
): Promise<ReconcileSubmissionIntentResult> {
  const intent = await findOldestUnmatchedSubmissionIntent(db, {
    challengeId: input.challenge.id,
    solverAddress: input.solverAddress,
    resultHash: input.resultHash,
  });

  if (!intent) {
    return {
      matched: false,
      intent: null,
      submission: null,
      scoreJobAction: "unchanged",
      warning: null,
    };
  }

  const pendingSubmission = await findPendingSubmissionByMatch(
    db,
    input.challenge.id,
    input.solverAddress,
    input.resultHash,
  );
  const existingExactSubmission =
    pendingSubmission ??
    (await findSubmissionByExactMetadata(db, {
      challengeId: input.challenge.id,
      solverAddress: input.solverAddress,
      resultHash: input.resultHash,
      resultCid: intent.result_cid,
      resultFormat: intent.result_format,
    }));

  if (!existingExactSubmission) {
    return {
      matched: false,
      intent,
      submission: null,
      scoreJobAction: "unchanged",
      warning: null,
    };
  }

  const attachedSubmission = await attachSubmissionResultMetadata(
    db,
    existingExactSubmission.id,
    intent.result_cid,
    intent.result_format,
    intent.trace_id,
  );
  const matchedIntent = await markSubmissionIntentMatched(
    db,
    intent.id,
    attachedSubmission.id,
  );
  const scoreJob = await ensureScoreJobForSubmission(
    db,
    input.challenge,
    {
      id: attachedSubmission.id,
      challenge_id: attachedSubmission.challenge_id,
      on_chain_sub_id: attachedSubmission.on_chain_sub_id,
      solver_address: attachedSubmission.solver_address,
      scored: attachedSubmission.scored,
      trace_id: attachedSubmission.trace_id ?? intent.trace_id,
    },
    intent.trace_id,
  );

  return {
    matched: Boolean(matchedIntent),
    intent: matchedIntent ?? intent,
    submission: attachedSubmission,
    scoreJobAction: scoreJob.action,
    warning: scoreJob.warning,
  };
}
