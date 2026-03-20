---
name: architecture-review
description: "Reviews code for clean system design: code simplicity, low structural entropy, modularity, extensibility, high cohesion, low coupling, low blast radius, leaky abstractions, separation of concerns, single source of truth, interface stability, surface area, canonical vs derived state, policy vs mechanism separation, failure mode resilience, invariant correctness, semantic consistency after renames/refactors, migration residue detection (stale columns, dangling fallbacks, shadow storage), and observability coverage on multi-step pipelines. No over-engineering, no over-complexity. Use when the user asks to review code quality, simplify architecture, check for over-engineering, find redundant layers, optimize system design, detect stale code or naming from refactors, check for migration cleanup, assess observability gaps, or assess whether code is simple, modular, and extensible."
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Architecture Review

Review code for clean, simple system design. The core philosophy: **prefer simplicity over cleverness, modularity over monoliths, extensibility over rigidity, directness over abstraction, and correctness over convenience.**

System design is not about making things work. It is about making things stay correct, stay understandable, and stay maintainable — whether the next person touching the code is a human or an AI agent.

## Design Principles

These are the principles to evaluate against, in priority order:

1. **Code simplicity** — Is the code simple, clear, and direct? Does it do what it says with no hidden intent, no unnecessary indirection, no clever tricks? Simple code is not dumbed-down code — it's code where the complexity matches the problem, nothing more. Distinguish essential complexity (inherent to the problem) from accidental complexity (accumulated through poor choices). If the system feels heavier than the problem demands, accidental complexity is creeping in.

2. **Low structural entropy** — Are there too many moving parts for what this accomplishes? Count the files, types, functions, and layers involved relative to the complexity of the task. If a simple feature touches 8 files across 4 packages, the structure has too much entropy. Entropy accumulates through four mechanisms: concept duplication (same idea defined in multiple places), mixed responsibilities (one file absorbing unrelated concerns), change amplification (a small conceptual change requiring edits across many files), and hidden invariants (correctness depending on unwritten rules not enforced in code).

3. **Separation of concerns** — Are different responsibilities kept in different places? Each layer should have one clear job. Evaluate three separations: policy vs mechanism (what the system does vs how it does it), data flow vs control flow, and pure logic vs side effects. If policies are buried in mechanism code, or domain logic is trapped in UI components, the boundaries are wrong. The diagnostic: "If I deleted the entire UI, would the backend still make sense as a domain model?"

4. **Single source of truth** — Is every concept defined in exactly one canonical location? If the same information is stored in multiple places, they will drift. For every runtime decision, ask: who is the single authority for this value? If the answer involves fallback chains or merge logic, the single-writer principle is violated. One authority per decision, everyone else reads.

5. **Canonical vs derived state** — Is it clear which state is ground truth and which is computed? Canonical state is the source of truth — if lost, the system is broken. Derived state is computed from canonical and can be recomputed. The moment you store derived state independently, you create a synchronization problem. Store only what you cannot recompute. Everything else is a liability.

6. **Interface stability, surface area, and coupling** — Three related concepts: how tangled are the parts (coupling), how many promises are you making to the outside world (surface area), and how stable are those promises (interface stability). The goal is small surface + stable interfaces + low coupling = changes stay local. Count public exports, routes, commands, tables, and methods — every one is a commitment. Fewer doors = more freedom to change internals. Dependencies should flow one way: primitives → domain modules → app composition → entrypoints.

7. **Modularity** — Can you add, change, or remove a feature without touching unrelated code? Each module should be independently understandable and replaceable. If adding a new field requires edits in 5 files, the boundaries are wrong. A clean module should know its input, its output, and its rules — not the internals of six other modules.

8. **Extensibility** — Can new behavior be added by composing existing pieces, or does it require cracking open internals? The system should grow by addition, not modification. Test this: pick the most common extension point and count how many files you would touch. If more than 2-3, the extension point is actually a surgery point. Replace scattered conditionals with a registry or lookup table that new entries can be added to.

9. **High cohesion** — Does each module do one thing well? If you can't describe it in one sentence without "and", it's doing too much. Watch for files that gradually absorb unrelated responsibilities — every responsibility added makes the file harder to reason about and increases blast radius for every future change.

