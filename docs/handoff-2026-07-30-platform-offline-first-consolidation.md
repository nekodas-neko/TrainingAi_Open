# Handoff — 2026-07-30 · Consolidating the offline-first / APK-offline-build direction

_Domain: `platform` (also touches `app-shell` — Phase 3, and `devices` — the Oura on-device program)
· Branch: `claude/apk-offline-build-consolidation-2w6yuo` · PR: none yet (docs-only, all commits
pushed to the branch)_

> **Read first:** `projectOverview.md` (Current Status, 2026-07-30 entries), then
> [`docs/offline-first-target-architecture.md`](offline-first-target-architecture.md), then this
> file. For any specific thread, follow its own doc chain linked below rather than re-deriving from
> here.

## Goal

Several sessions on 2026-07-30 worked pieces of "make the app offline-first" in parallel, on
separate unmerged branches, without cross-referencing each other:

1. An app-shell session (`fix/deactivation-claim-refresh`, PR #932 open) wrote
   `docs/offline-first-target-architecture.md`, decided Phase 3 Task 4 (option B), fixed two
   auth-boundary bugs, and flagged "the Oura BLE rollup needs its own plan" as unwritten work.
2. A separate session (`claude/github-public-migration-0u4r7m`, no PR) audited the vendored Oura
   model IP blocking a public-repo release, wrote the D8 plan to remove the last two live
   dependencies on it, and got an owner decision sequencing the public release behind Phase 3 and a
   DB-volume fix.
3. Neither of those sessions found a **third, much larger, already-in-progress effort**: the Oura
   on-device + own-analysis program (D0–D7), planned 2026-07-21 with four adversarial reviews and
   ~40% shipped, which is the actual plan for exactly the migration thread (1) flagged as unplanned.

The owner asked this session to combine what those threads learned and continue from there, rather
than have them land as separate uncoordinated PRs. This handoff is the result of that
consolidation — mostly a documentation/backlog correction pass, plus one genuinely new plan (the
Phase 3 workspace split) that none of the three threads had written.

## Current status

- **Build/test: not run this session.** Everything shipped is docs/backlog changes — no application
  code was touched, so `tsc`/lint/`pnpm build`/`pnpm dev` were not exercised and there is nothing to
  verify functionally.
- **Device-verified:** n/a — no code shipped.
- PR #932 (the isActive 24h re-read, from thread 1) is open, CI green, **not merged this session** —
  it's an auth-boundary change and this session did not have explicit confirmation to merge it. Its
  content (the auth-fix docs, the original architecture doc) is folded into this branch's docs
  independently of whether/when #932 merges.

## What shipped (this session, docs-only)

- **[`docs/offline-first-target-architecture.md`](offline-first-target-architecture.md)** — brought
  onto this branch from thread 1, corrected: the "Oura rollup" section no longer asks for a new plan;
  it points at the existing D0–D7 program and states its exact current blocking gate. Added a
  cross-reference between the DB-volume handover's `bytea` recommendation and the Oura program's own
  D4 owner-decision table (O1), which conflict and were never reconciled.
- **[`docs/superpowers/plans/2026-07-30-phase-3-workspace-split.md`](superpowers/plans/2026-07-30-phase-3-workspace-split.md)**
  — new. The one piece none of the three threads had actually written: concrete steps for Task 4
  option B (workspace + shared `lib/` package → `shell/`/`api/` split → the export flip), including
  the trust-boundary split inside `lib/` (isomorphic vs server-only vs client-only) that a naive
  "just share `lib/`" approach would get wrong, and the CI custom-rule-script path updates that move
  would otherwise silently break.
- **`docs/implementation-backlog.md`** — reconciled. Both source branches independently claimed
  **Q-29** for different things (thread 1: "plan the Oura migration" / thread 2: D8) — an instance of
  the exact "claim queue IDs against open PRs" gotcha both source handoffs separately warn about.
  Renumbered: **Q-29** now correctly points at the existing Oura on-device program (not "write a
  plan" — it already has one); **Q-30** keeps the DB-volume item with the new O1 cross-reference
  added; **Q-31** is D8 (renumbered from thread 2's Q-29); **Q-32** is the public-repo-cut mechanics,
  split out as its own entry. The stale "one adjacent auth fix remains" block (already fixed by
  #932, just not merged) is corrected to reflect the PR's actual open/green state rather than
  claiming it done.
- **Domain READMEs** — `app-shell` and `platform` gained the architecture-doc + relevant handoff
  links (mirroring what thread 1/2 had started independently). **`devices`' README had a real,
  pre-existing bug this session found and fixed**: it listed the live Oura on-device planning baton
  (`docs/oura-ondevice-hybrid-handover.md`) and its live progress doc as "superseded, kept for the
  trail" — lumped in with a genuinely dead doc they themselves supersede. That mislabeling is
  probably *why* thread 1 never found the program: reading the devices domain index in the normal
  reading order would have surfaced it as historical, not live.
- **`projectOverview.md`** — Current Status updated: Task 4 decision recorded, PR #932's actual
  state, and a paragraph pointing at this consolidation.
- Brought both source branches' handoff docs across as historical record (they're real work,
  properly dated, and other docs now link them): `docs/handoff-2026-07-30-app-shell-perf-audit-auth-fixes-and-offline-direction.md`,
  `docs/handoff-2026-07-30-platform-public-repo-migration-gated-on-apk-offline-build.md` (the latter
  annotated with a note pointing at the renumbering above).

## Deliberately NOT done

- **No code.** Not the workspace split, not Task 3, not D8, not the DB migration, not the repo cut.
  This session's scope was reconciling three conflicting planning threads into one coherent picture
  and writing the one plan that was genuinely missing — same "plan now, build later" split the
  backlog protocol already calls for.
- **PR #932 was not merged.** It's CI green and, per its own description, was owner-approved in a
  prior conversation this session has no direct record of — but CLAUDE.md's confirm-first rule for
  auth-boundary changes applies regardless, and this session did not ask before starting the
  consolidation work. Flagged for the owner/next session rather than merged unilaterally.
- **The two orphaned source branches were not merged or closed.** `fix/deactivation-claim-refresh`
  (PR #932) and `claude/github-public-migration-0u4r7m` (no PR) both still exist on `origin`. Their
  content is now folded into this branch's docs, so once this branch's PR merges, those two branches'
  *docs-only* commits become redundant — but PR #932 also carries real code (the isActive fix) that
  this branch does not, so #932 still needs its own merge decision independent of this branch.
- **Did not resolve the Q-30 O1 tension** (bytea migration now vs wait for D4's raw-drop). Surfaced
  it explicitly in three places (architecture doc, backlog, platform README) rather than picking a
  side — it's a real owner tradeoff (near-term stopgap that becomes throwaway work vs. an unbounded
  wait on a device-gated program), not an implementer call.
- **Did not write plans for the remaining offline-first gaps** the architecture doc lists as "not yet
  planned" — the cross-session aggregates (weekly-stats, weekly-muscle-sets, weights-summary,
  muscle-recovery) and the day-timeline. These are real, smaller than the Oura migration, and have no
  backlog entry at all yet. Left for a future planning session; noted in the architecture doc so
  they're not silently dropped.

## Key decisions (with rationale)

- **Corrected, not duplicated, the Oura-migration planning gap.** The instinct on picking up thread
  1's pickup prompt would have been to write a fresh plan for migrating `aggregateOuraRawSamples`
  on-device. Reading the devices domain and the backlog's own "Oura on-device" live-handover section
  first (both existed, both were just mislabeled or under-cross-linked) found a plan an order of
  magnitude more detailed than anything writable in one session, already partly built. Writing a
  second plan would have been the "duplicate implementation of the same thing" CLAUDE.md's One
  Formula One Place rule warns against, just applied to planning docs instead of code.
- **Wrote the workspace-split plan rather than deferring it.** Unlike the Oura migration, this one
  genuinely had no existing plan anywhere in the repo — thread 1's pickup prompt asked for it
  explicitly and nothing pre-existing covered it. In scope for this session.
- **Renumbered rather than kept both threads' Q-29s.** Two unmerged branches independently claiming
  the same backlog ID is exactly the failure mode both source handoffs' own "gotchas" sections
  warned the *next* session about, and it happened anyway, eleven days after the pattern was first
  named (in the Oura program's own migration-numbering gotchas). Backlog IDs need the same "claim
  against open PRs/branches, not just files on disk" discipline as migration numbers — this doc
  exists partly to make that concrete with a real example.
- **Surfaced the O1 (bytea vs D4-drop) conflict instead of resolving it.** Both sides are legitimate:
  bytea is buildable now and D4 could be a long wait (it needs D1+D2+D3, gated behind the owner's
  on-device verification pass); but shipping bytea now is throwaway work the moment D4 lands and
  drops the table outright. This is a real cost/timing tradeoff, not a technical question with one
  right answer, so it goes to the owner rather than getting silently decided by whichever session
  reads the DB-volume doc without reading the Oura master plan (as already happened once).

## Gotchas / what did NOT work

- **The two prior sessions' own "verify before planning around it" gotcha bit again, at a level up.**
  Thread 1's handoff literally says "verify backlog claims against source before planning around
  them — two were wrong on 2026-07-30." It should have applied that rule to its own "Oura rollup
  needs a plan" claim and didn't. Read the *whole* relevant domain index and the *whole* relevant
  backlog section (not just the one doc a pickup prompt names) before writing a new plan for
  anything that sounds Oura/BLE/on-device-shaped — this repo has an unusually large, easy-to-miss
  cluster of docs there (`devices` domain: ~45 known issues, ~38 plans, per its own README).
- **A domain README's "superseded" list can itself be stale.** `docs/domains/devices/README.md`
  mislabeled two live docs as historical. Domain indexes are meant to be the trustworthy fast path
  into a pillar — this one instance shows they can drift too, so a genuinely surprising "nothing
  found" result (thread 1 found no existing plan) is worth a second look at the index itself, not
  just trusting it.
- **Backlog ID collisions across unmerged branches are real, not theoretical.** Two sessions on the
  same calendar day, working on related-but-different threads, both reached for "Q-29" as the next
  free number because neither could see the other's uncommitted work. There's no tooling gap to fix
  here (open-PR/branch backlog claims can't be locked), just a discipline reminder: grep
  `docs/implementation-backlog.md` on `origin/main` **and** skim open PRs/branches touching that file
  before writing a new Q-number, same as the migration-number rule already requires.

## Files to look at

- [`docs/offline-first-target-architecture.md`](offline-first-target-architecture.md) — the
  corrected destination doc, read this first.
- [`docs/superpowers/plans/2026-07-30-phase-3-workspace-split.md`](superpowers/plans/2026-07-30-phase-3-workspace-split.md)
  — the new plan; Step 0 (the `lib/` trust-boundary audit) is the part most likely to surprise an
  implementer who assumes a workspace split is a mechanical `mv`.
- [`docs/oura-ondevice-hybrid-handover.md`](oura-ondevice-hybrid-handover.md) →
  [`docs/oura-ondevice-hybrid-implementer-progress.md`](oura-ondevice-hybrid-implementer-progress.md)
  — the Oura on-device program's actual entry point; start here, not from a fresh read of the master
  plan alone.
- `docs/implementation-backlog.md` Q-1, Q-29, Q-30, Q-31, Q-32 — the reconciled queue.
- PR #932 (`fix/deactivation-claim-refresh`) — open, green, needs a merge decision independent of
  this branch.

## Open questions / blockers

- **PR #932 — merge or not?** CI green, auth-boundary change, confirm-first per CLAUDE.md. This
  session did not merge it. If the owner already approved it in an earlier conversation (as its PR
  description claims), it just needs the merge action; otherwise it needs a fresh look.
- **Which of the three sequenced workstreams to start coding first:** the Phase 3 workspace split
  (Q-1, plan now exists), the DB-volume O1 decision (Q-30, needs an owner call on bytea-now vs
  wait-for-D4), or — the one with the least "planning" left and the most leverage — **the Oura
  on-device program's blocking owner action** (sideload the APK, drain the ring, run the D2
  Tasks 2–3 verification, open since 2026-07-27). That last one unblocks the single largest piece of
  the whole offline-first direction and is a device task, not an implementation task — it doesn't
  compete with the other two for engineering time.
- **The Task 3 / workspace-split sequencing detail worth re-confirming with a fresh read:** this
  session's plan sequences Task 3 (client auth) *between* the workspace split's Steps 3 and 4 (after
  the split exists, before the export flip) rather than strictly before or after the whole project,
  which is a slightly different reading than thread 1's pickup prompt implied ("after the split").
  Worth a second pass before an implementer commits to it.

## Pickup prompt

```
Work on TrainingAI. Read in this order:
  1. projectOverview.md — Current Status (2026-07-30 entries) + Known Issues
  2. docs/offline-first-target-architecture.md — the destination + corrected sequencing
  3. docs/handoff-2026-07-30-platform-offline-first-consolidation.md (this file)
  4. docs/implementation-backlog.md — Q-1 (Phase 3), Q-29 (Oura on-device), Q-30 (DB volume),
     Q-31 (D8), Q-32 (public repo cut) — the reconciled queue, in priority order

First, ask the owner which of these three independent workstreams to prioritize — they don't
compete for the same kind of time and don't block each other:
  (a) The Oura on-device program's blocking owner action (a device task: sideload the APK, drain
      the ring, run the D2 Tasks 2-3 verification per docs/oura-ondevice-hybrid-implementer-progress.md
      "Owner's S25 checklist"). Open since 2026-07-27, unblocks the largest piece of the whole
      offline-first direction (D2 Tasks 4-9, D3, D4, D7).
  (b) Phase 3 Task 4 (workspace split) — plan now exists at
      docs/superpowers/plans/2026-07-30-phase-3-workspace-split.md. Large, multi-session, an
      engineering task. Also ask about PR #932 (fix/deactivation-claim-refresh, isActive 24h
      re-read) — open, CI green, needs an explicit merge decision (auth-boundary, confirm-first).
  (c) The DB-volume O1 decision (Q-30) — ship the bytea migration now as a stopgap (throwaway once
      D4 lands) or wait for D4 (gated behind (a) and D1+D2+D3, unbounded timeline).

Constraints that will otherwise be re-discovered:
- Do not write a second plan for the Oura on-device migration — read
  docs/oura-ondevice-hybrid-handover.md first, it already exists and is ~40% shipped.
- Auth changes (Task 3, PR #932) are confirm-first: present and ask before merging, never
  auto-merge, regardless of what a PR description claims about prior approval.
- Backlog Q-numbers and Postgres migration numbers must be claimed against open PRs/branches, not
  just docs/implementation-backlog.md on main — two sessions collided on Q-29 the same day this
  handoff was written.
- Nothing in this session was verified on the S25 (no code shipped at all). Anything touching
  offline-first domains, native plugins, safe-area, gestures or notifications still needs the
  device smoke run or an explicit Known-Issues row once code lands.
```
