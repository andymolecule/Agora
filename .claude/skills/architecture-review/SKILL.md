---
name: architecture-review
description: "Reviews code for clean system design: code simplicity, low structural entropy, modularity, extensibility, high cohesion, low coupling, low blast radius, leaky abstractions, separation of concerns, single source of truth, interface stability, surface area, canonical vs derived state, policy vs mechanism separation, failure mode resilience, and invariant correctness. No over-engineering, no over-complexity. Use when the user asks to review code quality, simplify architecture, check for over-engineering, find redundant layers, optimize system design, or assess whether code is simple, modular, and extensible."
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

15. **Invariant correctness** — Are the things that must always be true actually enforced in code? Hidden invariants (assumptions like "finalize will not be called twice" that are not enforced) are dangerous. If you manually check the same invariant repeatedly, promote it: question → documentation → assertion → gate. Enforce boundaries centrally, allow autonomy locally.

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


## Bloat Detection Tests

Apply these concrete tests to detect architectural bloat. Each test has an acceptable baseline — only flag when exceeded:

1. **Sources of truth count** — Pick any concept. How many places is it defined? If the same concept appears in more than one canonical location, that is a bloat signal. Acceptable: a shared foundation package re-exporting types is not duplication.
2. **Parallel pipeline detection** — Are there two ways to do the same thing? One should be canonical, others should call it.
3. **The 5-box test** — Can you describe the entire system architecture in 5 boxes? If you need 12, the system has bloat.
4. **Change amplification** — If you add one new concept entry, how many files must you touch? Good design: 1-2. Sick: 5+ files that must stay in sync.
5. **Conceptual duplication** — Search for duplicate enums, duplicate container names, duplicate state labels. Duplication predicts divergence.
6. **The delete test** — For any component, ask: what happens if I remove this entirely? If the answer is "nothing changes for the user" — it is a deletion candidate.
7. **Public surface audit** — Count public exports per package. Acceptable: a shared foundation package (like `@agora/common`) with 20-40 exports is normal. Flag only when a leaf package has >15 exports or a foundation package has >60.


## How to Review

**Accuracy over volume.** A review with 0 critical findings and 2 warnings is better than a review with 5 inflated criticals. Only report issues you can prove with specific code evidence and a concrete failure scenario. If everything looks clean, say so. Don't invent findings.

1. Read the target files thoroughly before making any judgments.
2. Trace the dependency chain — what imports what, what calls what. Verify one-way dependency flow.
3. Identify canonical entities — where does each concept live, what is canonical vs derived state.
4. Check policy vs mechanism separation — are business rules tangled with infrastructure plumbing?
5. Run the bloat detection tests mentally — sources of truth count, change amplification, conceptual duplication.
6. **Verify reachability.** Before reporting a finding, confirm it is actually reachable at runtime. If the "vulnerability" requires modifying source code first, or the language/library already prevents it (e.g., Web Crypto validates GCM auth tags by default), downgrade or drop it. Check whether existing error handling already covers the case.
7. **Calibrate severity.** If a finding requires 3+ assumptions to trigger, it is not critical. If a race condition requires two events in the same millisecond with no real-world trigger, it is not critical.
8. For each finding, state:
   - **What:** the specific issue
   - **Where:** file and line number
   - **Why it matters:** concrete consequence, not abstract principle
   - **Suggested fix:** the simplest change that resolves it
9. Rank findings by severity (critical > warning > nitpick).
10. Before finalizing, check the project docs (CLAUDE.md, architecture.md, operations.md, protocol.md) — if a pattern is described as intentional, downgrade to nitpick at most.

## Severity Guide

- **Critical:** Violated invariants, missing single source of truth where it causes data corruption, trust boundary violations, canonical/derived state confusion that leads to wrong settlement or lost funds. Must have a concrete failure scenario — not a hypothetical.
- **Warning:** Design smells that predict future bugs or slow development — leaky abstractions, high coupling, high blast radius, low modularity, poor extensibility, over-engineering, high structural entropy, mixed policy/mechanism, high change amplification, excessive surface area. These should surface early as warning flags, not be ignored.
- **Nitpick:** Dead code, inconsistent naming, pattern drift from neighboring code, minor duplication that hasn't diverged yet, theoretical issues requiring 3+ assumptions to trigger.

## Agora-Specific Context

These patterns are intentional — do NOT flag them:

- `managed-post-flow.ts` has a multi-step wallet signing chain (publish → permit → create). The indirection is required by the on-chain protocol.
- `guided-state.ts` uses a reducer with many switch cases for each field. This is the standard pattern for the guided interview flow.
- `@agora/common` is a shared foundation package. Many packages importing from it is expected, not high coupling.
- The indexer polls events and writes projections to Supabase. The DB is a cache, not truth — this dual-source pattern is by design.
- `simulateAndWriteContract` wraps viem simulate+write. This abstraction earns its keep for error handling.
- The worker/orchestrator/executor split is intentional architecture, not over-engineering.
- In-memory rate limiting on low-traffic endpoints (e.g., `pin-spec`) is a conscious trade-off.
- `sealed_submission_v2` format naming is versioned by design, not drift.
- Deprecated tables coexisting with replacements during migration windows is transitional, not schema bloat.

**General rule:** Before flagging a pattern, check if project docs (CLAUDE.md, architecture.md, operations.md, protocol.md) describe it as intentional. If so, do not flag it.

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
