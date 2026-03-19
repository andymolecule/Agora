# Agora System Anatomy — Bottom-Up

## Purpose

A reverse-engineered, bottom-up walkthrough of every layer in Agora: what each component does, what data it handles, and how it connects to the layers above and below it. Start at the Docker scorer and work up to the browser.

## Audience

Anyone who wants to understand exactly how Agora works end to end: engineers, auditors, partners building integrations, or operators debugging a live issue.

---

## Layer 0: The Docker Scorer (Ground Truth)

This is the lowest layer and the ultimate source of truth for scoring. Everything above exists to feed data into this container and publish the result.

### What it is

A single Python script (`containers/repro-scorer/score.py`) packaged as a Docker image. Pure Python stdlib — no numpy, no pandas, no external dependencies.

### What it receives

Three files mounted into `/input/`:

```
/input/
  agora-runtime.json          ← tells the scorer what to do
  ground_truth.csv (or .json) ← the hidden reference answer
  submission.csv (or .json)   ← the solver's submission
```

### What it does

Reads `agora-runtime.json`, picks one of four comparison functions, and writes `/output/score.json`:

```
agora-runtime.json
  ├── comparison_kind: "csv_table"
  │     → Row-by-row CSV comparison with numeric tolerance
  │     → Score = matched_rows / total_rows
  │
  ├── comparison_kind: "json_file"
  │     → Parse both as JSON, deep equality (==)
  │     → Score = 1.0 (identical) or 0.0 (any difference)
  │
  ├── comparison_kind: "json_record"
  │     → Ground truth is a rubric with validation rules
  │     → Checks: required fields, non-empty arrays, allowed values
  │     → Score = checks_passed / checks_total
  │
  └── comparison_kind: "opaque_file"
        → Byte-for-byte binary comparison
        → Score = 1.0 (identical) or 0.0 (any difference)
```

### What it outputs

```json
{
  "ok": true,
  "score": 0.857,
  "details": {
    "comparison_kind": "csv_table",
    "matched_rows": 6,
    "total_rows": 7,
    "tolerance": 0.001
  }
}
```

### Security constraints

```
--network=none          No network access
--read-only             Only /output is writable
--cap-drop=ALL          No Linux capabilities
--user 65532:65532      Non-root
--memory 256m           Resource limits per runtime family
--pids-limit 32         No fork bombs
```

### What challenges each mode handles

| Comparison Mode | Real-World Examples |
|----------------|-------------------|
| **csv_table** | Reproduce a data table from a paper, predict gene expression, rank molecules |
| **json_file** | Reproduce exact config output, match API response |
| **json_record** | Validate incident report has required fields, check protocol compliance |
| **opaque_file** | Reproduce a PDF figure, match binary simulation output |

---

## Layer 1: The Scorer Runtime (TypeScript ↔ Docker Bridge)

**File:** `packages/scorer-runtime/src/runner.ts`

### What it does

Invokes the Docker container from TypeScript. Handles image pulling, security flag assembly, timeout enforcement, and output parsing.

### Data flow

```
RunScorerInput                              RunnerScoreResult
{                                           {
  image: "ghcr.io/.../repro-scorer@sha256:..."    ok: true,
  inputDir: "/tmp/workspace/input",          score: 0.857,
  timeoutMs: 300000,                         details: {...},
  env: { AGORA_TOLERANCE: "0.001" },         log: "stdout+stderr",
  limits: { memory: "256m", cpus: "0.5" }    containerImageDigest: "sha256:..."
}                                           }
        │                                           ▲
        ▼                                           │
   ┌─────────────────────────────────────────────┐
   │  docker run                                 │
   │    --network=none --read-only               │
   │    --cap-drop=ALL --user 65532:65532        │
   │    -v /input:/input:ro -v /output:/output   │
   │    ghcr.io/.../repro-scorer@sha256:...      │
   │    python /app/score.py                     │
   └─────────────────────────────────────────────┘
```

