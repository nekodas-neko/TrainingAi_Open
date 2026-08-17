# Handoff — 2026-08-17 · Owner bug batch: the one item still open is Q-310

_Domain: `workouts` (also touches `readiness`, `nutrition`, `app-shell`) · Branch:
`docs/session-wrapup-public-repo-prep` · PR: none yet (this doc + doc cleanup)_

> **Read first:** `projectOverview.md` (status + Known Issues — Q-310 has its own row), then
> `docs/domains/workouts/README.md` and `docs/domains/readiness/README.md`, then
> `docs/implementation-backlog.md` (the queue — **only Q-310 is still there**; see below for why).
> This file covers what this session did and what it leaves behind.

## Goal

This session worked five separate owner-reported bugs as they came in, over what turned out to be
several real-world days of elapsed time (screenshots span 2026-08-14 through 2026-08-17) with heavy
parallel-session activity on the same backlog throughout. Four of the five (Q-245, Q-246, Q-247,
Q-248) were investigated and queued by this session, then **picked up and shipped by other,
independent sessions before this wrap-up was written** — confirmed by checking `main` directly, not
assumed. One small, certain bug (the warm-up timer label) was fixed directly in-session rather than
queued. The fifth and most consequential, **Q-310**, is still open: a real prescription/data-
correctness bug where an ai_dynamic deload phase can run at full weight and mint a genuine (wrong)
personal record while its own header still says "Deload."

**This handoff exists mainly to hand off Q-310** — everything else from this session's own work is
already resolved and documented elsewhere (linked below).

## Current status

