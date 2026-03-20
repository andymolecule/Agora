import {
  REQUIRED_RUNTIME_SCHEMA_CHECKS,
  assertRuntimeDatabaseSchema,
  consumeAuthoringSponsorBudgetReservation,
  createSupabaseClient,
  getChallengeByTxHash,
  getPublishedChallengeLinkByDraftId,
  listStaleAuthoringSponsorBudgetReservations,
  releaseAuthoringSponsorBudgetReservation,
} from "../packages/db/dist/index.js";

const staleMinutesArg = process.argv.find((arg) =>
  arg.startsWith("--stale-minutes="),
);
const draftIdArg = process.argv.find((arg) => arg.startsWith("--draft-id="));

const staleMinutes = Number(staleMinutesArg?.split("=")[1] ?? "30");
const draftId = draftIdArg?.split("=")[1] ?? null;

if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
  throw new Error(
    "stale-minutes must be a positive number. Next step: pass --stale-minutes=<minutes> and retry.",
  );
}

const db = createSupabaseClient(true);
await assertRuntimeDatabaseSchema(
  db,
  REQUIRED_RUNTIME_SCHEMA_CHECKS.filter((check) =>
    new Set([
      "challenge_source_attribution_columns",
      "published_challenge_links_table",
      "authoring_sponsor_budget_reservations_table",
    ]).has(check.id),
  ),
);

const cutoffIso = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
const reservations = await listStaleAuthoringSponsorBudgetReservations(
  db,
  cutoffIso,
);

const rows = draftId
  ? reservations.filter((row) => row.draft_id === draftId)
  : reservations;

const consumed = [];
const released = [];
const pending = [];

for (const row of rows) {
  const publishedLink = await getPublishedChallengeLinkByDraftId(db, row.draft_id);
  if (publishedLink?.challenge_id) {
    await consumeAuthoringSponsorBudgetReservation(db, {
      draftId: row.draft_id,
      challengeId: publishedLink.challenge_id,
      txHash: row.tx_hash,
    });
    consumed.push({
      draftId: row.draft_id,
      challengeId: publishedLink.challenge_id,
      reason: "published_link",
    });
    continue;
  }

  if (row.tx_hash) {
    const challenge = await getChallengeByTxHash(db, row.tx_hash);
    if (challenge?.id) {
      await consumeAuthoringSponsorBudgetReservation(db, {
        draftId: row.draft_id,
        challengeId: challenge.id,
        txHash: row.tx_hash,
      });
      consumed.push({
        draftId: row.draft_id,
        challengeId: challenge.id,
        reason: "challenge_tx_hash",
      });
      continue;
    }

    pending.push({
      draftId: row.draft_id,
      txHash: row.tx_hash,
      reason:
        "transaction was submitted but no challenge projection exists yet; inspect indexing before releasing the reservation",
    });
    continue;
  }

  await releaseAuthoringSponsorBudgetReservation(db, {
    draftId: row.draft_id,
  });
  released.push({
    draftId: row.draft_id,
    reason: "stale_unsubmitted_publish",
  });
}

console.log(
  JSON.stringify(
    {
      staleMinutes,
      draftId,
      scanned: rows.length,
      consumed,
      released,
      pending,
    },
    null,
    2,
  ),
);