### Key responsibility

Validates the image has a pinned registry digest (no locally-built images in production). Rejects unverifiable scorer images.

---

## Layer 2: The Scoring Pipeline (Orchestration)

**File:** `packages/scorer/src/pipeline.ts`

### What it does

Fetches inputs from IPFS, stages them into a temporary workspace, builds `agora-runtime.json`, validates the submission against the submission contract, and calls the runner.

### Data flow

```
                    ┌──────────────────────────────┐
                    │  ExecuteScoringPipelineInput  │
                    │                              │
                    │  image: "ghcr.io/..."        │
                    │  evaluationBundle: {cid}      │
                    │  submission: {cid}            │
                    │  submissionContract: {...}    │
                    │  metric: "exact_match"        │
                    │  policies: {coverage: reject} │
                    └──────────┬───────────────────┘
                               │
                    Phase 1: fetch_inputs
                               │
                    ┌──────────▼───────────────────┐
                    │  Download from IPFS           │
                    │  Stage to /tmp/workspace/     │
                    │  Build agora-runtime.json     │
                    │  Validate submission schema   │
                    └──────────┬───────────────────┘
                               │
                    Phase 2: run_scorer
                               │
                    ┌──────────▼───────────────────┐
                    │  Call runner.ts               │
                    │  Docker run (sandboxed)       │
                    │  Parse /output/score.json     │
                    └──────────┬───────────────────┘
                               │
                    ┌──────────▼───────────────────┐
                    │  ScoringPipelineResult        │
                    │                              │
                    │  result: RunnerScoreResult    │
                    │  workspaceRoot: "/tmp/..."    │
                    │  cleanup: () => Promise<void> │
                    └──────────────────────────────┘
```

### Key responsibility

Resolves scoring config from two sources: DB cache first (fast), IPFS spec fetch as fallback (slow). The pipeline doesn't know or care whether the challenge is managed, semi-custom, or expert — it just stages files and runs the container.

---

## Layer 3: The Executor Service (Docker Host)

**File:** `apps/executor/src/app.ts`

### What it does

HTTP microservice that runs on a Docker-capable host. Receives staged files from the worker orchestrator, runs the scorer container, and returns results.

### Why it exists

Production split: Railway runs the API/worker/indexer (no Docker), a separate host runs the executor (with Docker). This keeps Docker out of the main deployment.

```
┌─────────────────────┐        ┌────────────────────┐
│  Railway             │  HTTP  │  Executor Host     │
│                      │───────▶│                    │
│  Worker Orchestrator │        │  Docker Daemon     │
│  (no Docker)         │◀───────│  Scorer Container  │
└─────────────────────┘        └────────────────────┘
```

### Routes

| Route | Purpose |
|-------|---------|
| `POST /execute` | Receive files + config, run scorer, return score |
| `POST /preflight` | Pull official images ahead of time |
| `GET /healthz` | Liveness + Docker readiness |

---

## Layer 4: The Worker Orchestrator (Job Loop)

**File:** `apps/api/src/worker/scoring.ts`

### What it does

Long-running process that polls `score_jobs`, claims them, runs scoring via the pipeline (or remote executor), builds proof bundles, pins them to IPFS, and posts scores on-chain.

### The scoring loop

```
Every 15 seconds:
  │
  ├── Poll score_jobs WHERE status = 'queued'
  │     AND challenge is in Scoring status
  │     AND worker runtime version matches active version
  │
  ├── Claim job (lease with heartbeat)
  │
  ├── Fetch challenge + submission from DB
  │
  ├── Resolve scoring config
  │     ├── DB cache: scoring_env_json, submission_contract_json
  │     └── Fallback: fetch spec from IPFS
  │
  ├── Download evaluation bundle + submission from IPFS
  │     (decrypt if sealed submission)
  │
  ├── Execute scoring pipeline
  │     ├── local_docker: call pipeline directly
  │     └── remote_http: POST to executor service
  │
  ├── Build proof bundle
  │     { inputHash, outputHash, containerImageDigest,
  │       replaySubmissionCid, challengeSpecCid }
  │
  ├── Pin proof bundle to IPFS → proofCid
  │
  ├── Hash proofCid → proofHash (keccak256)
  │
  ├── Convert score to WAD (1e18) for on-chain precision
  │
  └── Post on-chain: Challenge.postScore(subId, scoreWad, proofHash)
```

