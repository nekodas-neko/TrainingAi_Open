## Offline-first direction — consolidated three parallel threads (docs-only)

Owner asked to combine what several parallel 2026-07-30 sessions had learned about the
offline-first/APK-offline-build direction into one continuing effort, rather than have them land as
separate uncoordinated PRs. Two threads existed on unmerged branches
(`fix/deactivation-claim-refresh` / PR #932, and `claude/github-public-migration-0u4r7m`), and this
session found a third, larger one already in progress that neither had cross-referenced: the Oura
on-device + own-analysis program (D0–D7, planned 2026-07-21, ~40% shipped).

**Docs-only — no application code changed.**

- Brought `docs/offline-first-target-architecture.md` onto this branch and corrected its "Oura
  rollup" section: it originally asked for a new plan; one already exists
  (`docs/oura-ondevice-hybrid-handover.md` → the D0–D7 master plan) and is ~40% shipped, blocked on
  one owner action (on-device APK verification, open since 2026-07-27). Added a cross-reference
  between the DB-volume handover's recommended `bytea` migration and the Oura program's own D4
  owner-decision table (O1), which are mutually exclusive and were never reconciled by either
  source session.
- New plan: `docs/superpowers/plans/2026-07-30-phase-3-workspace-split.md` — the one piece none of
  the three threads had actually written. Concrete steps for Phase 3 Task 4 option B (workspace +
  shared `lib/` package → `shell/`/`api/` app split → the `output: 'export'` flip), including the
  trust-boundary split inside `lib/` (isomorphic / server-only / client-only) and the CI
  custom-rule-script path updates a naive move would silently break.
- Reconciled `docs/implementation-backlog.md`: both source branches independently claimed Q-29 for
  different things on the same calendar day. Renumbered — Q-29 now correctly points at the existing
  Oura on-device program instead of asking for a duplicate plan; Q-30 (DB volume) keeps its number
  with the new O1 cross-reference; Q-31 is D8 (renumbered); Q-32 is the public-repo-cut mechanics,
  split into its own entry. Corrected the stale "auth fix remains" block to reflect PR #932's actual
  open/CI-green/not-merged state.
- Fixed a real, pre-existing bug in `docs/domains/devices/README.md`: it mislabeled the live Oura
  on-device planning baton and progress doc as "superseded, kept for the trail" alongside a
  genuinely dead doc they themselves supersede — plausibly why the first source thread never found
  the program despite it living in the domain it would have read.
- Updated `projectOverview.md` Current Status, and the `app-shell`/`platform`/`devices` domain
  READMEs with the new cross-links.
- Brought both source branches' handoff docs across as historical record (properly dated, now
  linked from the domain indexes):
  `docs/handoff-2026-07-30-app-shell-perf-audit-auth-fixes-and-offline-direction.md`,
  `docs/handoff-2026-07-30-platform-public-repo-migration-gated-on-apk-offline-build.md`.
- Wrote the consolidated handoff:
  `docs/handoff-2026-07-30-platform-offline-first-consolidation.md` — full narrative, key decisions,
  gotchas (the Q-29 collision is a live example of the exact "claim backlog IDs against open
  PRs/branches" discipline both source handoffs separately warned about, that still happened), and
  a pickup prompt asking the owner to prioritize between three independent workstreams: the Oura
  program's blocking device-verification action, the Phase 3 workspace split, or the DB-volume O1
  decision.

## Not done this session

- No code. Not the workspace split, Task 3, D8, the DB migration, or the repo cut — planning/
  reconciliation only, per the backlog-driven plan-now-build-later protocol.
- PR #932 (the isActive 24h re-read) was **not merged** — CI green, but it's an auth-boundary change
  and this session did not have explicit confirmation to merge it this turn.
- The Q-30 O1 tension (bytea-now vs wait-for-D4) was surfaced, not resolved — a real owner tradeoff,
  not an implementer call.
