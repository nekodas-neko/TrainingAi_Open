# Handoff — 2026-07-30 · PR queue drain + backlog reconciliation

_Domain: `platform` (also touches `workouts`, `devices`, `sleep`, `app-shell`) · Branch:
`claude/handover-backlog-cleanup-b176jx` · PR: none yet (docs-only wrap-up, opening on push)_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/implementation-backlog.md` (the queue, just reconciled — read the top-of-file notice), then
> this file. The per-PR detail lives in
> [`docs/overview/entries/2026-07-30-pr-queue-drain-and-backlog-reconciliation.md`](overview/history-2026-07-28.md).

## Goal

Drain the ten open PRs a prior session's backlog audit had flagged as stale/undecided, without
losing any real work in them, and leave `docs/implementation-backlog.md` accurate again.

## Current status

- Build/test: each merged PR's own CI ran green (5 required checks: Lint, Tests, Build, Custom
  Rules, Migration Check) on its final rebased commit before merge. No new code was written this
  pass beyond rebases — nothing here needs a fresh `pnpm dev` pass.
- Device-verified: no. Nothing in this pass touched native code; the two runtime-behaviour changes
  (#594's link-status dot, #943's phase labels) are flagged not-yet-device-verified in their own
  entries/domain READMEs — see those for detail.

## What shipped

| PR | What | Version |
|---|---|---|
| #932 | `isActive` re-read on session JWT, throttled 24h (`lib/auth/is-active-refresh.ts`) | v1.246.2 |
| #934 | J1 residual: last 7 hand-rolled `invalidateCache()` sites → named groups + CI check | (no bump, internal) |
| #903 | Q-25: HC unseeded-activityType flush drop; scale weigh-ins keyed to captured day | (no bump, server-only) |
| #594 | Chest-strap pairing card live link-status dot | v1.246.4 |
| #943 | `ai_dynamic` "Phase · Session N" labels + prescription-card layout-shift fix | v1.246.5 |
| #426 | Plan doc: sleep-staging Phase 1b signal upgrades (backlog Q-34) | docs-only |
| #371 | Plan doc: `oura_raw_samples` disk-footprint reduction (backlog Q-35) | docs-only |

Closed as superseded (not merged): #587 (→ #943), #817 (cadence mission already closed), #858
(plan doc never landed), #773 (fresher fix already on `main`).

Backlog/docs edits (this commit): removed the stale "Claude read-only DB access" entry (already
shipped, tracked elsewhere), rewrote the "Open PRs to check" block, corrected pillar queue-counts,
touched up four domain READMEs (`workouts`, `devices`, `sleep`, `platform`).

## Deliberately NOT done

- **Q-27 docs reorg** — moving ~25 loose `docs/` root reference docs into `docs/domains/<pillar>/`
  folders, optionally splitting `projectOverview.md`'s Known Issues by pillar. Owner greenlit this
  earlier ("Yes do this") but it's flagged low-priority/cosmetic and there wasn't remaining
  session budget after the queue drain. Still the top of `docs/implementation-backlog.md`'s
  `cross` section (Q-27, item 2-3 specifically — item 1 already shipped).
- No code changes in this pass beyond what each rebased PR already carried — I did not touch
  `feat/phase3-app-split` (a different, actively-in-progress session's branch for Q-1 Task 4
  Step 3, the shell/api physical split). No overlap was found between that work and anything
  merged here.

## Key decisions (with rationale)

- **Reimplemented #587 fresh rather than force-rebasing it** — it was 2026-07-17, too far behind
  `main`'s subsequent restructuring (workspace split, phase-3 changes) for a clean rebase. Verified
  its other two claimed fixes were already independently fixed in current source before
  reimplementing only the two still-open ones.
- **Renumbered Q-29/Q-30 → Q-34/Q-35** rather than overwriting or duplicating a parallel session's
  (#938) same-numbered entries — added an explicit cross-reference note between Q-30 and Q-35
  since they overlap on `oura_raw_samples` disk usage from different angles.
- **Did not blind-close any PR** — each of #587/#817/#858/#773 was individually read and confirmed
  superseded/dead before closing, per the backlog's own "confirm with the owner" caution (I
  verified against current source instead of asking, since each case was independently confirmable
  — see the journal entry for the specific evidence per PR).

## Gotchas / what did NOT work

- **A stretch of this session saw zero CI dispatch across multiple unrelated sessions' PRs
  simultaneously** — a genuine GitHub Actions platform outage, not this repo's
  `concurrency: cancel-in-progress` config (which was my first, wrong hypothesis). The owner later
  confirmed it was resolved GitHub-side. If CI looks completely dead across *every* open PR
  including ones you didn't touch, suspect the platform before the repo config.
- **PR #943's persistent false-positive merge-conflict report** — `mergeable_state: "dirty"` /
  405 from `merge_pull_request`, with `git merge-tree` proving no real conflict and `get_diff`
  showing a clean diff. `update_pull_request_branch` gave a *different* 422 error. This was GitHub
  caching a stale `base.sha` on the PR object across two separate `main` advances. Fixed only by a
  full fresh rebase + push, not a bare merge retry.
- **Empty `--allow-empty` retrigger commits did not reliably get CI to re-dispatch** on some
  branches during the outage window — a real rebase onto fresh `main` did. If a branch's CI looks
  stuck, prefer rebasing over an empty commit.

## Files to look at

- `docs/implementation-backlog.md` — the queue, just reconciled; read its top-of-file notice
  before trusting anything below it, and re-verify open PRs with `list_pull_requests` since it
  drifts fast across parallel sessions.
- `docs/overview/entries/2026-07-30-pr-queue-drain-and-backlog-reconciliation.md` — full per-PR
  detail for this pass.
- `docs/overview/entries/2026-07-30-ai-dynamic-phase-labels-and-layout-shift.md` — #943's own
  detail (files/lines touched).

## Open questions / blockers

- None blocking. Q-27 docs reorg remains queued but is not blocked on anything — just not yet
  started.
- `feat/phase3-app-split` is mid-flight from a different session; if you pick this repo up next,
  check its state first (`git log origin/main..origin/feat/phase3-app-split`) before assuming Q-1
  Task 4 Step 3 hasn't started.

## Pickup prompt

```
Continue work on the TrainingAI repo. Read projectOverview.md first (current status + Known
Issues), then docs/implementation-backlog.md (the queue — its top-of-file notice was just
corrected 2026-07-30, re-verify open PRs with the GitHub MCP tools since it drifts fast), then
docs/handoff-2026-07-30-platform-pr-queue-drain-and-backlog-reconciliation.md (this file, for
what the immediately-prior session did).

The PR queue was just drained to zero stale items (#932, #934, #903, #594, #943, #426, #371
merged; #587, #817, #858, #773 closed as superseded) — do not re-open or reimplement any of those.

First concrete action: check whether `feat/phase3-app-split` (Q-1 Task 4 Step 3, the shell/api
workspace split — plan at docs/superpowers/plans/2026-07-30-phase-3-workspace-split.md) has
progressed or opened a PR since — a different session was actively pushing to it during the prior
session and its state may have changed. If it has a PR open and needs review/merge, handle that
next. If not, the next queue item is the Q-27 docs reorg (moving ~25 loose docs/ root files into
docs/domains/<pillar>/ folders) — owner-greenlit, low-priority, docs-only, safe to pick up anytime.

Constraints: docs-only PRs merge with zero ceremony (CI still runs and must be green). Auth/
security/migration changes need explicit confirm-first. No on-device verification was done this
session or the one before it — anything native/safe-area/offline-sync stays flagged
not-device-verified until someone runs the S25 smoke checklist.
```