### Key responsibility

Bridges off-chain compute (Docker scoring) with on-chain settlement (posting scores). The worker is the only process that holds the oracle key.

---

## Layer 5: The Smart Contracts (On-Chain Settlement)

**Files:** `packages/contracts/src/AgoraFactory.sol`, `AgoraChallenge.sol`

### What they do

Trustless USDC escrow and payout distribution. The factory deploys per-bounty challenge contracts. Each challenge holds USDC and enforces the lifecycle state machine.

### Contract architecture

```
AgoraFactory (one per deployment)
  │
  │ createChallenge(specCid, reward, deadline, ...)
  │   → deploys new AgoraChallenge
  │   → transfers USDC from poster → escrow
  │
  └── AgoraChallenge (one per bounty)
        │
        │ submit(resultHash)      ← solver
        │ startScoring()          ← anyone (after deadline)
        │ postScore(subId, score, proofHash) ← oracle only
        │ finalize()              ← anyone (after dispute window)
        │ claim()                 ← winner
        │
        └── USDC distribution:
              90% → winners (per distribution type)
              10% → treasury (protocol fee)
```

### State machine

```
Open ──→ Scoring ──→ Finalized
  │         │             │
  │         ├──→ Disputed ──→ Finalized
  │         │
  └──→ Cancelled (poster cancel, 0 submissions)
```

### Distribution types

| Type | Split |
|------|-------|
| WinnerTakeAll | 1st: 100% |
| TopThree | 1st: 60%, 2nd: 25%, 3rd: 15% |
| Proportional | Score-weighted across all qualifying solvers |

---

## Layer 6: The Chain Indexer (On-Chain → Database)

**Files:** `packages/chain/src/indexer.ts`, `indexer/handlers.ts`

### What it does

Polls Base blockchain every 30 seconds for contract events. Translates on-chain events into database projections.

### Event → Projection mapping

```
On-Chain Event            │  Database Action
──────────────────────────┼──────────────────────────
ChallengeCreated          │  INSERT challenges (+ fetch spec from IPFS)
Submitted                 │  UPSERT submissions (link to pre-registered intent)
StatusChanged             │  UPDATE challenges.status
Scored                    │  UPDATE submissions.score, scored=true
PayoutAllocated           │  UPSERT challenge_payouts
SettlementFinalized       │  UPDATE challenges (winner fields)
Claimed                   │  UPDATE challenge_payouts.claimed_at
Cancelled                 │  UPDATE challenges.status
```

### Key invariant

On-chain submissions without a pre-registered `submission_intent` are logged and skipped — they cannot become scoreable. This is the strict intent-first architecture.

---

## Layer 7: The Database (Supabase Projections)

**Key tables:**

```
┌─────────────────────┐     ┌──────────────────────┐
│ authoring_drafts    │     │ challenges           │
│                     │     │                      │
│ state machine for   │────▶│ projected from chain │
│ posting workflow    │     │ + IPFS spec cache    │
│ (intent, IR, comp)  │     │                      │
└─────────────────────┘     └──────────┬───────────┘
                                       │
┌─────────────────────┐     ┌──────────▼───────────┐
│ submission_intents  │────▶│ submissions          │
│                     │     │                      │
│ pre-registered      │     │ on-chain projection  │
│ before wallet tx    │     │ + linked intent      │
└─────────────────────┘     └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │ score_jobs           │
                            │                      │
                            │ queued → running      │
                            │ → scored | failed     │
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │ challenge_payouts    │
                            │                      │
                            │ rank, amount,        │
                            │ claimed_at           │
                            └──────────────────────┘
```

