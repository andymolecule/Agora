import {
  consumeAuthoringSponsorBudgetReservation,
  createSupabaseClient,
  listPublishedChallengeLinksByDraftIds,
  releaseAuthoringSponsorBudgetReservation,
} from "../packages/db/dist/index.js";

const staleMinutesArg = process.argv.find((arg) =>
  arg.startsWith("--stale-minutes="),
);
const apply = process.argv.includes("--apply");
const releaseUnlinked = process.argv.includes("--release-unlinked");

const staleMinutes = Number(staleMinutesArg?.split("=")[1] ?? "30");
if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
  throw new Error(
    "stale-minutes must be a positive number. Next step: pass --stale-minutes=<minutes> and retry.",
  );
}

const db = createSupabaseClient(true);
const cutoffIso = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

const { data: reservations, error: reservationsError } = await db
  .from("authoring_sponsor_budget_reservations")
  .select("*")
  .eq("status", "reserved")
  .lt("updated_at", cutoffIso)
  .order("updated_at", { ascending: true });

if (reservationsError) {
  if (
    /authoring_sponsor_budget_reservations/i.test(reservationsError.message) &&
    /schema cache/i.test(reservationsError.message)
  ) {
    throw new Error(
      "Failed to read authoring_sponsor_budget_reservations because the table is missing from the PostgREST schema cache. Next step: apply migration 028_add_authoring_sponsor_budget_reservations.sql, reload the PostgREST schema cache, and retry.",
    );
  }
  throw new Error(
    `Failed to read reserved authoring sponsor budget reservations. Next step: inspect database connectivity and the authoring_sponsor_budget_reservations projection. ${reservationsError.message}`,
  );
}

const rows = reservations ?? [];
const draftIds = rows
  .map((row) => row.draft_id)
  .filter((value) => typeof value === "string" && value.length > 0);
const publishedLinks = await listPublishedChallengeLinksByDraftIds(db, draftIds);
const publishedLinksByDraftId = new Map(
  publishedLinks.map((row) => [row.draft_id, row]),
);

const { data: drafts, error: draftsError } = draftIds.length
  ? await db
      .from("authoring_drafts")
      .select("id,state,updated_at")
      .in("id", draftIds)
  : { data: [], error: null };

if (draftsError) {
  throw new Error(
    `Failed to read authoring drafts for reconciliation. Next step: inspect database connectivity and the authoring_drafts projection. ${draftsError.message}`,
  );
}

const draftsById = new Map((drafts ?? []).map((row) => [row.id, row]));
const summary = {
  staleMinutes,
  cutoffIso,
  apply,
  releaseUnlinked,
  totals: {
    reservedRows: rows.length,
    consumeCandidates: 0,
    released: 0,
    consumed: 0,
    reportedOnly: 0,
  },
  actions: [],
};

for (const reservation of rows) {
  const draftId = String(reservation.draft_id);
  const publishedLink = publishedLinksByDraftId.get(draftId) ?? null;
  const draft = draftsById.get(draftId) ?? null;

  let action = "report_only";
  let reason =
    "reservation is still reserved and needs operator inspection before release";

  if (publishedLink?.challenge_id) {
    action = "consume";
    reason =
      "published challenge link exists; reservation can be marked consumed";
    summary.totals.consumeCandidates += 1;
  } else if (releaseUnlinked && draft?.state !== "published") {
    action = "release";
    reason =
      "draft is not published and no published challenge link exists after the stale threshold";
  }

  if (apply) {
    if (action === "consume") {
      await consumeAuthoringSponsorBudgetReservation(db, {
        draft_id: draftId,
      });
      summary.totals.consumed += 1;
    } else if (action === "release") {
      await releaseAuthoringSponsorBudgetReservation(db, {
        draft_id: draftId,
        release_reason:
          "reconcile_authoring_publishes: stale reserved publish without published challenge link",
      });
      summary.totals.released += 1;
    } else {
      summary.totals.reportedOnly += 1;
    }
  } else {
    summary.totals.reportedOnly += 1;
  }

  summary.actions.push({
    draftId,
    provider: reservation.provider,
    amountUsdc: reservation.amount_usdc,
    reservedAt: reservation.reserved_at,
    updatedAt: reservation.updated_at,
    draftState: draft?.state ?? null,
    publishedChallengeId: publishedLink?.challenge_id ?? null,
    publishedSpecCid: publishedLink?.published_spec_cid ?? null,
    action,
    reason,
  });
}

console.log(JSON.stringify(summary, null, 2));
