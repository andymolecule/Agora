import type {
  ConfirmationContractOutput,
  PostingSessionOutput,
  PostingSessionState,
} from "@agora/common";
import type { ChallengeSpecOutput } from "@agora/common";
import type { AgoraDbClient } from "../index";
import {
  type AuthoringDraftRow,
  getAuthoringDraftById,
  listAuthoringDraftsByState,
} from "./authoring-drafts.js";
import {
  getPublishedChallengeLinkByDraftId,
  listPublishedChallengeLinksByDraftIds,
} from "./published-challenge-links.js";

type ClarificationQuestionList =
  PostingSessionOutput["clarification_questions"];
type PostingReviewSummary = NonNullable<PostingSessionOutput["review_summary"]>;

export interface AuthoringDraftViewRow extends AuthoringDraftRow {
  clarification_questions_json: ClarificationQuestionList;
  review_summary_json: PostingReviewSummary | null;
  approved_confirmation_json: ConfirmationContractOutput | null;
  published_spec_json: ChallengeSpecOutput | null;
  published_spec_cid: string | null;
}

function mergeAuthoringDraftView(
  draft: AuthoringDraftRow,
  published?: {
    published_spec_json: ChallengeSpecOutput;
    published_spec_cid: string;
  } | null,
): AuthoringDraftViewRow {
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

export async function getAuthoringDraftViewById(
  db: AgoraDbClient,
  id: string,
): Promise<AuthoringDraftViewRow | null> {
  const draft = await getAuthoringDraftById(db, id);
  if (!draft) {
    return null;
  }
  const published = await getPublishedChallengeLinkByDraftId(db, id);
  return mergeAuthoringDraftView(draft, published);
}

export async function listAuthoringDraftViewsByState(
  db: AgoraDbClient,
  input: {
    states: PostingSessionState[];
    limit?: number;
    includeExpired?: boolean;
    nowIso?: string;
  },
): Promise<AuthoringDraftViewRow[]> {
  const drafts = await listAuthoringDraftsByState(db, input);
  const publishedLinks = await listPublishedChallengeLinksByDraftIds(
    db,
    drafts.map((draft) => draft.id),
  );
  const publishedByDraftId = new Map(
    publishedLinks.map((link) => [link.draft_id, link] as const),
  );

  return drafts.map((draft) =>
    mergeAuthoringDraftView(draft, publishedByDraftId.get(draft.id) ?? null),
  );
}
