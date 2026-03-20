import type { AuthoringPartnerProviderOutput } from "@agora/common";
import type { AgoraDbClient } from "../index";

export type AuthoringSponsorBudgetReservationStatus =
  | "reserved"
  | "consumed"
  | "released";

export interface AuthoringSponsorBudgetReservationRow {
  draft_id: string;
  provider: AuthoringPartnerProviderOutput;
  period_start: string;
  amount_usdc: number;
  status: AuthoringSponsorBudgetReservationStatus;
  reserved_at: string;
  consumed_at: string | null;
  released_at: string | null;
  release_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthoringSponsorBudgetReservationResult {
  reserved: boolean;
  totalAllocatedUsdc: number;
}

function normalizeAmount(value: unknown, fieldName: string) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) {
    throw new Error(
      `Authoring sponsor budget reservation returned an invalid ${fieldName}. Next step: inspect the reservation RPC payload and retry.`,
    );
  }
  return amount;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toAuthoringSponsorBudgetReservationRow(
  row: Record<string, unknown>,
): AuthoringSponsorBudgetReservationRow {
  return {
    draft_id: String(row.draft_id),
    provider: row.provider as AuthoringPartnerProviderOutput,
    period_start: String(row.period_start),
    amount_usdc: normalizeAmount(row.amount_usdc, "amount_usdc"),
    status: row.status as AuthoringSponsorBudgetReservationStatus,
    reserved_at: String(row.reserved_at),
    consumed_at: normalizeOptionalString(row.consumed_at),
    released_at: normalizeOptionalString(row.released_at),
    release_reason: normalizeOptionalString(row.release_reason),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function reserveAuthoringSponsorBudget(
  db: AgoraDbClient,
  input: {
    draft_id: string;
    provider: AuthoringPartnerProviderOutput;
    period_start: string;
    amount_usdc: number;
    budget_usdc: number;
  },
): Promise<AuthoringSponsorBudgetReservationResult> {
  const { data, error } = await db.rpc("reserve_authoring_sponsor_budget", {
    p_draft_id: input.draft_id,
    p_provider: input.provider,
    p_period_start: input.period_start,
    p_amount_usdc: input.amount_usdc,
    p_budget_usdc: input.budget_usdc,
  });

  if (error) {
    throw new Error(
      `Failed to reserve authoring sponsor budget: ${error.message}`,
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error(
      "Failed to reserve authoring sponsor budget: the database did not return a reservation result.",
    );
  }

  return {
    reserved: Boolean(row.reserved),
    totalAllocatedUsdc: normalizeAmount(
      row.total_allocated_usdc,
      "total_allocated_usdc",
    ),
  };
}

export async function consumeAuthoringSponsorBudgetReservation(
  db: AgoraDbClient,
  input: {
    draft_id: string;
    consumed_at?: string;
  },
): Promise<AuthoringSponsorBudgetReservationRow> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("authoring_sponsor_budget_reservations")
    .update({
      status: "consumed",
      consumed_at: input.consumed_at ?? nowIso,
      released_at: null,
      release_reason: null,
      updated_at: nowIso,
    })
    .eq("draft_id", input.draft_id)
    .in("status", ["reserved", "consumed"])
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to consume authoring sponsor budget reservation: ${error.message}`,
    );
  }
  if (!data) {
    throw new Error(
      `Authoring sponsor budget reservation ${input.draft_id} was not found. Next step: inspect the reservation lifecycle and retry.`,
    );
  }

  return toAuthoringSponsorBudgetReservationRow(
    data as Record<string, unknown>,
  );
}

export async function releaseAuthoringSponsorBudgetReservation(
  db: AgoraDbClient,
  input: {
    draft_id: string;
    release_reason: string;
    released_at?: string;
  },
): Promise<AuthoringSponsorBudgetReservationRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("authoring_sponsor_budget_reservations")
    .update({
      status: "released",
      released_at: input.released_at ?? nowIso,
      release_reason: input.release_reason,
      updated_at: nowIso,
    })
    .eq("draft_id", input.draft_id)
    .eq("status", "reserved")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to release authoring sponsor budget reservation: ${error.message}`,
    );
  }

  return data
    ? toAuthoringSponsorBudgetReservationRow(data as Record<string, unknown>)
    : null;
}
