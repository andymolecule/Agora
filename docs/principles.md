# Agora Principles

## Purpose

State the properties Agora is trying to preserve across product, protocol, and operations decisions.

## Audience

Founders, engineers, designers, operators, reviewers, and contributors deciding what Agora should be.

## Read this after

- [Product Guide](product.md) — what Agora is and why it exists
- [Protocol](protocol.md) — the on-chain rules and lifecycle
- [Submission Privacy](submission-privacy.md) — the privacy and trust boundary

## Source of truth

This doc is authoritative for: product principles, public positioning guardrails, and the plain-language trust model Agora should claim. It is not authoritative for: contract implementation details, API behavior, database schema, or deployment procedures.

## Summary

- Agora is a neutral bounty market for computational science.
- Participation should be permissionless; settlement should be trustless; scoring should be progressively more trust-minimized over time.
- The current honest framing is: permissionless participation, semi-trusted official scoring, trustless on-chain settlement.
- Agora should reduce operator discretion, not hide it behind vague decentralization language.
- Every feature should preserve fixed rules, escrowed rewards, hidden live submissions, deterministic scoring, and public verifiability.

## Agora In One Sentence

Agora is an on-chain bounty protocol where anyone can post a computational science problem, anyone can compete to solve it, results are scored under precommitted rules, and rewards settle from escrow on-chain.

## Core Commitments

### 1. Neutrality

Agora should not decide winners by taste, relationship, or manual judgment. A challenge should be governed by a fixed spec, a fixed scorer, a fixed deadline, and fixed payout rules established before submissions open.

### 2. Permissionless Participation

Anyone should be able to post, solve, verify, and finalize within the protocol rules without needing case-by-case approval from Agora.

### 3. Deterministic Evaluation

Winning should come from reproducible computation. The same scorer, inputs, and environment should produce the same output every time.

### 4. Fair Competition

Submissions should remain hidden while a challenge is open so solvers compete on original work rather than copied answers. Once scoring begins, reproducibility should dominate: proof bundles and replay artifacts may become public for verification.

### 5. Trust-Minimized Settlement

Rewards should be locked before work starts and distributed by contract rules after scoring. Human or operator discretion should not control custody of funds once a challenge is live.

## Honest Trust Model

Agora should describe itself precisely:

- `Permissionless participation`: yes
- `Trustless settlement`: yes
- `Publicly verifiable outcomes`: yes
- `Fully trustless scoring`: no, not yet

Today the official scoring path is still semi-trusted because Agora infrastructure holds the sealing key, decrypts submissions after the deadline, runs the canonical scorer, and posts scores on-chain. That is acceptable for the MVP if it is stated plainly and paired with strong auditability.

The correct short description today is:

`Permissionless participation, semi-trusted scoring, trustless settlement.`

## Claims To Make Carefully

Claims Agora can make today:

- Anyone can post a challenge and escrow real rewards on-chain.
- Anyone can submit during the open phase under the same published rules.
- Answer bytes stay hidden from the public while the challenge is open.
- Anyone can verify official scores after scoring begins by rerunning the deterministic scorer.
- Funds are distributed by contract logic, not by an off-chain payout spreadsheet.

Claims Agora should avoid for now:

- "Fully decentralized scoring"
- "Zero-trust end to end"
- "Permanent submission secrecy"
- "No trusted operators"

Overclaiming weakens the product. Precise claims strengthen it.

## The Non-Negotiable Invariants

Every major product or protocol decision should preserve these invariants:

1. Rules are fixed before submissions open.
2. Rewards are escrowed before solvers begin work.
3. Submissions are hidden during the live competition window.
4. Winners are determined by deterministic evaluation, not discretionary judgment.
5. Anyone can inspect, verify, and trigger the permitted lifecycle actions after the relevant deadlines.

If a proposed feature breaks one of these, it should be treated as a protocol-level change, not a routine product tweak.

## Starting Point For The MVP

The first version of Agora does not need to solve every decentralization problem. It needs to be the best system for credibly neutral scientific competitions with deterministic payout.

That means the MVP should optimize for:

- clear challenge specs
- simple posting and submission flows
- deterministic Docker scoring
- strong public verification artifacts
- reliable on-chain escrow and payout
- explicit trust boundaries

The MVP should not optimize for:

- governance complexity
- speculative token mechanics
- social reputation systems before finalized outcomes exist
- fully decentralized orchestration before the single-operator path is reliable
- broad marketplace sprawl beyond computational science bounties

## Decision Filter

When evaluating a feature, ask:

1. Does this reduce or increase operator discretion?
2. Does this make challenge rules clearer before the competition starts?
3. Does this improve fairness during the open phase?
4. Does this improve reproducibility after scoring begins?
5. Does this strengthen trustless settlement or merely add surface area?

If the answer is mostly "more surface area," do not build it yet.
