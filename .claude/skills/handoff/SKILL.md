---
name: handoff
description: Write or update the session's handoff doc in docs/ so a fresh session (or a different agent) can pick up exactly where this one left off. Use when context is getting full, when switching sessions/agents, when the context-usage hook warns, when the user says the session is wrapping up, or when the user says "handoff", "hand this off", "write a handoff", or "save context before I switch".
version: 2.0.0
---

# Session Handoff

Produce a single, self-contained handoff doc at
**`docs/handoff-YYYY-MM-DD-<domain>-<descriptive-title>.md`** that lets the next session resume
with **zero** re-discovery. It is the *per-session record* companion to the durable
`projectOverview.md` — projectOverview is the standing index; a handoff doc says what one
session did, decided, and left behind.

**There is exactly one handoff mechanism: dated, domain-tagged files in `docs/`.** Do not write a
root `HANDOFF.md` — that convention is retired and its files were folded into `docs/`.

### The filename

`docs/handoff-<YYYY-MM-DD>-<domain>-<descriptive-title>.md`

- **`<domain>`** is one slug from [`docs/domains/README.md`](../../../docs/domains/README.md):
  `sleep` · `readiness` · `heart-rate` · `cardio` · `activity` · `workouts` · `nutrition` ·
  `body` · `devices` · `app-shell` · `platform` (or `cross` for genuinely app-wide work).
  Pick the **primary** domain — the one an agent would be working in when it needs this doc — and
  list any others in the doc header. This is what makes `ls docs/handoff-*-sleep-*.md` a complete
  answer to "what do we already know about sleep work".
- **`<descriptive-title>`** describes the *work*, not the session.

Example: `docs/handoff-2026-07-30-sleep-nap-vs-night-resolution.md`

Before writing, read that domain's index (`docs/domains/<domain>/README.md`) — it tells you which
reference docs and open issues the handoff should link rather than restate.

## Why this matters in THIS repo (read before writing)

Claude Code on the web runs in an **ephemeral container that clones the repo fresh each
session**. A handoff that only lives on disk vanishes when the container is reclaimed.
**So the handoff only works if it is committed and pushed to the working branch** — the next
session checks out that branch (or `main`, once merged) and reads it. An uncommitted handoff
is a lost handoff.

## Steps

1. **Pick the primary domain, then look for an existing handoff for this line of work** —
   `ls docs/handoff-*-<domain>-*.md` (and `ls docs/handoff-*.md` for anything predating the
   domain convention). If this session already wrote one, **update that file** rather than adding
   a second doc for the same work. Start a new file only for genuinely new work.
2. **Gather live state** — don't guess:
   - `git status --short` and `git branch --show-current` (branch + dirty/clean).
   - `git log --oneline -8` (recent commits on this branch).
   - CI / PR state if a PR is open (via the GitHub MCP tools).
   - Whether `pnpm dev` / tests / typecheck were last run and their result — state it honestly, including anything **not** verified (per CLAUDE.md's "state which failure surfaces were NOT exercised" rule; device-only paths count).
3. **Write the doc** using the template below. Be specific: "Changed rest-timer floor from 60s→90s in `components/workout/active-workout-screen.tsx:212`", never "fixed the timer".
4. **Write the `## Pickup prompt` section last** — a block the user can paste verbatim into a cold session. No "see above", no references to the current chat.
5. **Commit and push to the current feature branch** (never `main`): `git add docs/handoff-*.md && git commit && git push -u origin <branch>`. This is the step that makes the handoff survive into the next session. If a PR is already open for this branch, the handoff rides in that PR — don't open a second one.
6. **Tell the user the branch name and repeat the pickup prompt in the chat reply.**

## Template

```markdown
# Handoff — <YYYY-MM-DD> · <short work title>

_Domain: `<primary>` (also touches `<other>`, `<other>`) · Branch: `<branch>` · PR: <#num + state, or "none yet">_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/<primary>/README.md` (that pillar's code, docs and open issues), then
> `docs/implementation-backlog.md` (the queue). This file covers only what *this* session did
> and what it leaves behind.

## Goal
<One or two sentences: what this line of work is trying to achieve and why.>

## Current status
- Build/test: <e.g. "pnpm dev green, exercised /api/log-exercise + workout flow" — or "typecheck only, dev NOT run">
- Device-verified: <yes / no — which native/safe-area/offline paths are unverified>

## What shipped
- <Concrete change + PR number + migration number + file:line. One bullet (or table row) per real change.>

## Deliberately NOT done
- <Scope consciously left out, and why — so it isn't mistaken for an oversight.>

## Key decisions (with rationale)
- <Decision → why. So the next agent doesn't re-litigate it.>

## Gotchas / what did NOT work
- <Dead ends, failed approaches, traps — so they aren't repeated.>

## Files to look at
- `<path>` — <why it matters>

## Open questions / blockers
- <Anything waiting on the owner or unresolved.>

## Pickup prompt

<Paste-ready block for a fresh session: the branch to check out, the docs to read and in what
order, the very first concrete action, and the constraints that would otherwise be
re-discovered (device-verification gate, open PR state, anything waiting on the owner).>
```

## Rules

- **`projectOverview.md` and `CLAUDE.md` remain the source of standing truth** — a handoff points at one session's work; it does not duplicate the project index or the standing rules.
- **Honesty over optimism**: never write "fixed"/"done" for anything not in the committed diff and observed working (CLAUDE.md: "Never mark an issue fixed from intent"). Unverified device paths are called out, not omitted.
- **A handoff doc is a durable record, not scaffolding** — it merges to `main` with the work and stays. Because the filename is dated and the content is written in the past tense of one session, it ages into history rather than becoming a stale instruction. Don't delete or blank it after the merge.
- **Never two docs for one line of work** — update the existing file instead. If a later session continues the work, it writes its own dated doc and links back to the previous one.
- **Running history belongs in `docs/overview/entries/`, not here.** Keep a handoff to what the next agent needs; it is not the session journal.
- **Link the handoff from its domain index** — add a line to `docs/domains/<domain>/README.md` under History in the same commit, so the pillar index stays a complete answer.
- When a handoff is written as part of the full **Session Wrap-Up** ritual (CLAUDE.md), the documentation-cleanup pass and the `projectOverview.md` handoff pointer are part of that ritual — this skill covers the doc itself.
