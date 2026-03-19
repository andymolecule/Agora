# Authoring Rollout Runbook

## Purpose

Operational guide for the recent authoring, draft-storage, Beach integration, and strict submission-intent changes.

Use this when you need to:

- apply the new Supabase migrations
- update Railway / Vercel environment variables
- cut over API, indexer, worker, and web safely
- verify Beach-authoring flows end to end

## Audience

Operators and engineers deploying Agora after the phase-1 to phase-7 authoring refactor.

## Read this after

- [Operations](operations.md)
- [Deployment](deployment.md)
- [Data and Indexing](data-and-indexing.md)
- [Authoring Callbacks](authoring-callbacks.md)
- [Challenge Authoring IR](challenge-authoring-ir.md)

## Summary

- Fresh environments: apply all migrations.
- Existing environments: the important migration window is `017` through `023`.
- `020_strict_submission_intents.sql` is destructive on old data without a matching intent. Preflight it first.
- API, indexer, and worker orchestrator should be redeployed together after env + schema changes.
- Beach integration is Agora-hosted on the backend: Beach only needs a bearer token and optional webhook endpoint.

---

## What Changed

This rollout introduced four operationally relevant changes:

1. External authoring sources and Beach import
- new partner-authenticated authoring routes
- new callback signing / retry behavior
- new partner return-origin allowlists

2. Strict submission-intent flow
- `submissions` now require `submission_intent_id`
- on-chain-first / reconcile-later scoring is no longer the intended path

3. Split draft storage
- canonical draft state now lives in `authoring_drafts`
- callback registration targets now live in `authoring_callback_targets`
- publish outcome now lives in `published_challenge_links`
- callback retry outbox lives in `authoring_callback_deliveries`

4. New operator env/config surface
- partner bearer keys
- callback secrets
- allowed return origins
- internal review token for sweep/review operations

---

## Required Migrations

Fresh environment:

- apply everything in `packages/db/supabase/migrations`

Existing environment already running Agora:

- ensure these are applied in order:
  - `017_posting_session_authoring_ir.sql`
  - `018_authoring_source_callbacks.sql`
  - `019_authoring_callback_deliveries.sql`
  - `020_strict_submission_intents.sql`
  - `021_split_authoring_drafts.sql`
  - `022_restrict_submission_intent_fk.sql`
  - `023_drop_submission_intent_match_backrefs.sql`
  - `024_move_authoring_callback_targets.sql`

### Migration Notes

`017_posting_session_authoring_ir.sql`
- adds `posting_sessions.authoring_ir_json` column
- required before `021` which reads this column during the data copy

`018_authoring_source_callbacks.sql`
- adds callback registration metadata on the legacy draft table

`019_authoring_callback_deliveries.sql`
- adds the durable callback outbox table

`020_strict_submission_intents.sql`
- adds `submissions.submission_intent_id`
- backfills from matched intents
- deletes submissions without intents
- deduplicates `submission_intents`
- makes the FK non-null

`021_split_authoring_drafts.sql`
- creates `authoring_drafts`
- creates `published_challenge_links`
- copies old draft rows forward from `posting_sessions`
- repoints `authoring_callback_deliveries.draft_id`

`022_restrict_submission_intent_fk.sql`
- changes the `submissions -> submission_intents` FK from `CASCADE` to `RESTRICT`

`023_drop_submission_intent_match_backrefs.sql`
- removes `submission_intents.matched_submission_id`
- removes `submission_intents.matched_at`
- keeps `submissions.submission_intent_id` as the only canonical link between the two tables

`024_move_authoring_callback_targets.sql`
- creates `authoring_callback_targets`
- copies callback registration metadata out of `authoring_drafts`
- drops callback registration columns from `authoring_drafts`

---

## Preflight Before `020`

Do not apply `020_strict_submission_intents.sql` blindly on a populated environment.

Run:

```sql
select count(*) from submissions where submission_intent_id is null;
```

If that count is non-zero:

- those rows will be deleted by `020`
- decide whether the environment is disposable
- if it is production-like and you care about those rows, stop and inspect before applying

Recommended extra checks:

```sql
select challenge_id, solver_address, result_hash, count(*)
from submission_intents
group by 1, 2, 3
having count(*) > 1;
```

```sql
select count(*) from submission_intents;
```

After `020`, apply [023_drop_submission_intent_match_backrefs.sql](/Users/changyuesin/Agora/packages/db/supabase/migrations/023_drop_submission_intent_match_backrefs.sql) to remove the now-redundant reverse match columns from `submission_intents`. The strict runtime model uses `submissions.submission_intent_id` as the only canonical linkage.

Interpretation:

- unmatched intents are not a blocker by themselves
- duplicate `(challenge_id, solver_address, result_hash)` rows will be deduplicated by `020`

---

## How To Apply Migrations

There is no repo-local migration wrapper script for Supabase in this repo right now.

Use one of:

1. Supabase dashboard SQL editor
2. your existing Supabase CLI workflow

Recommended order for existing environments:

1. take a DB snapshot / backup
2. apply `017`
3. apply `018`
4. apply `019`
5. run the `020` preflight query
6. apply `020`
7. apply `021`
8. apply `022`
9. apply `023`
10. apply `024`
11. reload PostgREST schema cache
12. run `pnpm schema:verify`

If your deployment path relies on Supabase-managed PostgREST metadata, reload schema visibility before restarting API/worker services.

---

## Post-Migration Validation

Run:

```bash
pnpm schema:verify
pnpm --filter @agora/db test
```

Expected database state:

- `submissions.submission_intent_id` exists and is non-null
- `authoring_drafts` exists
- `authoring_callback_targets` exists
- `published_challenge_links` exists
- `authoring_callback_deliveries` exists and points to `authoring_drafts`

Useful SQL checks:

```sql
select count(*) from authoring_drafts;
```

```sql
select count(*) from authoring_callback_targets;
```

```sql
select count(*) from published_challenge_links;
```

```sql
select count(*) from authoring_callback_deliveries;
```

```sql
select conname
from pg_constraint
where conname = 'submissions_submission_intent_id_fkey';
```

---

## Required Environment Variables

These are the important ones for the new authoring flow.

### Shared Core

Set consistently across the relevant services:

```bash
AGORA_SUPABASE_URL=
AGORA_SUPABASE_ANON_KEY=
AGORA_SUPABASE_SERVICE_KEY=
AGORA_PINATA_JWT=
AGORA_API_URL=
AGORA_FACTORY_ADDRESS=
AGORA_USDC_ADDRESS=
AGORA_CHAIN_ID=
AGORA_RPC_URL=
AGORA_RUNTIME_VERSION=
```

### New Authoring / Beach / Review Vars

```bash
AGORA_POSTING_REVIEW_TOKEN=
AGORA_AUTHORING_PARTNER_KEYS='beach_science:...'
AGORA_AUTHORING_PARTNER_CALLBACK_SECRETS='beach_science:...'
AGORA_AUTHORING_PARTNER_RETURN_ORIGINS='beach_science:https://beach.science'
```

Formatting rules:

- `AGORA_AUTHORING_PARTNER_KEYS`
  - comma-separated `provider:key`
- `AGORA_AUTHORING_PARTNER_CALLBACK_SECRETS`
  - comma-separated `provider:secret`
- `AGORA_AUTHORING_PARTNER_RETURN_ORIGINS`
  - comma-separated `provider:https://origin1|https://origin2`
  - HTTPS only
  - public origins only

Example:

```bash
AGORA_AUTHORING_PARTNER_KEYS='beach_science:beach-prod-bearer'
AGORA_AUTHORING_PARTNER_CALLBACK_SECRETS='beach_science:beach-prod-callback-secret'
AGORA_AUTHORING_PARTNER_RETURN_ORIGINS='beach_science:https://beach.science|https://staging.beach.science'
AGORA_POSTING_REVIEW_TOKEN='internal-review-token'
```

### Web

Set the usual web vars too:

```bash
NEXT_PUBLIC_AGORA_API_URL=
NEXT_PUBLIC_AGORA_FACTORY_ADDRESS=
NEXT_PUBLIC_AGORA_USDC_ADDRESS=
NEXT_PUBLIC_AGORA_CHAIN_ID=
NEXT_PUBLIC_AGORA_RPC_URL=
```