10. **Low coupling** — Does changing module A force changes in modules B, C, D? Count the cross-boundary imports and shared mutable state. One-way dependency flow is critical — the moment dependency direction becomes circular, every change requires tracing an unpredictable web of imports.

11. **Low blast radius** — If this code breaks, how far does the damage spread? A bug in a shared utility is worse than a bug in a leaf component. Changes should be containable. Segment the system into fault domains — each should fail independently without collapsing the entire system.

12. **No leaky abstractions** — Does a consumer need to know implementation details to use this correctly? Can you change the internals without breaking callers? When hidden complexity escapes through the boundary and forces you to understand internals anyway, that is a design problem, not a knowledge problem. Fix the boundary, don't document the leak.

13. **No over-engineering** — Is this built for hypothetical future requirements? Three similar lines of code are better than a premature abstraction. Every layer of indirection must earn its keep. Apply the payoff test: if an abstraction adds new concepts, files, or configuration, it must pay for itself by reducing change amplification, eliminating duplication, or improving testability. If it does not, it is premature. Delete it. Healthy systems are shallow — for core flows, you should follow the logic in 2-3 hops.

14. **No unnecessary redundancy** — Are there duplicate code paths, redundant layers, or abstractions that just pass through to another abstraction? Duplication predicts divergence — duplicated enums, container names, state labels will eventually diverge and mean subtly different things.

15. **Decision-to-outcome ratio (Convergence Ratio)** — For any branching logic (if/else chains, strategy patterns, resolution pipelines, factory methods), count the number of decision paths and count the number of distinct outcomes they produce. If the ratio exceeds ~3:1, the branching complexity is not justified by the output diversity and likely belongs in configuration or parameterized lookup, not conditional code. This catches a specific class of over-engineering where elaborate multi-layer decision trees — each with their own types, validation, and resolution logic — ultimately select from a small output space. The fix is almost always: replace the decision tree with a parameterized template where the template provides defaults and the caller provides overrides. The decision tree collapses to a single lookup + merge. To apply this: trace any resolution or strategy chain from its entry point to its terminal output across all package and layer boundaries. Count branches in, count distinct outputs out. If N paths produce M outputs and N >> M, the branching is structural waste.

16. **Invariant correctness** — Are the things that must always be true actually enforced in code? Hidden invariants (assumptions like "finalize will not be called twice" that are not enforced) are dangerous. If you manually check the same invariant repeatedly, promote it: question → documentation → assertion → gate. Enforce boundaries centrally, allow autonomy locally.

17. **Semantic consistency** — After any rename or conceptual shift, does every layer speak the same vocabulary? Type systems catch structural mismatches but not naming mismatches — a parameter named `session` that holds a `DraftRow` compiles fine. The diagnostic: grep for the old name across source, tests, fixtures, benchmarks, comments, and log strings. Every surviving instance is semantic debt. Partial renames are worse than no rename because they create a codebase that uses two languages for the same thing.

18. **Migration residue** — When a model changes, is the old structure fully removed? Residue includes: replaced-but-not-dropped columns, deprecated constants still imported, old resolution functions kept as fallback paths, and conditional branches handling formats no longer produced by any writer. For each old-model artifact, ask: is it still written by current code? Is it still read outside a fallback shim? If no to both, it is dead. If read only as a silent fallback behind the new path, it is residue — the fallback masks bugs in the new path. Cleanup rule: delete the old path in the same change as the new one, or set an explicit expiry. Indefinite fallbacks become permanent residue.

19. **Observability coverage** — Can you diagnose a failure from logs alone, without a debugger? Gaps cluster in three places: (a) decision points involving heuristics or confidence routing — log the inputs and the decision, not just the outcome; (b) state transitions — log before/after state and the trigger; (c) cross-boundary handoffs — log correlation IDs on both sides. The principle is not "log everything" but: every branch that could fail silently must emit enough context to distinguish "worked," "failed with known cause," and "failed with unknown cause" without reading source code.

## Verification Lenses

Before judging code shape, apply these deeper lenses:

### State Machine Lens
Can you draw the state machine for this system? If not, the system is not well understood. Check: are all states explicitly defined? Are transitions explicit and validated? Are there dead states or zombie states that nothing cleans up? Are illegal state transitions structurally impossible or merely undocumented?

### Invariant Lens
What must always be true regardless of execution path? Verify that invariants are enforced in code, not just documented. Hidden invariants accumulate silently and will be violated.

### Trust Boundary Lens
For every component, ask: who are you trusting to do what, and what happens when they don't? Map trust transitions — user to frontend, frontend to API, API to worker, worker to chain. Each boundary is an attack surface.

### Failure Mode Lens
Assume failure is the baseline, not the exception. When this fails, does the system converge to a correct state? Simulate: what if this crashes mid-operation? What if it runs twice? What if a dependency is missing? Strong architectures survive every scenario on paper.

### Convergence Lens
For any decision chain, resolution pipeline, or strategy selection — trace it from entry to terminal output, crossing every package and layer boundary along the way. Do not stop at the layer that changed. Follow the data to where it is finally consumed. Then count: how many distinct code paths exist, and how many distinct outputs do they produce? If 9 paths produce 3 outputs, the system has 6 paths worth of accidental complexity. This lens specifically requires crossing abstraction boundaries — a single-layer review will miss convergence issues because each layer looks reasonable in isolation. The waste only becomes visible when you see the full vertical slice from decision to execution.

### Semantic Consistency Lens
Grep for any recently renamed concept's old name across source, tests, fixtures, benchmarks, configs, comments, and log strings. Check: do parameter names match their types? Do test factory functions create what their name says? Do benchmark annotations use the current vocabulary? Type systems catch structural mismatches; this lens catches naming mismatches that compile fine but erode comprehension.

### Migration Residue Lens
Enumerate every artifact of any recently changed model: columns, constants, functions, config keys, fallback branches. For each: is it still written by current code? Is it still read outside a fallback? If no to both, delete it. If read only as a silent fallback, replace with a loud failure. Also check for shadow storage — old and new representations written in the same transaction without synchronization enforcement.

### Observability Lens
Trace any multi-step pipeline from trigger to terminal outcome. Count decision points, state transitions, and cross-boundary handoffs. Count how many emit structured logs. Coverage below ~60% on a critical pipeline means the next incident requires source code reading to diagnose. Zero coverage on an entire pipeline is a red flag.


## Bloat Detection Tests

Apply these concrete tests to detect architectural bloat:

1. **Sources of truth count** — Pick any concept. How many places is it defined? If the same concept appears in more than one canonical location, that is a bloat signal.
2. **Parallel pipeline detection** — Are there two ways to do the same thing? One should be canonical, others should call it.
3. **The 5-box test** — Can you describe the entire system architecture in 5 boxes? If you need 12, the system has bloat.
4. **Change amplification** — If you add one new concept entry, how many files must you touch? Good design: 1-2. Sick: 5+ files that must stay in sync.
5. **Conceptual duplication** — Search for duplicate enums, duplicate container names, duplicate state labels. Duplication predicts divergence.
6. **The delete test** — For any component, ask: what happens if I remove this entirely? If the answer is "nothing changes for the user" — it is a deletion candidate.
7. **Public surface audit** — Count public exports per package, API routes, CLI commands, contract methods. Every public surface is a commitment. Too many = actively try to shrink them.
8. **Convergence ratio** — For any resolution chain, strategy selector, or factory pipeline, trace from entry to terminal output across all layer and package boundaries. Count decision paths in, count distinct outputs out. Ratio > 3:1 is a bloat signal. This test must cross boundaries — do not stop at the layer that recently changed.
9. **Vocabulary grep** — Pick any concept that was renamed or reclassified in the recent changes. Search for the old name across the entire codebase: source, tests, fixtures, benchmarks, configs, comments, log strings, error messages. Every hit is semantic debt. Pay special attention to: function parameter names that no longer match their types, test factory functions whose names describe the old model, benchmark metadata and fixture annotations using parallel vocabulary, and string literals in assertions that reference deleted concepts.
10. **Shadow storage detection** — For any recently added column, field, or cache entry, check whether the old column/field it replaces is still being written in the same transaction or function. If both old and new are written together, the old one is shadow storage — it creates a synchronization obligation with no enforcement. Either delete the old one or stop writing to it.
11. **Fallback chain audit** — For any resolution function that has a fallback path (try new → fall back to old), ask: does the fallback emit a warning or metric when it fires? If the fallback is silent, it will mask bugs in the new path indefinitely. Silent fallbacks are migration residue disguised as robustness.
12. **Observability ratio** — For any multi-step pipeline, count the decision points, state transitions, and cross-boundary handoffs. Then count how many emit structured logs. Coverage below ~60% on a critical path means the next failure will require source code reading to diagnose. Zero coverage across an entire pipeline is a red flag.