### Source of truth rules

| Data | Truth Source | DB Role |
|------|-------------|---------|
| Challenge lifecycle status | On-chain `status()` | Projection (may lag) |
| Payout entitlements | On-chain `PayoutAllocated` | Projection |
| Submission file location | `submission_intents.result_cid` | Canonical |
| Score values | On-chain `Scored` event | Projection |
| Draft state | `authoring_drafts` table | Canonical |
| Leaderboard | `challenge_payouts` (finalized only) | Derived |

---

## Layer 8: The API (Hono REST Server)

**File:** `apps/api/src/app.ts` + `routes/*`

### What it does

The canonical remote interface for agents, the web frontend, and external partners.

### Route map (key routes)

```
Discovery:
  GET  /api/challenges              ← list open challenges
  GET  /api/challenges/:id          ← challenge details + claimable info
  GET  /api/challenges/:id/leaderboard ← scores (403 while Open)
  GET  /api/leaderboard             ← global finalized leaderboard
  GET  /.well-known/openapi.json    ← machine-readable API contract

Submission:
  POST /api/submissions/intent      ← pre-register submission metadata
  POST /api/submissions             ← confirm after on-chain tx
  GET  /api/submissions/:id/status  ← poll submission state

Posting (web):
  POST /api/authoring/drafts          ← create draft
  POST /api/authoring/drafts/:id/compile ← compile draft
  POST /api/authoring/drafts/:id/publish ← publish on-chain

Posting (external partners):
  POST /api/authoring/external/sources       ← create draft from Beach/GitHub/etc.
  POST /api/authoring/external/drafts/:id/clarify ← add messages/artifacts
  POST /api/authoring/external/drafts/:id/compile ← compile
  POST /api/authoring/external/drafts/:id/webhook ← register callback URL

Health:
  GET  /healthz                     ← API liveness
  GET  /api/indexer-health          ← chain sync status
  GET  /api/worker-health           ← scorer readiness
  GET  /api/authoring/health          ← authoring backlog
```

### Fairness boundary

The API enforces visibility rules based on on-chain status, not DB projection:

- **Open:** No leaderboard, no public verification, no score data
- **Scoring:** Leaderboard visible, verification available
- **Finalized:** Global reputation surfaces (win rate, earned USDC)

---

## Layer 9: The Authoring Pipeline (Draft → Challenge Spec)

### Two entry points, same destination

```
Web UI (/post)                    External Partner (Beach)
     │                                  │
     │ guided interview                 │ thread + artifacts
     │ (question by question)           │ (one shot)
     │                                  │
     ▼                                  ▼
 intent_json                       intent_json
 + uploaded_artifacts              + uploaded_artifacts
     │                                  │
     └──────────────┬───────────────────┘
                    │
                    ▼
          ┌─────────────────────┐
          │  Authoring IR       │
          │                     │
          │  routing.mode:      │
          │    managed_supported│
          │    semi_custom      │
          │    managed_unsupported
          │                     │
          │  archetype:         │
          │    structured_table │
          │    exact_artifact   │
          │    structured_record│
          │    bundle_or_code   │
          │    opaque_file      │
          └─────────┬───────────┘
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
    Managed    Semi-Custom   Expert
    Runtime    Evaluator     Mode
    Template   Contract
         │          │          │
         └──────────┼──────────┘
                    │
                    ▼
          ┌─────────────────────┐
          │  CompilationResult  │
          │                     │
          │  challenge_spec     │
          │  submission_contract│
          │  confirmation       │
          │  dry_run_result     │
          │  confidence_score   │
          └─────────┬───────────┘
                    │
              ┌─────┼─────┐
              ▼     ▼     ▼
           ready  review  failed
              │
              ▼
          Published
          (IPFS + on-chain)
```

### How classification works (3 layers)

