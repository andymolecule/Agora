import type { AgoraDbClient } from "../index";

export type AuthNoncePurpose = "siwe" | "pin_spec";

export interface AuthNonceInsert {
  nonce: string;
  purpose: AuthNoncePurpose;
  address?: string | null;
  expiresAt: string;
}

export interface AuthNonceRow {
  nonce: string;
  purpose: AuthNoncePurpose;
  address: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface AuthSessionInsert {
  tokenHash: string;
  address: string;
  expiresAt: string;
}

export interface AuthSessionRow {
  token_hash: string;
  address: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface AuthAgentInsert {
  telegramBotId: string;
  apiKeyHash: string;
  agentName?: string | null;
  description?: string | null;
}

export interface AuthAgentRow {
  id: string;
  telegram_bot_id: string;
  agent_name: string | null;
  description: string | null;
  api_key_hash: string;
  last_rotated_at: string;
  created_at: string;
  updated_at: string;
}

function normalizeOptionalText(value?: string | null) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createAuthNonce(
  db: AgoraDbClient,
  input: AuthNonceInsert,
) {
  const { error } = await db.from("auth_nonces").insert({
    nonce: input.nonce,
    purpose: input.purpose,
    address: input.address?.toLowerCase() ?? null,
    expires_at: input.expiresAt,
  });

  if (error) {
    throw new Error(`Failed to persist auth nonce: ${error.message}`);
  }
}

export async function consumeAuthNonce(
  db: AgoraDbClient,
  input: {
    nonce: string;
    purpose: AuthNoncePurpose;
    address?: string | null;
  },
): Promise<AuthNonceRow | null> {
  const query = db
    .from("auth_nonces")
    .update({
      consumed_at: new Date().toISOString(),
    })
    .eq("nonce", input.nonce)
    .eq("purpose", input.purpose)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString());

  const scopedQuery =
    input.address == null
      ? query
      : query.or(`address.is.null,address.eq.${input.address.toLowerCase()}`);

  const { data, error } = await scopedQuery.select("*").maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to consume auth nonce: ${error.message}`);
  }

  return (data as AuthNonceRow | null) ?? null;
}

export async function createAuthSession(
  db: AgoraDbClient,
  input: AuthSessionInsert,
) {
  const { error } = await db.from("auth_sessions").insert({
    token_hash: input.tokenHash,
    address: input.address.toLowerCase(),
    expires_at: input.expiresAt,
  });

  if (error) {
    throw new Error(`Failed to persist auth session: ${error.message}`);
  }
}

export async function getAuthSession(
  db: AgoraDbClient,
  tokenHash: string,
): Promise<AuthSessionRow | null> {
  const { data, error } = await db
    .from("auth_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read auth session: ${error.message}`);
  }

  return (data as AuthSessionRow | null) ?? null;
}

export async function revokeAuthSession(db: AgoraDbClient, tokenHash: string) {
  const { error } = await db
    .from("auth_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .is("revoked_at", null);

  if (error) {
    throw new Error(`Failed to revoke auth session: ${error.message}`);
  }
}

export async function purgeExpiredAuthNonces(db: AgoraDbClient) {
  const now = new Date().toISOString();
  const { error } = await db
    .from("auth_nonces")
    .delete()
    .or(`expires_at.lte.${now},consumed_at.not.is.null`);

  if (error) {
    throw new Error(`Failed to purge expired auth nonces: ${error.message}`);
  }
}

export async function purgeExpiredAuthSessions(db: AgoraDbClient) {
  const now = new Date().toISOString();
  const { error } = await db
    .from("auth_sessions")
    .delete()
    .or(`expires_at.lte.${now},revoked_at.not.is.null`);

  if (error) {
    throw new Error(`Failed to purge expired auth sessions: ${error.message}`);
  }
}

export async function createAuthAgent(
  db: AgoraDbClient,
  input: AuthAgentInsert,
): Promise<AuthAgentRow> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("auth_agents")
    .insert({
      telegram_bot_id: input.telegramBotId,
      agent_name: normalizeOptionalText(input.agentName),
      description: normalizeOptionalText(input.description),
      api_key_hash: input.apiKeyHash,
      last_rotated_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create auth agent: ${error.message}`);
  }

  return data as AuthAgentRow;
}

export async function getAuthAgentByTelegramBotId(
  db: AgoraDbClient,
  telegramBotId: string,
): Promise<AuthAgentRow | null> {
  const { data, error } = await db
    .from("auth_agents")
    .select("*")
    .eq("telegram_bot_id", telegramBotId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read auth agent: ${error.message}`);
  }

  return (data as AuthAgentRow | null) ?? null;
}

export async function getAuthAgentByApiKeyHash(
  db: AgoraDbClient,
  apiKeyHash: string,
): Promise<AuthAgentRow | null> {
  const { data, error } = await db
    .from("auth_agents")
    .select("*")
    .eq("api_key_hash", apiKeyHash)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to read auth agent by API key: ${error.message}`);
  }

  return (data as AuthAgentRow | null) ?? null;
}

export async function rotateAuthAgentApiKey(
  db: AgoraDbClient,
  input: {
    id: string;
    apiKeyHash: string;
    agentName?: string | null;
    description?: string | null;
  },
): Promise<AuthAgentRow> {
  const patch: Record<string, unknown> = {
    api_key_hash: input.apiKeyHash,
    last_rotated_at: new Date().toISOString(),
  };
  patch.updated_at = patch.last_rotated_at;

  if (input.agentName !== undefined) {
    patch.agent_name = normalizeOptionalText(input.agentName);
  }
  if (input.description !== undefined) {
    patch.description = normalizeOptionalText(input.description);
  }

  const { data, error } = await db
    .from("auth_agents")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to rotate auth agent API key: ${error.message}`);
  }

  return data as AuthAgentRow;
}