## How to Review

1. Read the target files thoroughly before making any judgments.
2. Trace the dependency chain — what imports what, what calls what. Verify one-way dependency flow.
3. **Follow cross-boundary flows to their terminal output.** Do not stop at the layer that recently changed. For any decision, resolution, or strategy chain, trace it across package boundaries to where the output is finally consumed. This is where convergence issues hide — each layer looks reasonable in isolation, but the full vertical slice reveals redundant branching.
4. Identify canonical entities — where does each concept live, what is canonical vs derived state.
5. Check policy vs mechanism separation — are business rules tangled with infrastructure plumbing?
6. Run the bloat detection tests mentally — sources of truth count, change amplification, conceptual duplication, convergence ratio.
7. **Check semantic consistency.** If the codebase has undergone recent renames or conceptual shifts, grep for the old vocabulary across source, tests, fixtures, benchmarks, comments, and string literals. Every surviving instance is a finding.
8. **Check for migration residue.** If a data model or abstraction changed recently, trace every artifact of the old model (columns, constants, functions, fallback branches). Anything still present that is not written or read by current non-residue code paths is dead weight. Silent fallbacks behind new canonical paths are residue disguised as robustness.
9. **Check observability coverage** on any multi-step pipeline. Count decision points, state transitions, and cross-boundary handoffs. Count how many emit structured logs. Flag pipelines with near-zero coverage, especially those involving heuristics, inference, or confidence-based routing where the decision inputs — not just the outcome — must be visible.
10. For each finding, state:
    - **What:** the specific issue
    - **Where:** file and line number
    - **Why it matters:** concrete consequence, not abstract principle
    - **Suggested fix:** the simplest change that resolves it
11. Rank findings by severity (critical > warning > nitpick).
12. If everything looks clean, say so. Don't invent findings.

## Severity Guide

- **Critical:** Leaky abstractions, high coupling, violated invariants, missing single source of truth, canonical/derived state confusion, trust boundary violations, high blast radius, silent fallbacks that mask bugs in new canonical paths, shadow storage where old and new representations are written together without synchronization enforcement — these cause cascading failures, data corruption, and make the system fragile.
- **Warning:** Low modularity, poor extensibility, over-engineering, high structural entropy, mixed policy/mechanism, high change amplification, excessive surface area, near-zero observability on a critical pipeline, migration residue that imposes cognitive load and creates false affordances — these slow down development and make changes risky.
- **Nitpick:** Dead code, inconsistent naming, stale parameter or variable names that no longer match their types, test fixture factories using old vocabulary, benchmark metadata with parallel terminology, pattern drift from neighboring code, minor duplication that hasn't diverged yet.

## Agora-Specific Context

These patterns are intentional — do NOT flag them:

- `managed-post-flow.ts` has a multi-step wallet signing chain (publish → permit → create). The indirection is required by the on-chain protocol.
- `guided-state.ts` uses a reducer with many switch cases for each field. This is the standard pattern for the guided interview flow.
- `@agora/common` is a shared foundation package. Many packages importing from it is expected, not high coupling.
- The indexer polls events and writes projections to Supabase. The DB is a cache, not truth — this dual-source pattern is by design.
- `simulateAndWriteContract` wraps viem simulate+write. This abstraction earns its keep for error handling.

## Output Format

```
## Architecture Review: [target description]

### Critical
- (findings or "None")

### Warning
- (findings or "None")

### Nitpick
- (findings or "None")

### Verdict
[One sentence: is this code simple, modular, and extensible — or does it need work?]
```
