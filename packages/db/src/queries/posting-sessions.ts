import type {
  ChallengeIntentOutput,
  CompilationResultOutput,
  ConfirmationContractOutput,
  PostingSessionOutput,
  PostingSessionState,
} from "@agora/common";
import type { ChallengeSpecOutput, AuthoringArtifactOutput } from "@agora/common";
import type { AgoraDbClient } from "../index";

type ClarificationQuestionList =
  PostingSessionOutput["clarification_questions"];
type PostingReviewSummary = NonNullable<PostingSessionOutput["review_summary"]>;
type PostingSessionStateCounts = Record<PostingSessionState, number>;

const POSTING_SESSION_STATE_VALUES: PostingSessionState[] = [
  "draft",
  "compiling",
  "ready",
  "needs_clarification",
  "needs_review",
  "published",
  "failed",
];

export interface PostingSessionInsert {
  poster_address?: string | null;
  state: PostingSessionState;
  intent_json?: ChallengeIntentOutput | null;
  uploaded_artifacts_json?: AuthoringArtifactOutput[];
  compilation_json?: CompilationResultOutput | null;
  clarification_questions_json?: ClarificationQuestionList;
  review_summary_json?: PostingReviewSummary | null;
  approved_confirmation_json?: ConfirmationContractOutput | null;
  published_spec_json?: ChallengeSpecOutput | null;
  published_spec_cid?: string | null;
  failure_message?: string | null;
  expires_at: string;
}

export interface PostingSessionRow {
  id: string;
  poster_address: string | null;
  state: PostingSessionState;
  intent_json: ChallengeIntentOutput | null;
  uploaded_artifacts_json: AuthoringArtifactOutput[];
  compilation_json: CompilationResultOutput | null;
  clarification_questions_json: ClarificationQuestionList;
  review_summary_json: PostingReviewSummary | null;
  approved_confirmation_json: ConfirmationContractOutput | null;
  published_spec_json: ChallengeSpecOutput | null;
  published_spec_cid: string | null;
  failure_message: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface PostingSessionHealthSnapshot {
  counts: PostingSessionStateCounts;
  expired: number;
  staleCompiling: number;
  oldestNeedsReviewAt: string | null;
  oldestNeedsReviewAgeMs: number | null;
}

function createEmptyPostingSessionStateCounts(): PostingSessionStateCounts {
  return {
    draft: 0,
    compiling: 0,
    ready: 0,
    needs_clarification: 0,
    needs_review: 0,
    published: 0,
    failed: 0,
  };
}

async function readPostingSessionCount(
  db: AgoraDbClient,
  mutate: (query: any) => any,
) {
  const query = mutate(
    db.from("posting_sessions").select("id", {
      count: "exact",
      head: true,
    }),
  );
  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed to count posting sessions: ${error.message}`);
  }
  return count ?? 0;
}

function normalizeSessionAddress(address?: string | null) {
  if (!address) {
    return null;
  }
  return address.toLowerCase();
}

export async function createPostingSession(
  db: AgoraDbClient,
  payload: PostingSessionInsert,
): Promise<PostingSessionRow> {
  const { data, error } = await db
    .from("posting_sessions")
    .insert({
      poster_address: normalizeSessionAddress(payload.poster_address),
      state: payload.state,
      intent_json: payload.intent_json ?? null,
      uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
      compilation_json: payload.compilation_json ?? null,
      clarification_questions_json: payload.clarification_questions_json ?? [],
      review_summary_json: payload.review_summary_json ?? null,
      approved_confirmation_json: payload.approved_confirmation_json ?? null,
      published_spec_json: payload.published_spec_json ?? null,
      published_spec_cid: payload.published_spec_cid ?? null,
      failure_message: payload.failure_message ?? null,
      expires_at: payload.expires_at,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create posting session: ${error.message}`);
  }

  return data as PostingSessionRow;
}

export async function getPostingSessionById(
  db: AgoraDbClient,
  id: string,
): Promise<PostingSessionRow | null> {
  const { data, error } = await db
    .from("posting_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read posting session: ${error.message}`);
  }

  return (data as PostingSessionRow | null) ?? null;
}

