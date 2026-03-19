import type {
  AuthoringDraftLifecycleEventOutput,
  AuthoringPartnerProviderOutput,
} from "@agora/common";
import type { AgoraDbClient } from "../index";

export type AuthoringCallbackDeliveryStatus =
  | "pending"
  | "delivering"
  | "delivered"
  | "exhausted";

export class AuthoringCallbackDeliveryWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthoringCallbackDeliveryWriteConflictError";
  }
}

export interface AuthoringCallbackDeliveryInsert {
  draft_id: string;
  provider: AuthoringPartnerProviderOutput;
  callback_url: string;
  event: AuthoringDraftLifecycleEventOutput["event"];
  payload_json: AuthoringDraftLifecycleEventOutput;
  status?: AuthoringCallbackDeliveryStatus;
  attempts?: number;
  max_attempts?: number;
  last_attempt_at?: string | null;
  next_attempt_at: string;
  delivered_at?: string | null;
  last_error?: string | null;
}

export interface AuthoringCallbackDeliveryRow {
  id: string;
  draft_id: string;
  provider: AuthoringPartnerProviderOutput;
  callback_url: string;
  event: AuthoringDraftLifecycleEventOutput["event"];
  payload_json: AuthoringDraftLifecycleEventOutput;
  status: AuthoringCallbackDeliveryStatus;
  attempts: number;
  max_attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string;
  delivered_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function createAuthoringCallbackDelivery(
  db: AgoraDbClient,
  payload: AuthoringCallbackDeliveryInsert,
): Promise<AuthoringCallbackDeliveryRow> {
  const { data, error } = await db
    .from("authoring_callback_deliveries")
    .insert({
      draft_id: payload.draft_id,
      provider: payload.provider,
      callback_url: payload.callback_url,
      event: payload.event,
      payload_json: payload.payload_json,
      status: payload.status ?? "pending",
      attempts: payload.attempts ?? 0,
      max_attempts: payload.max_attempts ?? 5,
      last_attempt_at: payload.last_attempt_at ?? null,
      next_attempt_at: payload.next_attempt_at,
      delivered_at: payload.delivered_at ?? null,
      last_error: payload.last_error ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Failed to create authoring callback delivery: ${error.message}`,
    );
  }

  return data as AuthoringCallbackDeliveryRow;
}

export async function listDueAuthoringCallbackDeliveries(
  db: AgoraDbClient,
  input?: {
    nowIso?: string;
    limit?: number;
    statuses?: AuthoringCallbackDeliveryStatus[];
  },
): Promise<AuthoringCallbackDeliveryRow[]> {
  const query = db
    .from("authoring_callback_deliveries")
    .select("*")
    .in("status", input?.statuses ?? ["pending"])
    .lte("next_attempt_at", input?.nowIso ?? new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(input?.limit ?? 25);

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Failed to list due authoring callback deliveries: ${error.message}`,
    );
  }

  return (data as AuthoringCallbackDeliveryRow[] | null) ?? [];
}

export async function updateAuthoringCallbackDelivery(
  db: AgoraDbClient,
  input: {
    id: string;
    expected_updated_at?: string;
    status?: AuthoringCallbackDeliveryStatus;
    attempts?: number;
    max_attempts?: number;
    last_attempt_at?: string | null;
    next_attempt_at?: string;
    delivered_at?: string | null;
    last_error?: string | null;
  },
): Promise<AuthoringCallbackDeliveryRow> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (input.attempts !== undefined) {
    patch.attempts = input.attempts;
  }
  if (input.max_attempts !== undefined) {
    patch.max_attempts = input.max_attempts;
  }
  if (input.last_attempt_at !== undefined) {
    patch.last_attempt_at = input.last_attempt_at;
  }
  if (input.next_attempt_at !== undefined) {
    patch.next_attempt_at = input.next_attempt_at;
  }
  if (input.delivered_at !== undefined) {
    patch.delivered_at = input.delivered_at;
  }
  if (input.last_error !== undefined) {
    patch.last_error = input.last_error;
  }

  let query = db
    .from("authoring_callback_deliveries")
    .update(patch)
    .eq("id", input.id);
  if (input.expected_updated_at !== undefined) {
    query = query.eq("updated_at", input.expected_updated_at);
  }

  const selection = query.select("*");
  const { data, error } =
    input.expected_updated_at !== undefined
      ? await selection.maybeSingle()
      : await selection.single();

  if (error) {
    throw new Error(
      `Failed to update authoring callback delivery: ${error.message}`,
    );
  }
  if (!data) {
    throw new AuthoringCallbackDeliveryWriteConflictError(
      `Authoring callback delivery ${input.id} changed before the update could be applied. Next step: reload due deliveries and retry the sweep.`,
    );
  }

  return data as AuthoringCallbackDeliveryRow;
}