- Build/test: no `pnpm dev` full walkthrough this session. The one code change made directly
  (the warm-up label, PR #1350) was verified with
  `vitest run packages/shared/src/workout/__tests__/duration-presets.test.ts` (12/12), `eslint`, and
  `tsc --noEmit` on the touched file only. Everything else this session touched was investigation
  and docs, not runtime code.
- Device-verified: **nothing in this session's own work was checked on the S25.** The warm-up label
  fix is a pure display change with no logic change (low risk, unverified). Q-310 explicitly needs
  on-device *and* production-data confirmation before a fix should be attempted — see below.

## What shipped

| # | What | Status |
|---|---|---|
| Q-245 | Nutrition: swiping to a previous day and back to a fresh "today" strands the previous day's food | **Shipped by another session**, PR #1375, v1.317.0. See [`overview/history-2026-08-15.md`](overview/history-2026-08-15.md). ⚠️ Not device-verified (swipe gesture never driven in a real browser). |
| Q-246 | Weekly Training Load bar rendered a real deload day identically to a rest day | **Shipped by another session**, PR #1375, v1.317.0, same journal entry as Q-245. Also fixed an unreported sibling bug found during implementation: a pure testing day was also showing the deload "D" marker. ⚠️ Not device-verified (the striped-bar CSS mask is an unobserved Samsung WebView question). |
| Q-247 | Day-detail screen had no calories-in-vs-out summary; Activity rows showed only title+duration | **Shipped by another session**, PR #1375, v1.317.0, same journal entry. Confirms what this session already found: the `computeActiveEnergy()` formula was correct — this was purely a display gap. ⚠️ Not device-verified. |
| Q-248 | Logging Exercise Readiness could show "saved" while the Home screen stayed on the pre-save prompt | **Shipped by another session**, v1.317.1. See [`overview/history-2026-08-15.md`](overview/history-2026-08-15.md). Fixes the cause this session's investigation traced (an `onSaved` callback gated behind a slow local-store write) — **the on-device repro this session called for still never happened**, so the fix addresses the code-evidenced cause, not one confirmed against the observed failure. A second possible cause (the write silently failing rather than merely stalling) is explicitly still open per that session's own honest write-up. |
| — | Warm-up timer's `/ 10:00` denominator was a hardcoded literal, ignoring the session's real budget-scaled goal | Fixed **directly in this session**, PR #1350, merged. One-line change, tests/lint/typecheck green. |
| **Q-310** | **An ai_dynamic deload phase reached via `workout-data/route.ts`'s generic fallback branch (two identical copies) gets the correct display name ("Deload") but hardcoded `isDeloadActive: false` / `phaseType: 'normal'` — so weight prescription stays full-intensity and the PR gate never engages. A genuine `personal_records` row can be written from submaximal-labeled work** | **Still open.** PR #1398 merged, docs-only — filed near the top of the queue given it's a live data-correctness bug. **This is the one thing this handoff needs a future session to pick up.** |

Matching `Task N` sections for all five live in
[`docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`](superpowers/plans/2026-08-05-owner-ui-bug-batch.md) —
Tasks 49–51 (Q-246/247, Q-245, Q-248) are annotated `SHIPPED` with pointers to the real
implementation; Task 52 (Q-310) is still open; Task 53 records the warm-up fix.

## Deliberately NOT done

- **No code fix for Q-310.** It touches the PR-write path directly and needs a decision about
  whether a corrective migration is required for already-written data — deliberately left for a
  careful implementation pass, not rushed through in the turn it was found.
- **No production data audit yet for Q-310.** The entry calls for checking whether any
  `personal_records` rows were already written incorrectly via this fallback path (same shape as
  the historical `168_q115_whole_session_deload_pr_correction.sql` migration) — that query has not
  been run by anyone yet, as far as this session found.
- **The exercise-summary "New Personal Record!" badge's missing deload gate** — the second half of
  what the Q-310 screenshots show (`exercise-summary-screen.tsx`'s `isNewPR` is a naive client-side
  comparison with no `isAnyDeload` awareness) — is documented as part of Q-310's fix direction but
  not built.
- **Q-248's stall theory was never device-confirmed**, by this session or the one that shipped the
  fix. Watch for a readiness log that saves locally but never reaches the server under real sync
  contention — that would be the second, still-open cause.

## Key decisions (with rationale)

- **Fixed the warm-up label directly instead of queuing it.** The root cause was certain (one
  hardcoded string, confirmed by reading the exact line), the fix was a single line with zero
  behavioral risk, and it's an already-shipped-feature bug fix — which CLAUDE.md exempts from the
  queue-then-implement split. Queuing something this small and certain would have cost a whole extra
  session round-trip for no benefit.
- **Q-310 stayed docs-only despite its severity**, for the same reason the other four originally
  did before other sessions picked them up: the fix touches the PR-write path directly and needs a
  data-correctness decision (corrective migration or not) that shouldn't be made in the same turn
  the bug was found.
- **Placed Q-248 and Q-310 near the top of the backlog file** when each was filed, not at the bottom
  in arrival order. Q-248 because the owner explicitly asked for that. Q-310 because it's a live
  prescription/data-correctness bug affecting current training, not cosmetic — queue position is
  priority in this file, per its own header.

## Gotchas / what did NOT work

- **The Q-number counter in `docs/implementation-backlog.md` went stale repeatedly** across this
  session because multiple sessions were working the queue in parallel over several real days. Every
  PR filed by this session needed at least one rebase, and three (`#1339`/Q-245, `#1345`/Q-248,
  `#1398`/Q-310) hit a real provisional-number collision where the file's own pointer claimed a
  number an *unmerged* open PR already held. `list_pull_requests` caught every one — **always check
  open PRs, not just the counter note, before claiming a number**, exactly as the file's header warns.
- **A queued item can be fully shipped by a different session before you ever see it again.** This
  handoff was originally drafted assuming Q-245/246/247/248 were still open — the changelog
  (`packages/shared/src/changelog.ts`) is what surfaced that they weren't: it already had entries
  describing all four as shipped, in versions this session's own branches never touched. **Always
  check the current state of anything you're about to write a handoff for — a plan or backlog entry
  can go stale between when you filed it and when you write it up**, exactly as this file's own
  header (`docs/implementation-backlog.md`) warns for a different reason.
- **Backlog-file merge conflicts were frequent and mechanical, not semantic** — almost every conflict
  was two sessions independently inserting an entry (or a counter-note update) at the same location.
  The fix each time was keeping both sides' content and re-chaining the "Previously N" counter-note
  trail, never discarding either session's finding. One conflict required renumbering a `Task N`
  heading in the plan doc (48 → 50, then again for Q-310 as Task 52) because another session's PR had
  already taken the number in between.
- **`git checkout -- <file>` to discard a local patch, then re-apply it on a fresh branch, works
  cleanly** — used this for the warm-up fix: saved the diff to a scratchpad patch file, reverted the
  in-progress edit, cut a clean branch off fresh `main`, and `git apply`'d the patch. Kept the
  investigation work (on docs-only branches) cleanly separated from the one real code change.

## Files to look at

- `app/api/workout-data/route.ts` — the Q-310 bug, in two identical copies (~line 255 and ~line 450
  as of this writing; grep `isDeloadActive: false` to find both). This is the file to start in when
  implementing Q-310.
- `components/workout/exercise-summary-screen.tsx:86` — the `isNewPR` client-side PR badge that
  needs the same deload gate as `shouldCountTowardPr`.
- `packages/shared/src/workout/log-exercise.ts` — the server-side `shouldCountTowardPr` gate this
  bug bypasses; read its comment for the design intent Q-310 violates.
- `docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md` — Task 52 has the fuller Q-310
  write-up and fix-direction checklist; Tasks 49–51 point to the already-shipped fixes for the other
  four, including what each implementation found that the original investigation didn't (a sibling
  testing-day bug in Q-246, a needed `drop` case in Q-245).