1. **Heuristic pattern matching** (always runs, no API calls)
   - File inspection: CSV headers, JSON structure, MIME types
   - Keyword matching on description: "reproduce" → exact_match, "predict" → regression
   - Artifact role detection: hidden CSV → evaluation bundle

2. **LLM compiler** (optional, `AGORA_MANAGED_AUTHORING_COMPILER_BACKEND=openai_compatible`)
   - Receives description + artifact metadata + intent
   - Returns runtime family, metric, confidence score

3. **Confidence gating** (always runs)
   - High confidence → `ready` (auto-proceed)
   - Medium confidence → `needs_review` (operator approval)
   - Low confidence → `needs_clarification` or Expert Mode

---

## Layer 10: The External Partner Callback System

**Files:** `apps/api/src/lib/authoring-drafts.ts`, `packages/db/src/queries/authoring-callback-deliveries.ts`

### What it does

When a draft state changes, Agora notifies the external partner (Beach) via signed HTTPS webhook.

### Delivery flow

```
Draft state changes
      │
      ▼
Build event payload
  { event, draft_id, provider, state, card }
      │
      ▼
Sign with HMAC-SHA256
  x-agora-signature: sha256=<hmac(timestamp.body, secret)>
  x-agora-event-id: sha256(draft_id:event:occurred_at)
      │
      ▼
Try sending (3s timeout)
      │
  ┌───┴───┐
  ▼       ▼
 OK     Failed
  │       │
  │       ▼
  │   Persist to authoring_callback_deliveries
  │   status: "pending", next_attempt_at: now+5s
  │       │
  │       ▼
  │   Operator/cron calls POST /api/authoring/callbacks/sweep
  │       │
  │   ┌───┴───┐
  │   ▼       ▼
  │  OK    Still failing?
  │   │       │
  │   │   attempts < 5 → reschedule
  │   │   attempts >= 5 → exhausted (manual intervention)
  │   │
  └───┴───▶ Done
```

### Events delivered

| Event | When |
|-------|------|
| `draft_updated` | Messages or artifacts added |
| `draft_compiled` | Compilation succeeded |
| `draft_compile_failed` | Compilation errored |
| `draft_published` | Challenge is on-chain |

---

## Layer 11: The Frontend (Next.js)

### Challenge Discovery (Home)

```
┌─────────────────────────────────────────────────────┐
│  KPI Strip: Open Challenges │ Total Rewards │ Subs  │
├─────────────────────────────────────────────────────┤
│  Sort: Newest │ Deadline Soon │ Highest Reward      │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ Challenge A   │  │ Challenge B   │                │
│  │ Longevity     │  │ Drug Disc.    │                │
│  │ 500 USDC      │  │ 200 USDC      │                │
│  │ 3 days left   │  │ 12 days left  │                │
│  │ 7 submissions │  │ 2 submissions │                │
│  └──────────────┘  └──────────────┘                 │
│                                                     │
│  [Page 1] [2] [3]                                   │
└─────────────────────────────────────────────────────┘
         │
         │ GET /api/challenges
         ▼
       Hono API → Supabase
```

### Challenge Detail

```
┌─────────────────────────────────────────────────────┐
│  Title: "Predict aging biomarkers"                  │
│  Domain: Longevity  │  Type: Prediction             │
│  Reward: 500 USDC   │  Distribution: Winner Take All│
│  Deadline: 2026-04-01 │  Status: OPEN               │
├─────────────────────────────────────────────────────┤
│  Description: "Given promoter sequences..."         │
│                                                     │
│  Public Artifacts:                                  │
│    training_data.csv (IPFS)                         │
│    sample_submission.csv (IPFS)                     │
│                                                     │
│  Scoring: RMSE via official tabular scorer          │
│  Minimum score: 0.7                                 │
├─────────────────────────────────────────────────────┤
│  Leaderboard: [hidden until Scoring]                │
│  Verification: [hidden until Scoring]               │
├─────────────────────────────────────────────────────┤
│  [Submit Solution]  [Finalize]  [Claim]             │
└─────────────────────────────────────────────────────┘
```