export async function updatePostingSession(
  db: AgoraDbClient,
  input: {
    id: string;
    poster_address?: string | null;
    state?: PostingSessionState;
    intent_json?: ChallengeIntentOutput | null;
    uploaded_artifacts_json?: AuthoringArtifactOutput[];
    compilation_json?: CompilationResultOutput | null;
    clarification_questions_json?: ClarificationQuestionList;
    review_summary_json?: PostingReviewSummary | null;
    approved_confirmation_json?: ConfirmationContractOutput | null;
    published_spec_json?: ChallengeSpecOutput | null;
    published_spec_cid?: string | null;
    failure_message?: string | null;
    expires_at?: string;
  },
): Promise<PostingSessionRow> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.poster_address !== undefined) {
    patch.poster_address = normalizeSessionAddress(input.poster_address);
  }
  if (input.state !== undefined) {
    patch.state = input.state;
  }
  if (input.intent_json !== undefined) {
    patch.intent_json = input.intent_json;
  }
  if (input.uploaded_artifacts_json !== undefined) {
    patch.uploaded_artifacts_json = input.uploaded_artifacts_json;
  }
  if (input.compilation_json !== undefined) {
    patch.compilation_json = input.compilation_json;
  }
  if (input.clarification_questions_json !== undefined) {
    patch.clarification_questions_json = input.clarification_questions_json;
  }
  if (input.review_summary_json !== undefined) {
    patch.review_summary_json = input.review_summary_json;
  }
  if (input.approved_confirmation_json !== undefined) {
    patch.approved_confirmation_json = input.approved_confirmation_json;
  }
  if (input.published_spec_json !== undefined) {
    patch.published_spec_json = input.published_spec_json;
  }
  if (input.published_spec_cid !== undefined) {
    patch.published_spec_cid = input.published_spec_cid;
  }
  if (input.failure_message !== undefined) {
    patch.failure_message = input.failure_message;
  }
  if (input.expires_at !== undefined) {
    patch.expires_at = input.expires_at;
  }

  const { data, error } = await db
    .from("posting_sessions")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update posting session: ${error.message}`);
  }

  return data as PostingSessionRow;
}

export async function listPostingSessionsByState(
  db: AgoraDbClient,
  input: {
    states: PostingSessionState[];
    limit?: number;
    includeExpired?: boolean;
    nowIso?: string;
  },
): Promise<PostingSessionRow[]> {
  let query = db
    .from("posting_sessions")
    .select("*")
    .in("state", input.states);

  if (!input.includeExpired) {
    query = query.gt("expires_at", input.nowIso ?? new Date().toISOString());
  }

  const { data, error } = await query
    .order("updated_at", { ascending: true })
    .limit(input.limit ?? 25);

  if (error) {
    throw new Error(`Failed to list posting sessions: ${error.message}`);
  }

  return (data as PostingSessionRow[] | null) ?? [];
}

export async function purgeExpiredPostingSessions(
  db: AgoraDbClient,
  nowIso = new Date().toISOString(),
) {
  const { data, error } = await db
    .from("posting_sessions")
    .delete()
    .lte("expires_at", nowIso)
    .select("state");

  if (error) {
    throw new Error(`Failed to purge expired posting sessions: ${error.message}`);
  }

  const deletedStateCounts = createEmptyPostingSessionStateCounts();
  for (const row of (data as Array<{ state: PostingSessionState }> | null) ?? []) {
    deletedStateCounts[row.state] += 1;
  }

  const result = {
    checked_at: nowIso,
    deleted_count: (data as Array<{ state: PostingSessionState }> | null)?.length ?? 0,
    deleted_state_counts: deletedStateCounts,
  };

  return result;
}

export async function readPostingSessionHealthSnapshot(
  db: AgoraDbClient,
  input?: {
    nowIso?: string;
    staleCompilingAfterMs?: number;
  },
): Promise<PostingSessionHealthSnapshot> {
  const nowIso = input?.nowIso ?? new Date().toISOString();
  const staleCompilingAfterMs = input?.staleCompilingAfterMs ?? 5 * 60 * 1000;
  const staleCompilingBeforeIso = new Date(
    new Date(nowIso).getTime() - staleCompilingAfterMs,
  ).toISOString();

  const countPromises = POSTING_SESSION_STATE_VALUES.map(async (state) => {
    const count = await readPostingSessionCount(
      db,
      (query) => query.eq("state", state).gt("expires_at", nowIso),
    );
    return [state, count] as const;
  });

  const expiredPromise = readPostingSessionCount(
    db,
    (query) => query.lte("expires_at", nowIso),
  );
  const staleCompilingPromise = readPostingSessionCount(
    db,
    (query) =>
      query
        .eq("state", "compiling")
        .gt("expires_at", nowIso)
        .lte("updated_at", staleCompilingBeforeIso),
  );
  const oldestNeedsReviewPromise = db
    .from("posting_sessions")
    .select("updated_at")
    .eq("state", "needs_review")
    .gt("expires_at", nowIso)
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const [countsByState, expired, staleCompiling, oldestNeedsReviewResult] =
    await Promise.all([
      Promise.all(countPromises),
      expiredPromise,
      staleCompilingPromise,
      oldestNeedsReviewPromise,
    ]);

  if (
    oldestNeedsReviewResult.error &&
    oldestNeedsReviewResult.error.code !== "PGRST116"
  ) {
    throw new Error(
      `Failed to read posting review queue health: ${oldestNeedsReviewResult.error.message}`,
    );
  }

  const counts = createEmptyPostingSessionStateCounts();
  for (const [state, count] of countsByState) {
    counts[state] = count;
  }

  const oldestNeedsReviewAt =
    (oldestNeedsReviewResult.data as { updated_at?: string } | null)?.updated_at ??
    null;
  const oldestNeedsReviewAgeMs = oldestNeedsReviewAt
    ? Math.max(0, new Date(nowIso).getTime() - new Date(oldestNeedsReviewAt).getTime())
    : null;

  return {
    counts,
    expired,
    staleCompiling,
    oldestNeedsReviewAt,
    oldestNeedsReviewAgeMs,
  };
}
