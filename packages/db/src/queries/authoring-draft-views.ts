import type { PostingSessionState as AuthoringDraftState } from "@agora/common";
import type { ChallengeSpecOutput } from "@agora/common";
import type { AgoraDbClient } from "../index";
import {
  getAuthoringCallbackTargetByDraftId,
  listAuthoringCallbackTargetsByDraftIds,
} from "./authoring-callback-targets.js";
import {
  type AuthoringDraftRow,
  getAuthoringDraftById,
  listAuthoringDraftsByState,
} from "./authoring-drafts.js";
import {
  getPublishedChallengeLinkByDraftId,
  listPublishedChallengeLinksByDraftIds,
} from "./published-challenge-links.js";

export interface AuthoringDraftViewRow extends AuthoringDraftRow {
  source_callback_url: string | null;
  source_callback_registered_at: string | null;
  published_spec_json: ChallengeSpecOutput | null;
  published_spec_cid: string | null;
}

function mergeAuthoringDraftView(
  draft: AuthoringDraftRow,
  callbackTarget?: {
    callback_url: string;
    registered_at: string;
  } | null,
  published?: {
    published_spec_json: ChallengeSpecOutput;
    published_spec_cid: string;
  } | null,
): AuthoringDraftViewRow {
  return {
    ...draft,
    source_callback_url: callbackTarget?.callback_url ?? null,
    source_callback_registered_at: callbackTarget?.registered_at ?? null,
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
  const callbackTarget = await getAuthoringCallbackTargetByDraftId(db, id);
  const published = await getPublishedChallengeLinkByDraftId(db, id);
  return mergeAuthoringDraftView(draft, callbackTarget, published);
}

export async function listAuthoringDraftViewsByState(
  db: AgoraDbClient,
  input: {
    states: AuthoringDraftState[];
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
  const callbackTargets = await listAuthoringCallbackTargetsByDraftIds(
    db,
    drafts.map((draft) => draft.id),
  );
  const callbackTargetsByDraftId = new Map(
    callbackTargets.map((target) => [target.draft_id, target] as const),
  );
  const publishedByDraftId = new Map(
    publishedLinks.map((link) => [link.draft_id, link] as const),
  );

  return drafts.map((draft) =>
    mergeAuthoringDraftView(
      draft,
      callbackTargetsByDraftId.get(draft.id) ?? null,
      publishedByDraftId.get(draft.id) ?? null,
    ),
  );
}