## Open questions / blockers

- **Q-310's production data question is unresolved** and needs the admin DB query endpoint (or an
  implementer session with access) to check whether any real `personal_records` rows were written
  via this bug before deciding on a corrective migration.
- **Q-248's stall theory remains unconfirmed** even after its fix shipped — the fix addresses the
  cause the code evidences, not one confirmed against the observed failure. Not this session's to
  chase further, but worth knowing if readiness sync issues resurface.
- Nothing here is blocked on the owner beyond the Q-310 data question above.

## Pickup prompt

```
Continue TrainingAI implementation work. Read in this order: projectOverview.md ->
docs/domains/workouts/README.md -> docs/handoff-2026-08-17-workouts-owner-bug-batch-deload-fallback.md ->
docs/implementation-backlog.md.

Before anything else: re-verify this premise against current main, since the backlog moves fast
under parallel sessions. Q-245, Q-246, Q-247 and Q-248 (an earlier owner bug batch) were already
shipped by other sessions by the time this handoff was written -- confirm they're still gone from
implementation-backlog.md before assuming otherwise. The one item this handoff hands off is:

Q-310: an ai_dynamic deload phase reached through app/api/workout-data/route.ts's generic fallback
branch (two identical copies, search "isDeloadActive: false") gets the correct display name
"Deload" but hardcodes isDeloadActive:false/phaseType:'normal' -- so weight prescription stays
full-intensity and the shouldCountTowardPr PR gate (packages/shared/src/workout/log-exercise.ts)
never engages. This is a live, owner-confirmed bug affecting real training data: a genuine
personal_records row can be written from what should be submaximal work.

1. Query production (via the admin DB endpoint, CLAUDE_DB_QUERY_SECRET) for personal_records rows
   that may already be wrong this way -- decide whether a corrective migration is needed before or
   alongside the code fix, same shape as the historical migration 168.
2. Fix both copies of the fallback branch to derive isDeloadActive/phaseType from
   aiPeriodizationState.phase === 'deload' instead of hardcoding.
3. Gate exercise-summary-screen.tsx's isNewPR badge the same way shouldCountTowardPr is gated.
4. Verify locally by forcing aiPeriodizationState.phase = 'deload' via the generic-fallback path
   specifically (not the earlyDeloadWeek path) and confirming reduced weights + no PR fires.
5. Remove the Q-310 entry from docs/implementation-backlog.md and update Task 52 in the
   owner-ui-bug-batch plan doc, add the journal entry + projectOverview.md update, in the same PR.

Constraints you would otherwise rediscover:
- Check the OPEN PR LIST before claiming a Q-number or starting a queue item -- the counter note
  in implementation-backlog.md goes stale fast under parallel sessions; list_pull_requests is what
  catches a number an unmerged PR already holds.
- A queued backlog item can already be shipped by a different session by the time you read this --
  the changelog (packages/shared/src/changelog.ts) is the fastest way to check.
- The project is mid-migration to a new public repo (nekodas-neko/TrainingAi_Open, Q-49) -- see
  docs/handoff-2026-08-16-platform-public-repo-cut-a4b.md if that's the active thread. This repo
  (nekodas-neko/TrainingAI) stays the canonical working copy until Phase B's final archive step, so
  keep committing here normally.
```
