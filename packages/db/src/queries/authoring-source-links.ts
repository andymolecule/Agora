import type { AgoraDbClient } from "../index";

export interface AuthoringSourceLinkInsert {
  provider: string;
  external_id: string;
  draft_id: string;
  external_url?: string | null;
}

export interface AuthoringSourceLinkRow {
  provider: string;
  external_id: string;
  draft_id: string;
  external_url: string | null;
  created_at: string;
  updated_at: string;
}

export async function getAuthoringSourceLink(
  db: AgoraDbClient,
  input: {
    provider: string;
    external_id: string;
  },
): Promise<AuthoringSourceLinkRow | null> {
  const { data, error } = await db
    .from("authoring_source_links")
    .select("*")
    .eq("provider", input.provider)
    .eq("external_id", input.external_id)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read authoring source link: ${error.message}`);
  }

  return (data as AuthoringSourceLinkRow | null) ?? null;
}

export async function upsertAuthoringSourceLink(
  db: AgoraDbClient,
  payload: AuthoringSourceLinkInsert,
): Promise<AuthoringSourceLinkRow> {
  const { data, error } = await db
    .from("authoring_source_links")
    .upsert(
      {
        provider: payload.provider,
        external_id: payload.external_id,
        draft_id: payload.draft_id,
        external_url: payload.external_url ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,external_id" },
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to upsert authoring source link: ${error.message}`);
  }

  return data as AuthoringSourceLinkRow;
}