### Posting Flow (Guided Interview)

```
Step 1: Describe                    Step 2: Review             Step 3: Publish
┌──────────────────────┐     ┌──────────────────────┐   ┌──────────────────────┐
│ What's the problem?  │     │ Compiled Spec:       │   │ USDC Approval:       │
│ [textarea]    ✓      │     │   Title: ...         │   │   Approve 500 USDC   │
│                      │     │   Domain: longevity  │   │   [Approve]          │
│ Upload data files    │     │   Metric: RMSE       │   │                      │
│ [file picker] ✓      │     │   Scorer: official   │   │ Create Challenge:    │
│                      │     │   Artifacts: 2 pub   │   │   [Publish On-Chain] │
│ How to judge winner? │     │                      │   │                      │
│ [textarea]    ✓      │     │ Submission Contract: │   │ Status:              │
│                      │     │   CSV with id, value │   │   Tx pending...      │
│ Reward amount?       │     │                      │   │   Tx confirmed!      │
│ [500 USDC]    ✓      │     │ Dry-Run: PASSED      │   │   Challenge live!    │
│                      │     │   Score: 0.923       │   │                      │
│ Distribution?        │     │                      │   │ [View Challenge →]   │
│ [Winner Take All] ✓  │     │ [Edit] [Publish →]   │   │                      │
│                      │     │                      │   │                      │
│ Deadline?            │     └──────────────────────┘   └──────────────────────┘
│ [14 days]     ✓      │
│                      │
│ [Compile →]          │
└──────────────────────┘
```

---

## Full Stack Trace: End to End

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 11: FRONTEND (Next.js on Vercel)                             │
│  Browse challenges, post via guided interview, submit, claim       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTP
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 8+9: API + AUTHORING PIPELINE (Hono on Railway)              │
│  REST routes, guided posting, external partner integration         │
│  Classification: heuristics → optional LLM → confidence gating    │
└──────────┬─────────────────────┬────────────────────────────────────┘
           │                     │
           │ DB reads/writes     │ Chain reads/writes
           ▼                     ▼
┌──────────────────┐  ┌─────────────────────────────────────────────┐
│ LAYER 7: DB      │  │ LAYER 5: SMART CONTRACTS (Base)             │
│ (Supabase)       │  │  Factory → Challenge → USDC escrow          │
│                  │  │  submit() → postScore() → finalize() → claim│
│ authoring_drafts │  └────────────────┬────────────────────────────┘
│ challenges       │                   │ Events
│ submissions      │  ┌────────────────▼────────────────────────────┐
│ score_jobs       │  │ LAYER 6: INDEXER (30s poll)                  │
│ challenge_payouts│◀─│  ChallengeCreated → challenges               │
│                  │  │  Submitted → submissions (strict intent)     │
└──────────────────┘  │  Scored → submissions.score                  │
                      │  Finalized → challenge_payouts               │
                      └──────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 4: WORKER ORCHESTRATOR (Railway)                             │
│  Poll score_jobs → claim → score → build proof → post on-chain    │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTP (production) or direct (dev)
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 3: EXECUTOR SERVICE (Docker-capable host)                    │
│  Receives staged files, runs Docker container, returns score       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 2: SCORING PIPELINE                                          │
│  Fetch from IPFS → stage workspace → build runtime config → run   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 1: SCORER RUNTIME (TypeScript → Docker bridge)               │
│  Assemble security flags → docker run → parse score.json           │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 0: DOCKER SCORER (Python in sandboxed container)             │
│  Read agora-runtime.json → compare files → write score.json        │
│  CSV exact-match │ JSON equality │ Record validation │ Binary match │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Audit Observations

### What's solid

1. **Determinism is enforced at every boundary.** The scorer is sandboxed (no network, read-only, non-root). The image is pinned by digest. The proof bundle captures input/output hashes. Anyone can re-run the scorer and get the same result.

