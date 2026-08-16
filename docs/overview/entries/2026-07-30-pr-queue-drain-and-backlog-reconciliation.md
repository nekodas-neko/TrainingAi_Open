## 2026-07-30 — Queue drain: five long-stale PRs merged, three closed, backlog reconciled

Continuation of an earlier session's backlog cleanup (see the sibling entry
[`2026-07-30-handover-backlog-cleanup.md`](2026-07-30-handover-backlog-cleanup.md) for the docs
audit + bundled bug-fix PR #922 and the meal-type-mirror PR #926 that preceded this one). This
entry covers the second half: draining the ten open PRs the earlier audit had flagged in
`docs/implementation-backlog.md`'s "Open PRs to check" list.

### Merged (all squash, each rebased onto fresh `main` immediately before merge)

- **#932** — `isActive` re-read on the session JWT, throttled to once/24h
  (`lib/auth/is-active-refresh.ts`). Auth-boundary change, confirm-first per policy; owner-approved
  earlier in this line of work. v1.246.2.
- **#934** — J1 residual: migrated the last 7 hand-rolled `invalidateCache()` call sites to named
  groups, added the CI Custom Rules check enforcing it going forward.
- **#903** — Q-25: ingest fixes (an unseeded Health Connect `activityType` no longer drops the
  whole flush; scale weigh-ins now file under the day they were actually captured, not the day
  they synced).
- **#594** — chest-strap pairing card shows a live link-status dot (`getChestStrapLinkStatus()`,
  1 Hz poll, `components/settings/chest-strap-pairing.tsx`). v1.246.4. Original PR from
  2026-07-17; only needed a rebase, no code changes.
- **#943** — `ai_dynamic` phase labels ("Phase · Session N" instead of a meaningless "Cycle 1/1")
  + pre-workout AI-prescription-card layout-shift fix. v1.246.5. Original PR #587 (2026-07-17) was
  too far behind `main` to rebase cleanly, so its two still-open bugs were reimplemented fresh; see
  [`2026-07-30-ai-dynamic-phase-labels-and-layout-shift.md`](2026-07-30-ai-dynamic-phase-labels-and-layout-shift.md)
  for the detail.
- **#426**, **#371** — two docs-only plan PRs (sleep-staging Phase 1b signal upgrades; Oura
  `oura_raw_samples` disk-footprint reduction). Landed as backlog Q-34 and Q-35 respectively; no
  version bump (docs-only).

### Closed as superseded (not merged)

- **#587** — superseded by #943 (above); its other two claimed fixes (food-sync FK enum gap,
  timer status-bar chip warm-up/bar-load extension) were already independently fixed elsewhere in
  the tree — verified by reading current source, not assumed from the PR description.
- **#817** — the cadence-metric investigation's own closing PR; the five-PR mission it closed had
  already concluded and is already reflected in `projectOverview.md`.
- **#858** — docs-only cardio zone-gap-picker plan; its plan doc never actually landed on disk
  despite the PR diff claiming it did.
- **#773** — a stale (~90 commits behind) fix for the activity-store stale-`active`-mode runaway
  timer bug; a fresh version of the same fix had already shipped on `main` under a different PR.

### Backlog Q-number collision with a parallel session

A different, concurrent session's PR (#938, docs consolidation) claimed Q-29 through Q-32 for
unrelated topics (Oura on-device rollup migration, DB volume, two blocked items) in the same
window this session was adding its own Q-29/Q-30 entries (sleep-staging Phase 1b,
`oura_raw_samples` disk footprint). Resolved by renumbering this session's entries to **Q-34** and
**Q-35**, with a cross-reference note between Q-30 and Q-35 since both touch `oura_raw_samples`
disk usage from different angles (a bytea column-type migration vs. a separate `body_hex_hash`
generated column) — flagged so a future session checks which landed first rather than building
both blind.

### Other docs cleanup folded in

- Removed a fully-stale backlog entry, "Claude read-only production-DB access — BLOCKED on owner
  decisions." The feature actually shipped in full (route, six `claude_ro`-view migrations, tests,
  a dedicated readonly-role client) and is already correctly tracked as a live, beta-only-approved
  Known Issues row in `projectOverview.md` — the backlog entry was simply never removed after the
  work landed.
- Rewrote the top-of-file "Open PRs to check" block, which listed all ten PRs above as still open.
- Corrected the per-pillar queue-count line (now `platform 6 · readiness 3 · devices 5 · workouts 2
  · sleep 3 · app-shell 2 · heart-rate 1 · cross 1`).
- Domain-index touch-ups: `docs/domains/workouts/README.md` (new open-issue line + journal link for
  the phase-label fix), `docs/domains/devices/README.md` (strap link-status card),
  `docs/domains/sleep/README.md` (Q-34 queue-count fix + open-issue line),
  `docs/domains/platform/README.md` (queue-count fix).

### A GitHub platform quirk worth recording

PR #943 repeatedly reported `mergeable_state: "dirty"` and a 405 "merge conflicts" error from
`merge_pull_request`, despite `git merge-tree` (run twice, at different points) showing zero real
conflicts against current `main`, and `pull_request_read get_diff` showing a clean, sensible diff.
`update_pull_request_branch` itself failed with a *different* error (422). Root cause: the PR
object's own `base.sha` field stayed frozen at an older `main` commit even after `main` had moved
twice past it — a GitHub-side metadata-refresh lag, not a real conflict. Resolved by doing one
more full rebase + force-push cycle (not a bare retry), after which the merge succeeded normally.
Also observed, separately: a multi-hour window where CI dispatched zero check runs across several
unrelated sessions' PRs simultaneously (a genuine platform-side Actions outage, not this repo's
concurrency-cancel config), which the owner later confirmed was resolved GitHub-side.

### Verification

Each merged PR's own verification is documented in its own commit/journal entry (see the linked
entry above for #943's detail). #932/#934/#903/#594 carried their original PR verification through
the rebase unchanged — none needed code changes, only a rebase onto current `main`, and all five
required CI checks (Lint, Tests, Build, Custom Rules, Migration Check) were re-run and green on
each PR's final pushed commit before merge. This entry's own contribution is docs-only:
`node scripts/check-doc-links.js` passes (666 files) after every edit above.

### Not done this session

- **Q-27 docs reorg** (moving ~25 loose `docs/` root reference docs into pillar folders under
  `docs/domains/`) — still queued, not started. Flagged as optional/cosmetic by the owner earlier;
  see the handoff doc for the pickup point.
- A separate, actively-in-progress session was observed pushing to `feat/phase3-app-split`
  (Q-1 Task 4 Step 3, the shell/api physical split — `docs/superpowers/plans/2026-07-30-phase-3-workspace-split.md`)
  throughout this session — no overlap with anything above; left untouched.
