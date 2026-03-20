import type { AgoraDbClient } from "../index";

export interface AuthoringSponsorBudgetReservationRow {
  id: string;
  draft_id: string;
  provider: string;
  period_start: string;
  period_end: string;
  amount_usdc: number;
  status: "reserved" | "consumed" | "released";
  tx_hash: string | null;
  challenge_id: string | null;
  reserved_at: string;
  released_at: string | null;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeReservationRow(
  row: Record<string, unknown> | null,
): AuthoringSponsorBudgetReservationRow | null {
  if (!row) {
    return null;
  }
  return row as unknown as AuthoringSponsorBudgetReservationRow;
}

export async function reserveAuthoringSponsorBudget(
  db: AgoraDbClient,
  input: {
    draftId: string;
    provider: string;
    periodStart: string;
    periodEnd: string;
    amountUsdc: number;
    budgetLimitUsdc: number;
  },
) {
  const { data, error } = await db.rpc("reserve_authoring_sponsor_budget", {
    p_draft_id: input.draftId,
    p_provider: input.provider,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_amount_usdc: input.amountUsdc,
    p_budget_limit_usdc: input.budgetLimitUsdc,
  });

  if (error) {
    if (
      error.message.includes("reserve_authoring_sponsor_budget") ||
      error.message.includes("authoring_sponsor_budget_reservations")
    ) {
      throw new Error(
        "Failed to reserve authoring sponsor budget: runtime schema is missing authoring sponsor budget reservations. Next step: apply migration 028_add_authoring_sponsor_budget_reservations.sql, reload the PostgREST schema cache, and retry.",
      );
    }
    throw new Error(
      `Failed to reserve authoring sponsor budget: ${error.message}`,
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  return normalizeReservationRow((row as Record<string, unknown> | null) ?? null);
}

export async function attachAuthoringSponsorBudgetReservationTx(
  db: AgoraDbClient,
  input: {
    draftId: string;
    txHash: string;
  },
) {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("authoring_sponsor_budget_reservations")
    .update({
      tx_hash: input.txHash,
      updated_at: nowIso,
    })
    .eq("draft_id", input.draftId)
    .eq("status", "reserved")
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.message.includes("authoring_sponsor_budget_reservations")) {
      throw new Error(
        "Failed to attach authoring sponsor budget reservation tx hash: runtime schema is missing authoring sponsor budget reservations. Next step: apply migration 028_add_authoring_sponsor_budget_reservations.sql, reload the PostgREST schema cache, and retry.",
      );
    }
    throw new Error(
      `Failed to attach authoring sponsor budget reservation tx hash: ${error.message}`,
    );
  }

  return normalizeReservationRow((data as Record<string, unknown> | null) ?? null);
}

export async function consumeAuthoringSponsorBudgetReservation(
  db: AgoraDbClient,
  input: {
    draftId: string;
    challengeId: string;
    txHash?: string | null;
  },
) {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("authoring_sponsor_budget_reservations")
    .update({
      status: "consumed",
      challenge_id: input.challengeId,
      ...(input.txHash ? { tx_hash: input.txHash } : {}),
      consumed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("draft_id", input.draftId)
    .eq("status", "reserved")
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.message.includes("authoring_sponsor_budget_reservations")) {
      throw new Error(
        "Failed to consume authoring sponsor budget reservation: runtime schema is missing authoring sponsor budget reservations. Next step: apply migration 028_add_authoring_sponsor_budget_reservations.sql, reload the PostgREST schema cache, and retry.",
      );
    }
    throw new Error(
      `Failed to consume authoring sponsor budget reservation: ${error.message}`,
    );
  }

  return normalizeReservationRow((data as Record<string, unknown> | null) ?? null);
}

export async function releaseAuthoringSponsorBudgetReservation(
  db: AgoraDbClient,
  input: {
    draftId: string;
  },
) {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("authoring_sponsor_budget_reservations")
    .update({
      status: "released",
      released_at: nowIso,
      updated_at: nowIso,
    })
    .eq("draft_id", input.draftId)
    .eq("status", "reserved")
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.message.includes("authoring_sponsor_budget_reservations")) {
      throw new Error(
        "Failed to release authoring sponsor budget reservation: runtime schema is missing authoring sponsor budget reservations. Next step: apply migration 028_add_authoring_sponsor_budget_reservations.sql, reload the PostgREST schema cache, and retry.",
      );
    }
    throw new Error(
      `Failed to release authoring sponsor budget reservation: ${error.message}`,
    );
  }

  return normalizeReservationRow((data as Record<string, unknown> | null) ?? null);
}

export async function listStaleAuthoringSponsorBudgetReservations(
  db: AgoraDbClient,
  cutoffIso: string,
) {
  const { data, error } = await db
    .from("authoring_sponsor_budget_reservations")
    .select("*")
    .eq("status", "reserved")
    .lt("updated_at", cutoffIso)
    .order("created_at", { ascending: true });

  if (error) {
    if (error.message.includes("authoring_sponsor_budget_reservations")) {
      throw new Error(
        "Failed to list stale authoring sponsor budget reservations: runtime schema is missing authoring sponsor budget reservations. Next step: apply migration 028_add_authoring_sponsor_budget_reservations.sql, reload the PostgREST schema cache, and retry.",
      );
    }
    throw new Error(
      `Failed to list stale authoring sponsor budget reservations: ${error.message}`,
    );
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    normalizeReservationRow(row),
  ).filter((row): row is AuthoringSponsorBudgetReservationRow => Boolean(row));
}