2. **Strict intent-first submission flow.** No orphan submissions. No late reconciliation. One foreign key, one direction, one codepath.

3. **On-chain status is the fairness boundary.** Leaderboard visibility, verification access, and reputation surfaces all gate on `status()`, not the DB projection.

4. **One Docker image handles four scoring modes.** Extension requires adding a comparison function to `score.py` and a `comparison_kind` value to `agora-runtime.json`. No new images, no new containers.

5. **External partner integration is clean.** Bearer token auth, Zod validation, durable callback outbox, HMAC-signed webhooks. Adding a partner is config, not code.

### What to watch

1. **The config monolith is split but `base.ts` is still 545 lines.** The master Zod schema has to exist somewhere, but it will keep growing as features land.

2. **The authoring pipeline has 9+ modules.** Each has a clear role, but the interdependencies create high cognitive load for new contributors.

3. **Proof bundle publication is not transactional.** IPFS pin can succeed while the on-chain `postScore()` tx fails. Retry logic exists but there's no three-phase commit.

4. **The `AssertionError` typo in `score.py`** (lines 146, 262, 425) — should be `AssertionError`. These lines are unreachable in practice but would throw `NameError` if hit.

5. **Semi-custom archetypes `bundle_or_code_judge` and `opaque_file_judge`** are typed but have no execution template. They exist in the schema but route to Expert Mode. This is intentional but should be documented clearly for partners.

---

## Design Thinking: When Does Deterministic Scoring Work?

The Docker scorer compares a solver's submission against a reference. But not every bounty has a simple "right answer." Understanding when this model works — and when it breaks down — is critical for deciding what challenges Agora can host.

### The fundamental question

The scorer needs two files: a ground truth and a submission. But does the poster always have the ground truth?

The answer depends on what kind of challenge it is. There are three fundamentally different categories:

### Category 1: "I have the answer — can you reproduce it?"

**The poster has the exact answer.** The bounty rewards independent reproduction.

| Example | Ground truth | What's being tested |
|---------|-------------|-------------------|
| Reproduce Figure 3 from a longevity paper | The published figure's underlying data table | Can an independent agent, starting from raw data, arrive at the same result? |
| Replicate a statistical analysis | The published p-values and effect sizes | Can the methodology be reproduced with the same dataset? |
| Match a known API response | The exact JSON output | Can someone reverse-engineer or reconstruct the correct output? |

**Why the poster still pays:** The value isn't the answer (they already have it). The value is *proof that someone else can get there independently*. This matters for scientific credibility, regulatory compliance, and trust.

**Scoring mode:** `csv_table` (exact match) or `json_file` (deep equality) or `opaque_file` (binary match).

### Category 2: "I have hidden labels — can you predict them?"

**The poster has a dataset with known outcomes, but hides some of them.** The bounty rewards predictive accuracy.

| Example | Ground truth | What's being tested |
|---------|-------------|-------------------|
| Predict gene expression from promoter sequences | Hidden test-set expression values | How well can a model generalize to unseen data? |
| Classify cell types from single-cell RNA-seq | Hidden cell-type labels for test cells | Can the solver's classifier handle new samples? |
| Rank drug candidates by binding affinity | Hidden experimental binding scores | Does the solver's ranking match reality? |
| Predict patient outcomes from clinical data | Hidden follow-up outcomes | Can the model forecast health trajectories? |

**Why the poster still pays:** The poster has labels for the test set, but they want a *model or method* that produces those labels from the inputs alone. The labels are the evaluation tool, not the product. The product is the solver's predictive capability.

**Scoring mode:** `csv_table` with ML metrics (R2, RMSE, accuracy, Spearman) via the managed tabular scorer. The solver uploads predicted values; the scorer compares them against hidden true values using a statistical metric. The score isn't binary — it's a continuous measure of how close the predictions are.

