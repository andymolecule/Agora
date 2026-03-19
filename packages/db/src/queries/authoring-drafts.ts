import type {
  AuthoringDraftState,
  ChallengeAuthoringIrOutput,
  ChallengeIntentOutput,
  CompilationResultOutput,
} from "@agora/common";
import type { AuthoringArtifactOutput } from "@agora/common";
import type { AgoraDbClient } from "../index";

type AuthoringDraftStateCounts = Record<AuthoringDraftState, number>;

export class AuthoringDraftWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthoringDraftWriteConflictError";
  }
}

const AUTHORING_DRAFT_STATE_VALUES: AuthoringDraftState[] = [
  "draft",
  "compiling",
  "ready",
  "needs_clarification",
  "needs_review",
  "published",
  "failed",
];

export interface AuthoringDraftInsert {
  poster_address?: string | null;
  state: AuthoringDraftState;
  intent_json?: ChallengeIntentOutput | null;
  authoring_ir_json?: ChallengeAuthoringIrOutput | null;
  uploaded_artifacts_json?: AuthoringArtifactOutput[];
  compilation_json?: CompilationResultOutput | null;
  failure_message?: string | null;
  expires_at: string;
}

export interface AuthoringDraftRow {
  id: string;
  poster_address: string | null;
  state: AuthoringDraftState;
  intent_json: ChallengeIntentOutput | null;
  authoring_ir_json: ChallengeAuthoringIrOutput | null;
  uploaded_artifacts_json: AuthoringArtifactOutput[];
  compilation_json: CompilationResultOutput | null;
  failure_message: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface AuthoringDraftHealthSnapshot {
  counts: AuthoringDraftStateCounts;
  expired: number;
  staleCompiling: number;
  oldestNeedsReviewAt: string | null;
  oldestNeedsReviewAgeMs: number | null;
}

function createEmptyAuthoringDraftStateCounts(): AuthoringDraftStateCounts {
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

function normalizeDraftAddress(address?: string | null) {
  if (!address) {
    return null;
  }
  return address.toLowerCase();
}

async function readAuthoringDraftCount(
  db: AgoraDbClient,
  // biome-ignore lint/suspicious/noExplicitAny: Supabase query builders are too dynamic to model cleanly in this shared helper.
  mutate: (query: any) => any,
) {
  const query = mutate(
    db.from("authoring_drafts").select("id", {
      count: "exact",
      head: true,
    }),
  );
  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed to count authoring drafts: ${error.message}`);
  }
  return count ?? 0;
}

export async function createAuthoringDraft(
  db: AgoraDbClient,
  payload: AuthoringDraftInsert,
): Promise<AuthoringDraftRow> {
  const { data, error } = await db
    .from("authoring_drafts")
    .insert({
      poster_address: normalizeDraftAddress(payload.poster_address),
      state: payload.state,
      intent_json: payload.intent_json ?? null,
      authoring_ir_json: payload.authoring_ir_json ?? null,
      uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
      compilation_json: payload.compilation_json ?? null,
      failure_message: payload.failure_message ?? null,
      expires_at: payload.expires_at,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create authoring draft: ${error.message}`);
  }

  return data as AuthoringDraftRow;
}

export async function getAuthoringDraftById(
  db: AgoraDbClient,
  id: string,
): Promise<AuthoringDraftRow | null> {
  const { data, error } = await db
    .from("authoring_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read authoring draft: ${error.message}`);
  }

  return (data as AuthoringDraftRow | null) ?? null;
}

export async function updateAuthoringDraft(
  db: AgoraDbClient,
  input: {
    id: string;
    expected_updated_at?: string;
    poster_address?: string | null;
    state?: AuthoringDraftState;
    intent_json?: ChallengeIntentOutput | null;
    authoring_ir_json?: ChallengeAuthoringIrOutput | null;
    uploaded_artifacts_json?: AuthoringArtifactOutput[];
    compilation_json?: CompilationResultOutput | null;
    failure_message?: string | null;
    expires_at?: string;
  },
): Promise<AuthoringDraftRow> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.poster_address !== undefined) {
    patch.poster_address = normalizeDraftAddress(input.poster_address);
  }
  if (input.state !== undefined) {
    patch.state = input.state;
  }
  if (input.intent_json !== undefined) {
    patch.intent_json = input.intent_json;
  }
  if (input.authoring_ir_json !== undefined) {
    patch.authoring_ir_json = input.authoring_ir_json;
  }
  if (input.uploaded_artifacts_json !== undefined) {
    patch.uploaded_artifacts_json = input.uploaded_artifacts_json;
  }
  if (input.compilation_json !== undefined) {
    patch.compilation_json = input.compilation_json;
  }
  if (input.failure_message !== undefined) {
    patch.failure_message = input.failure_message;
  }
  if (input.expires_at !== undefined) {
    patch.expires_at = input.expires_at;
  }

  let query = db.from("authoring_drafts").update(patch).eq("id", input.id);
  if (input.expected_updated_at !== undefined) {
    query = query.eq("updated_at", input.expected_updated_at);
  }

  const selection = query.select("*");
  const { data, error } =
    input.expected_updated_at !== undefined
      ? await selection.maybeSingle()
      : await selection.single();

  if (error) {
    throw new Error(`Failed to update authoring draft: ${error.message}`);
  }
  if (!data) {
    throw new AuthoringDraftWriteConflictError(
      `Authoring draft ${input.id} changed before the update could be applied. Next step: reload the latest draft state and retry.`,
    );
  }

  return data as AuthoringDraftRow;
}