If the internal posting review screen is used from the web app, the matching server-side review token must also be set on the web deployment environment.

---

## Railway / Vercel Service Map

Recommended hosted layout:

- Vercel
  - `@agora/web`
- Railway
  - `@agora/api`
  - `@agora/chain` indexer
  - `@agora/api` worker orchestrator
- separate Docker-capable host/service
  - `apps/executor`

### Railway Build / Start Commands

API:

```bash
pnpm turbo build --filter=@agora/api
pnpm --filter @agora/api start
```

Indexer:

```bash
pnpm turbo build --filter=@agora/chain
pnpm --filter @agora/chain indexer
```

Worker orchestrator:

```bash
pnpm turbo build --filter=@agora/api
pnpm --filter @agora/api worker
```

### Deploy Order

1. apply DB migrations
2. reload schema cache
3. update Railway env vars
4. deploy API
5. deploy indexer
6. deploy worker orchestrator
7. deploy web
8. verify executor connectivity

Do not roll API and worker onto different runtime expectations for long. They should move together.

---

## Beach Integration Checklist

Beach does not need direct DB access.

Beach needs:

- a bearer token matching `AGORA_AUTHORING_PARTNER_KEYS`
- optionally a callback endpoint
- optionally an allowlisted return origin

Beach does not need:

- Supabase credentials
- scorer runtime access
- chain deploy access just to create drafts

### Backend Entry Points

Import Beach thread:

- `POST /api/integrations/beach/drafts/import`

Then use generic partner draft lifecycle:

- `GET /api/authoring/drafts/:id`
- `POST /api/authoring/drafts/:id/clarify`
- `POST /api/authoring/drafts/:id/compile`
- `POST /api/authoring/drafts/:id/webhook`

### Callback Sweep

The durable callback outbox still needs an operator-triggered sweep.

Endpoint:

- `POST /api/authoring/callbacks/sweep`

Header:

```bash
x-agora-review-token: ${AGORA_POSTING_REVIEW_TOKEN}
```

This can be called from cron or an internal operator job.

---

## Smoke Test Checklist

After deploy:

```bash
pnpm schema:verify
pnpm scorers:verify
curl -sS http://<api>/healthz
curl -sS http://<api>/api/worker-health
curl -sS http://<api>/api/posting/health
```

Authoring-specific checks:

1. create a direct draft in `/post`
2. compile a direct draft
3. import a Beach draft through `/api/integrations/beach/drafts/import`
4. clarify it through `/api/authoring/drafts/:id/clarify`
5. compile it through `/api/authoring/drafts/:id/compile`
6. register a webhook through `/api/authoring/drafts/:id/webhook`
7. publish a hosted draft and confirm return-to behavior
8. run callback sweep and confirm pending deliveries drain

Useful local regression command:

```bash
cd /Users/changyuesin/Agora/apps/api
node --import tsx --test \
  tests/posting-sessions-route.test.ts \
  tests/authoring-sources.test.ts \
  tests/authoring-drafts.test.ts \
  tests/integrations-beach.test.ts
```

---

## Known Operational Caveats

- `020_strict_submission_intents.sql` is destructive on unmatched submissions.
- `021_split_authoring_drafts.sql` copies forward from `posting_sessions`; it does not drop the old table itself.
- `024_move_authoring_callback_targets.sql` finishes the callback registration split by moving callback target metadata out of `authoring_drafts`.
- callback delivery is durable and signed, but still depends on the sweep endpoint being run.
- internal-operator sealed-submission privacy is still not the current runtime model; public/API privacy is the enforced boundary today.

---

## Recommended Cutover Decision

If you are deploying the latest code to an existing environment, the minimum safe cutover set is:

1. apply `017` through `024`
2. set the new authoring env vars
3. redeploy API + indexer + worker orchestrator together
4. run `pnpm schema:verify`
5. run the authoring/Beach smoke checks

If any of those fail, stop before exposing Beach or other external-host authoring traffic.