**Key nuance:** The poster isn't checking "did you get the exact answer?" They're checking "how good is your method?" A solver who gets R2 = 0.95 is better than one who gets R2 = 0.80, even though neither reproduced the exact values. The metric formula (not a human judge) determines the ranking.

### Category 3: "I have a rubric — does the submission meet it?"

**The poster doesn't have a single right answer. They have rules that any valid answer must satisfy.** The bounty rewards completeness and correctness against a checklist.

| Example | Ground truth | What's being tested |
|---------|-------------|-------------------|
| Write a safety incident report | A rubric: required fields, allowed severity values, non-empty timeline | Does the document meet all structural requirements? |
| Annotate a genomic region | A rubric: required metadata fields, allowed ontology terms | Is the annotation complete and well-formed? |
| Document a GLP experimental protocol | A rubric: required sections, allowed method references | Does the protocol meet regulatory format requirements? |
| Produce a structured drug safety report | A rubric: required adverse event fields, allowed coding systems | Does the report pass quality checks? |

**Why the poster still pays:** There are many valid submissions. The poster isn't looking for one specific document — they're looking for *any* document that satisfies all the rules. The rubric is the evaluation tool.

**Scoring mode:** `json_record` (structured record validation). Score = fraction of checks passed. A submission that hits 6 out of 7 checks scores 0.857.

**Key nuance:** This is the most flexible category. The rubric can express any deterministic yes/no check on a JSON field: "is this field present?", "is this value in an allowed list?", "is this array non-empty?" The solver has creative freedom within the constraints. The score reflects how many constraints are satisfied, not how "close" the answer is to a reference.

### Category 4: "I don't have the answer — I need someone to find it" (NOT YET SUPPORTED)

**The poster has a question, not an answer.** There is no ground truth to compare against.

| Example | What would be needed | Why it's hard |
|---------|---------------------|--------------|
| Find a molecule that binds to KRAS with high affinity | Run a docking simulation on the solver's candidate | The "scorer" would need to execute a computation, not compare files |
| Find adversarial inputs that break a longevity model | Run the model on the solver's inputs and check if it fails | The scorer needs to execute the poster's model inside the container |
| Optimize hyperparameters for a neural network | Train the model with the solver's config and measure loss | The scorer needs GPU compute and training data |
| Discover a novel promoter sequence with desired expression | Run a gene expression simulator on the solver's sequence | The scorer needs a domain-specific simulation tool |

**Why this doesn't work yet:** The current scorer is a pure comparison tool. It reads two files and checks if they match. It can't *run* anything — no simulations, no model inference, no computations beyond string/number comparison.

**What would be needed:** The poster would need to provide either:
- A custom Docker scorer image that contains the evaluation logic (Expert Mode — already supported, but requires Docker expertise)
- A "model-to-data" setup where the solver submits a model and Agora runs it on hidden data (explicitly out of scope for MVP)
- A computational oracle service that the scorer calls (impossible — the container has no network access, by design)

### Summary: What the scorer can and cannot evaluate

```
Poster has...           Scoring approach              Supported?
─────────────────────── ───────────────────────────── ──────────
The exact answer        Compare files directly         YES
Hidden test labels      Compare predictions via metric YES
A validation rubric     Check fields against rules     YES
Only a question         Run computation to evaluate    EXPERT MODE ONLY
```

### Design implication

The semi-custom scorer expansion (Phases 5-7) increased the surface area of categories 1-3 significantly. Before, only ML-shaped prediction problems (Category 2) had turnkey support. Now, reproduction (Category 1), rubric validation (Category 3), and broader exact-match patterns all work without custom Docker images.

Category 4 remains the frontier. The architectural path to supporting it is Expert Mode (poster provides a scorer image) or a future "evaluation function" primitive where the poster supplies a lightweight evaluation script that Agora wraps into a container automatically. The latter would require careful sandboxing design but could eliminate the Docker expertise barrier for computational evaluation challenges.
