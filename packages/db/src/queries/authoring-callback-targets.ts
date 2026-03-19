import type { AgoraDbClient } from "../index";

export interface AuthoringCallbackTargetInsert {
  draft_id: string;
  callback_url: string;
  registered_at?: string;
}

export interface AuthoringCallbackTargetRow {
  draft_id: string;
  callback_url: string;
  registered_at: string;
  created_at: string;
  updated_at: string;
}

export async function getAuthoringCallbackTargetByDraftId(
  db: AgoraDbClient,
  draftId: string,
): Promise<AuthoringCallbackTargetRow | null> {
  const { data, error } = await db
    .from("authoring_callback_targets")
    .select("*")
    .eq("draft_id", draftId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to read authoring callback target: ${error.message}`,
    );
  }

  return (data as AuthoringCallbackTargetRow | null) ?? null;
}

export async function listAuthoringCallbackTargetsByDraftIds(
  db: AgoraDbClient,
  draftIds: string[],
): Promise<AuthoringCallbackTargetRow[]> {
  if (draftIds.length === 0) {
    return [];
  }

  const { data, error } = await db
    .from("authoring_callback_targets")
    .select("*")
    .in("draft_id", draftIds);

  if (error) {
    throw new Error(
      `Failed to list authoring callback targets: ${error.message}`,
    );
  }

  return (data as AuthoringCallbackTargetRow[] | null) ?? [];
}

export async function upsertAuthoringCallbackTarget(
  db: AgoraDbClient,
  payload: AuthoringCallbackTargetInsert,
): Promise<AuthoringCallbackTargetRow> {
  const registeredAt = payload.registered_at ?? new Date().toISOString();
  const { data, error } = await db
    .from("authoring_callback_targets")
    .upsert(
      {
        draft_id: payload.draft_id,
        callback_url: payload.callback_url,
        registered_at: registeredAt,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "draft_id",
      },
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Failed to upsert authoring callback target: ${error.message}`,
    );
  }

  return data as AuthoringCallbackTargetRow;
}