export async function listAuthoringDraftsByState(
  db: AgoraDbClient,
  input: {
    states: AuthoringDraftState[];
    limit?: number;
    includeExpired?: boolean;
    nowIso?: string;
  },
): Promise<AuthoringDraftRow[]> {
  let query = db.from("authoring_drafts").select("*").in("state", input.states);

  if (!input.includeExpired) {
    query = query.gt("expires_at", input.nowIso ?? new Date().toISOString());
  }

  const { data, error } = await query
    .order("updated_at", { ascending: true })
    .limit(input.limit ?? 25);

  if (error) {
    throw new Error(`Failed to list authoring drafts: ${error.message}`);
  }

  return (data as AuthoringDraftRow[] | null) ?? [];
}

export async function purgeExpiredAuthoringDrafts(
  db: AgoraDbClient,
  nowIso = new Date().toISOString(),
) {
  const { data, error } = await db
    .from("authoring_drafts")
    .delete()
    .lte("expires_at", nowIso)
    .select("state");

  if (error) {
    throw new Error(
      `Failed to purge expired authoring drafts: ${error.message}`,
    );
  }

  const deletedStateCounts = createEmptyAuthoringDraftStateCounts();
  for (const row of (data as Array<{ state: AuthoringDraftState }> | null) ??
    []) {
    deletedStateCounts[row.state] += 1;
  }

  return {
    checked_at: nowIso,
    deleted_count:
      (data as Array<{ state: AuthoringDraftState }> | null)?.length ?? 0,
    deleted_state_counts: deletedStateCounts,
  };
}

export async function readAuthoringDraftHealthSnapshot(
  db: AgoraDbClient,
  input?: {
    nowIso?: string;
    staleCompilingAfterMs?: number;
  },
): Promise<AuthoringDraftHealthSnapshot> {
  const nowIso = input?.nowIso ?? new Date().toISOString();
  const staleCompilingAfterMs = input?.staleCompilingAfterMs ?? 5 * 60 * 1000;
  const staleCompilingBeforeIso = new Date(
    new Date(nowIso).getTime() - staleCompilingAfterMs,
  ).toISOString();

  const countPromises = AUTHORING_DRAFT_STATE_VALUES.map(async (state) => {
    const count = await readAuthoringDraftCount(db, (query) =>
      query.eq("state", state).gt("expires_at", nowIso),
    );
    return [state, count] as const;
  });

  const expiredPromise = readAuthoringDraftCount(db, (query) =>
    query.lte("expires_at", nowIso),
  );
  const staleCompilingPromise = readAuthoringDraftCount(db, (query) =>
    query
      .eq("state", "compiling")
      .gt("expires_at", nowIso)
      .lte("updated_at", staleCompilingBeforeIso),
  );
  const oldestNeedsReviewPromise = db
    .from("authoring_drafts")
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
      `Failed to read authoring draft review queue health: ${oldestNeedsReviewResult.error.message}`,
    );
  }

  const counts = createEmptyAuthoringDraftStateCounts();
  for (const [state, count] of countsByState) {
    counts[state] = count;
  }

  const oldestNeedsReviewAt =
    (oldestNeedsReviewResult.data as { updated_at?: string } | null)
      ?.updated_at ?? null;
  const oldestNeedsReviewAgeMs = oldestNeedsReviewAt
    ? Math.max(
        0,
        new Date(nowIso).getTime() - new Date(oldestNeedsReviewAt).getTime(),
      )
    : null;

  return {
    counts,
    expired,
    staleCompiling,
    oldestNeedsReviewAt,
    oldestNeedsReviewAgeMs,
  };
}
