import type {
  ChallengeAuthoringIrOutput,
  ChallengeIntentOutput,
  CompilationResultOutput,
  ConfirmationContractOutput,
  PostingSessionOutput,
  PostingSessionState,
} from "@agora/common";
import type {
  AuthoringArtifactOutput,
  ChallengeSpecOutput,
} from "@agora/common";
import type { AgoraDbClient } from "../index";
import {
  type AuthoringDraftHealthSnapshot,
  type AuthoringDraftInsert,
  type AuthoringDraftRow,
  AuthoringDraftWriteConflictError,
  createAuthoringDraft,
  getAuthoringDraftById,
  listAuthoringDraftsByState,
  purgeExpiredAuthoringDrafts,
  readAuthoringDraftHealthSnapshot,
  updateAuthoringDraft,
} from "./authoring-drafts.js";
import {
  getPublishedChallengeLinkByDraftId,
  listPublishedChallengeLinksByDraftIds,
  upsertPublishedChallengeLink,
} from "./published-challenge-links.js";

// Transitional compatibility wrapper for routes that still consume the old
// posting session shape. New storage writes should target authoring_drafts and
// published_challenge_links directly so this layer can be removed after route
// cutover.
type ClarificationQuestionList =
  PostingSessionOutput["clarification_questions"];
type PostingReviewSummary = NonNullable<PostingSessionOutput["review_summary"]>;

export class PostingSessionWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostingSessionWriteConflictError";
  }
}

export interface PostingSessionInsert extends AuthoringDraftInsert {
  published_spec_json?: ChallengeSpecOutput | null;
  published_spec_cid?: string | null;
}

export interface PostingSessionRow extends AuthoringDraftRow {
  clarification_questions_json: ClarificationQuestionList;
  review_summary_json: PostingReviewSummary | null;
  approved_confirmation_json: ConfirmationContractOutput | null;
  published_spec_json: ChallengeSpecOutput | null;
  published_spec_cid: string | null;
}

export type PostingSessionHealthSnapshot = AuthoringDraftHealthSnapshot;

function mergePostingSessionRow(
  draft: AuthoringDraftRow,
  published?: {
    published_spec_json: ChallengeSpecOutput;
    published_spec_cid: string;
  } | null,
): PostingSessionRow {
  return {
    ...draft,
    clarification_questions_json: [],
    review_summary_json: null,
    approved_confirmation_json:
      draft.compilation_json?.confirmation_contract ?? null,
    published_spec_json: published?.published_spec_json ?? null,
    published_spec_cid: published?.published_spec_cid ?? null,
  };
}

export async function createPostingSession(
  db: AgoraDbClient,
  payload: PostingSessionInsert,
): Promise<PostingSessionRow> {
  const draft = await createAuthoringDraft(db, payload);
  if (payload.published_spec_json && payload.published_spec_cid) {
    await upsertPublishedChallengeLink(db, {
      draft_id: draft.id,
      published_spec_json: payload.published_spec_json,
      published_spec_cid: payload.published_spec_cid,
    });
    return mergePostingSessionRow(draft, {
      published_spec_json: payload.published_spec_json,
      published_spec_cid: payload.published_spec_cid,
    });
  }
  return mergePostingSessionRow(draft);
}

export async function getPostingSessionById(
  db: AgoraDbClient,
  id: string,
): Promise<PostingSessionRow | null> {
  const draft = await getAuthoringDraftById(db, id);
  if (!draft) {
    return null;
  }
  const published = await getPublishedChallengeLinkByDraftId(db, id);
  return mergePostingSessionRow(draft, published);
}

export async function updatePostingSession(
  db: AgoraDbClient,
  input: {
    id: string;
    expected_updated_at?: string;
    poster_address?: string | null;
    state?: PostingSessionState;
    intent_json?: ChallengeIntentOutput | null;
    authoring_ir_json?: ChallengeAuthoringIrOutput | null;
    uploaded_artifacts_json?: AuthoringArtifactOutput[];
    compilation_json?: CompilationResultOutput | null;
    published_spec_json?: ChallengeSpecOutput | null;
    published_spec_cid?: string | null;
    source_callback_url?: string | null;
    source_callback_registered_at?: string | null;
    failure_message?: string | null;
    expires_at?: string;
  },
): Promise<PostingSessionRow> {
  let draft: AuthoringDraftRow;
  try {
    draft = await updateAuthoringDraft(db, input);
  } catch (error) {
    if (error instanceof AuthoringDraftWriteConflictError) {
      throw new PostingSessionWriteConflictError(error.message);
    }
    throw error;
  }

  let published = await getPublishedChallengeLinkByDraftId(db, input.id);
  if (input.published_spec_json !== undefined || input.published_spec_cid !== undefined) {
    if (!input.published_spec_json || !input.published_spec_cid) {
      throw new Error(
        `Published challenge link updates for draft ${input.id} require both published_spec_json and published_spec_cid. Next step: provide the complete published spec payload and retry.`,
      );
    }
    published = await upsertPublishedChallengeLink(db, {
      draft_id: input.id,
      published_spec_json: input.published_spec_json,
      published_spec_cid: input.published_spec_cid,
    });
  }

  return mergePostingSessionRow(draft, published);
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
  const drafts = await listAuthoringDraftsByState(db, input);
  const publishedLinks = await listPublishedChallengeLinksByDraftIds(
    db,
    drafts.map((draft) => draft.id),
  );
  const publishedByDraftId = new Map(
    publishedLinks.map((link) => [link.draft_id, link] as const),
  );

  return drafts.map((draft) =>
    mergePostingSessionRow(draft, publishedByDraftId.get(draft.id) ?? null),
  );
}

export async function purgeExpiredPostingSessions(
  db: AgoraDbClient,
  nowIso = new Date().toISOString(),
) {
  return purgeExpiredAuthoringDrafts(db, nowIso);
}

export async function readPostingSessionHealthSnapshot(
  db: AgoraDbClient,
  input?: {
    nowIso?: string;
    staleCompilingAfterMs?: number;
  },
): Promise<PostingSessionHealthSnapshot> {
  return readAuthoringDraftHealthSnapshot(db, input);
}
