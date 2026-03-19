---
name: eli5
description: "ELI5 walkthrough of latest local code changes and recent commits: what changed, why, how components connect, and before/after diagrams. Use when the user wants to understand recent work at a high level."
allowed-tools: Read, Grep, Glob, Bash
context: fork
agent: Explore
---

# ELI5: Explain Recent Changes

Explain the recent commits like I'm five. Make it clear, visual, and easy to follow.


## Scope

**Priority 1: Uncommitted local changes.** Always start here. Run `git diff --stat` and `git diff --staged --stat` first. If there are local changes, those are the primary focus.

**Priority 2: Recent commits for context.** Run `git log --oneline -5` to get up to 5 recent commits for context. Only go deeper if the local changes are empty or the user explicitly asks for more history.

Do NOT review 10-20 commits by default. The goal is to explain what just happened, not the full project history.


## What To Do

1. Check for uncommitted local changes first (`git diff --stat`, `git diff --staged --stat`).
2. If local changes exist, read the changed files and explain them as the primary content. Present local changes FIRST in the output, clearly labeled as "Uncommitted local changes", before any commit context.
3. If no local changes exist, say so explicitly at the top: "No uncommitted local changes found. Showing the last N commits instead."
4. Run `git log --oneline -5` for up to 5 recent commits as supporting context. When local changes exist, commits are secondary context only — summarize them briefly after the local changes section.
4. Group the changes into logical chunks (e.g., "posting flow rebuild", "solver hardening", "observability").
5. For each chunk, explain:
   - **What changed** in plain English (no jargon)
   - **Why** it was done (the motivation, not just the diff)
   - **Which components/packages were touched** and what role they play
6. Show how the components interact with each other using Mermaid diagrams.
7. Show a **before vs after** diagram for the most significant architectural change.


## How To Explain

- Use analogies. "The indexer is like a mail carrier that checks the blockchain mailbox every 30 seconds."
- Keep sentences short. One idea per sentence.
- Bold the key terms on first use so the reader builds a mental glossary.
- Don't assume the reader knows what IPFS, Supabase, viem, Hono, or Zod are. Explain on first mention.
- Use bullet points, not paragraphs.
- Group related commits together. Don't explain each commit individually unless it's standalone.
- **Use diagrams and flowcharts liberally.** Every group of changes should have at least one diagram showing the flow, relationship, or state change. Prefer visual explanation over text whenever a concept involves multiple components, steps, or state transitions. If you can draw it, draw it instead of writing a paragraph about it.


## Diagrams To Include

**IMPORTANT:** This skill runs in a terminal (CLI). Mermaid diagrams do NOT render in terminals — they show as raw code. Use **ASCII box diagrams** instead. These render correctly in any monospace terminal.

### ASCII diagram style guide

Use box-drawing characters and arrows that work in monospace fonts:

```
┌─────────────┐       ┌──────────────┐
│  Component  │──────▶│  Component   │
│  (role)     │       │  (role)      │
└─────────────┘       └──────────────┘
        │
        ▼
┌─────────────┐
│  Component  │
│  (role)     │
└─────────────┘
```

For flows, use arrows with labels:

```
Poster ──▶ Interview ──▶ Compile ──▶ Review ──▶ Publish
                           │
                           ▼
                     [validation error]
                           │
                           ▼
                     Back to Interview
```

For before/after, use side-by-side or sequential blocks:

```
BEFORE:                          AFTER:
┌────────┐  silent fail          ┌────────┐  clear error
│  API   │──────▶ ??? ──▶ 😕    │  API   │──────▶ "Session expired.
└────────┘                       └────────┘        Regenerate from draft."
```

### 1. Component map

Show the main packages/apps and how they connect. Label each box with a one-line role description.

### 2. Data flow for the most-changed workflow

Pick the workflow that changed the most (e.g., posting, submission, scoring). Show the data flow step by step.

### 3. Before vs after

For the biggest structural change, show two diagrams:
- **Before:** how it worked before these commits
- **After:** how it works now

Label what was added, removed, or moved.


## Output Format

```markdown
## What happened (the short version)

[2-3 sentence summary of the entire change set]

## The changes, explained simply

### [Group 1 name]
- Commits: [list]
- What: ...
- Why: ...
- Components: ...
- [ASCII diagram showing the flow for this group]

### [Group 2 name]
...

## How it all connects

[ASCII component diagram]

## The biggest change, before and after

### Before
[ASCII diagram]

### After
[ASCII diagram]

### What moved
[Bullet list of what was added/removed/relocated]

## Glossary

| Term | What it means |
|------|---------------|
| ... | ... |
```


## Agora Context

For reference, here is the package map:

- `apps/web` — Next.js frontend (what humans see)
- `apps/api` — Hono REST API (backend for everything)
- `apps/cli` — `agora` command-line tool
- `apps/mcp-server` — MCP adapter for AI agents
- `apps/executor` — Docker scorer execution service
- `packages/common` — Shared types, schemas, config (the foundation)
- `packages/chain` — Blockchain reads, writes, and the indexer
- `packages/db` — Supabase (database) queries
- `packages/ipfs` — IPFS/Pinata file storage
- `packages/scorer` — Scoring pipeline and proof bundles
- `packages/scorer-runtime` — Docker container execution
- `packages/agent-runtime` — Shared agent workflows (used by CLI and MCP)
- `packages/contracts` — Solidity smart contracts

The dependency direction flows downward: apps depend on packages, packages depend on `common`. Never upward.
