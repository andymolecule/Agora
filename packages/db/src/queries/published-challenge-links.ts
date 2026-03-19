import type { ChallengeSpecOutput } from "@agora/common";
import type { AgoraDbClient } from "../index";

export interface PublishedChallengeLinkInsert {
  draft_id: string;
  challenge_id?: string | null;
  published_spec_json: ChallengeSpecOutput;
  published_spec_cid: string;
  return_to?: string | null;
  published_at?: string;
}

export interface PublishedChallengeLinkRow {
  draft_id: string;
  challenge_id: string | null;
  published_spec_json: ChallengeSpecOutput;
  published_spec_cid: string;
  return_to: string | null;
  published_at: string;
  created_at: string;
  updated_at: string;
}

export async function getPublishedChallengeLinkByDraftId(
  db: AgoraDbClient,
  draftId: string,
): Promise<PublishedChallengeLinkRow | null> {
  const { data, error } = await db
    .from("published_challenge_links")
    .select("*")
    .eq("draft_id", draftId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to read published challenge link: ${error.message}`,
    );
  }

  return (data as PublishedChallengeLinkRow | null) ?? null;
}

export async function getPublishedChallengeLinkByChallengeId(
  db: AgoraDbClient,
  challengeId: string,
): Promise<PublishedChallengeLinkRow | null> {
  const { data, error } = await db
    .from("published_challenge_links")
    .select("*")
    .eq("challenge_id", challengeId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to read published challenge link by challenge id: ${error.message}`,
    );
  }

  return (data as PublishedChallengeLinkRow | null) ?? null;
}

export async function listPublishedChallengeLinksByDraftIds(
  db: AgoraDbClient,
  draftIds: string[],
): Promise<PublishedChallengeLinkRow[]> {
  if (draftIds.length === 0) {
    return [];
  }

  const { data, error } = await db
    .from("published_challenge_links")
    .select("*")
    .in("draft_id", draftIds);

  if (error) {
    throw new Error(
      `Failed to list published challenge links: ${error.message}`,
    );
  }

  return (data as PublishedChallengeLinkRow[] | null) ?? [];
}

export async function upsertPublishedChallengeLink(
  db: AgoraDbClient,
  payload: PublishedChallengeLinkInsert,
): Promise<PublishedChallengeLinkRow> {
  const publishedAt = payload.published_at ?? new Date().toISOString();
  const { data, error } = await db
    .from("published_challenge_links")
    .upsert(
      {
        draft_id: payload.draft_id,
        challenge_id: payload.challenge_id ?? null,
        published_spec_json: payload.published_spec_json,
        published_spec_cid: payload.published_spec_cid,
        return_to: payload.return_to ?? null,
        published_at: publishedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "draft_id" },
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Failed to upsert published challenge link: ${error.message}`,
    );
  }

  return data as PublishedChallengeLinkRow;
}
