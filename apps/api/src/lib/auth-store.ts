import { createHash, randomBytes } from "node:crypto";
import { PIN_SPEC_AUTH_MAX_AGE_MS } from "@agora/common";
import {
  type AuthNoncePurpose,
  consumeAuthNonce,
  createAuthAgent,
  createAuthNonce,
  createAuthSession,
  createSupabaseClient,
  getAuthAgentByApiKeyHash,
  getAuthAgentByTelegramBotId,
  getAuthSession,
  purgeExpiredAuthNonces,
  purgeExpiredAuthSessions,
  rotateAuthAgentApiKey,
  revokeAuthSession,
} from "@agora/db";

interface SessionRecord {
  address: `0x${string}`;
  expiresAt: number;
}

export interface AgentRecord {
  agentId: string;
  telegramBotId: string;
  agentName: string | null;
  description: string | null;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SIWE_NONCE_TTL_MS = 10 * 60 * 1000;
const AUTH_GC_INTERVAL_MS = 15 * 60 * 1000;
const AGENT_API_KEY_PREFIX = "agora_";
let lastAuthGcAt = 0;

function getDb() {
  return createSupabaseClient(true);
}

function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createAgentApiKey() {
  return `${AGENT_API_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
}

export function readBearerToken(authHeader: string | undefined) {
  if (!authHeader) {
    return undefined;
  }

  const [scheme, value] = authHeader.trim().split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== "bearer") {
    return undefined;
  }

  const token = value?.trim();
  return token && token.length > 0 ? token : undefined;
}

async function maybeGcAuthState() {
  if (Date.now() - lastAuthGcAt < AUTH_GC_INTERVAL_MS) {
    return;
  }
  lastAuthGcAt = Date.now();
  try {
    const db = getDb();
    await Promise.all([
      purgeExpiredAuthNonces(db),
      purgeExpiredAuthSessions(db),
    ]);
  } catch {
    // Best-effort cleanup only. Request paths should still succeed.
  }
}

export async function createNonce(purpose: AuthNoncePurpose) {
  void maybeGcAuthState();
  const nonce = randomBytes(16).toString("hex");
  const ttlMs =
    purpose === "pin_spec" ? PIN_SPEC_AUTH_MAX_AGE_MS : SIWE_NONCE_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await createAuthNonce(getDb(), {
    nonce,
    purpose,
    expiresAt,
  });
  return nonce;
}

export async function consumeNonce(
  purpose: AuthNoncePurpose,
  nonce: string,
  address?: `0x${string}`,
) {
  const record = await consumeAuthNonce(getDb(), {
    nonce,
    purpose,
    address,
  });
  return Boolean(record);
}

export async function createSession(address: `0x${string}`) {
  void maybeGcAuthState();
  const token = randomBytes(24).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await createAuthSession(getDb(), {
    tokenHash: hashOpaqueToken(token),
    address,
    expiresAt: new Date(expiresAt).toISOString(),
  });
  return { token, expiresAt };
}

export async function getSession(
  token: string | undefined,
): Promise<SessionRecord | null> {
  void maybeGcAuthState();
  if (!token) return null;
  const session = await getAuthSession(getDb(), hashOpaqueToken(token));
  if (!session) return null;

  return {
    address: session.address.toLowerCase() as `0x${string}`,
    expiresAt: new Date(session.expires_at).getTime(),
  };
}

export async function deleteSession(token: string | undefined) {
  void maybeGcAuthState();
  if (!token) return;
  await revokeAuthSession(getDb(), hashOpaqueToken(token));
}

export async function registerAgent(input: {
  telegram_bot_id: string;
  agent_name?: string;
  description?: string;
}) {
  const db = getDb();
  const apiKey = createAgentApiKey();
  const apiKeyHash = hashOpaqueToken(apiKey);
  const existing = await getAuthAgentByTelegramBotId(db, input.telegram_bot_id);

  if (!existing) {
    const created = await createAuthAgent(db, {
      telegramBotId: input.telegram_bot_id,
      apiKeyHash,
      agentName: input.agent_name,
      description: input.description,
    });
    return {
      agent_id: created.id,
      api_key: apiKey,
      status: "created" as const,
    };
  }

  const rotated = await rotateAuthAgentApiKey(db, {
    id: existing.id,
    apiKeyHash,
    agentName: input.agent_name,
    description: input.description,
  });
  return {
    agent_id: rotated.id,
    api_key: apiKey,
    status: "rotated" as const,
  };
}

export async function getAgentFromApiKey(
  apiKey: string | undefined,
): Promise<AgentRecord | null> {
  if (!apiKey) {
    return null;
  }

  const agent = await getAuthAgentByApiKeyHash(getDb(), hashOpaqueToken(apiKey));
  if (!agent) {
    return null;
  }

  return {
    agentId: agent.id,
    telegramBotId: agent.telegram_bot_id,
    agentName: agent.agent_name,
    description: agent.description,
  };
}

export async function getAgentFromAuthorizationHeader(
  authHeader: string | undefined,
) {
  return getAgentFromApiKey(readBearerToken(authHeader));
}
