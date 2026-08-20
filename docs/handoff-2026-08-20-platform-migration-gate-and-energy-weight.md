# Handoff — 2026-08-20 · Lane A: the energy estimate's weight source, the CSP's WASM directive, and a CI gate that could not fail

_Domain: `platform` (also touches `workouts`, `nutrition`, `devices`) · Branch: `fix/migrate-classifies-idempotent` · PR: **#262, open, CI running**_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/implementation-backlog.md` (the queue).
> This file covers only what *this* session did and leaves behind.

## Goal

Work the Lane A queue top-down. Four items shipped; the fourth started as a one-line
discrepancy in the session-start hook output and ended up finding a migration that has been
failing on every fresh CI database, in three jobs, all of them green.

## Current status

- **Build/test:** `tsc` clean · lint clean · **Ran 50 of 50 Custom Rules steps** · **4,356** unit
  tests pass. `pnpm dev` was run and the changed API routes exercised for each PR
  (`/api/workout-sessions/[id]/energy`, `/api/nutrition/energy-balance`,
  `POST /api/nutrition/meal-plans/generate` end-to-end against the real model, and the CSP header
  read off the running server).
- **Device-verified: NO.** Nothing this session ran on the S25. The CSP change reaches the device
  (the APK is a WebView on the Railway URL) and has a Known-Issues row saying so. The rest is
  server-side: no local-store, native-plugin, safe-area or gesture path is in any diff.

## What shipped

| PR | What |
|---|---|
| **#258** (merged) | **Q-330** — the done screen estimated a finished workout's calories from `getBodyMetricsBaseline`, which orders `asc(date)`: the **first weight ever logged**. Both wrong callers moved to `getMostRecentConfirmedWeightKg`. |
| **#259** (merged) | **Q-546** — `script-src` gained `'wasm-unsafe-eval'`; `connect-src` lost two dead Oura Cloud hosts; the CSP moved to `lib/security/csp.ts` and got its first test. |
| **#262** (open) | `migrate.js` now classifies "already there" as `ensureSchema()` does and **exits non-zero** on a real failure — and migration **142** creates the table it references. |
| #257 (merged) | Q-329 — `shiftDateStr` for years 0–99. |

## The thing worth knowing about #262

**`142_claude_ro_views.sql` creates a view over `public.db_query_log`. `143_db_query_log.sql`
creates that table.** One migration too late. A multi-statement migration is one implicit
transaction, so 142 did not fail partially — it aborted there and **every view below it rolled
back**.

Nothing noticed, for two compounding reasons: `144` rebuilds the whole `claude_ro` schema so the
end state came out right, and **`migrate.js` returned exit 0 whatever happened**. Three CI jobs run
that script (`Tests`, `Migration Check`, `E2E`) and all three were green over it.

Measured on a fresh database: **205 applied / 1 failed / exit 0** before, **206 applied / 0 failed**
after, `claude_ro` view count unchanged at **85** (which is what proves 144+ were rebuilding them).
Production is untouched — 142 is already recorded there, so the new `CREATE TABLE IF NOT EXISTS`
never runs.

## Deliberately NOT done

- **A migration that fails idempotently is still not recorded.** Recording it would end the
  retry-every-boot — and could freeze a *half-applied* migration as done, because the collision
  fires on the first clashing statement and 157 is a `CREATE TABLE` followed by eight `ADD
  COLUMN`s. Retrying is noise; that is not.
- **The four non-idempotent migrations (054, 055, 082, 157) are left as they are.** PS-3 covers it,
  now annotated with the measurement that defuses it: `claude_ro.schema_migrations` holds **206 of
  206** in production, those four included, so it is local-only noise.
- **No CI-level test pins the two energy surfaces to one number** — both estimate strength as
  activity 8, whose fixture MET (0.6) is below the formula's 1.5 floor, so both sides are 0 in CI
  and equality would pass vacuously. Filed as **Q-331**.
- **Q-422 / Q-420 / Q-421 route (b)** were not started: all three are gated on an owner decision or
  a spec, and Q-422 is explicitly *Tuning proposes, owner signs off, Lane A implements*.

## Key decisions

- **The CSP relaxation was put to the owner and approved.** `'wasm-unsafe-eval'` permits WASM
  compilation only; it does not imply `'unsafe-eval'`, which production still does not carry. The
  same PR *removed* two hosts, so the net change to attack surface is a reduction.
- **142 was fixed by creating what it references**, not by guarding the view — CLAUDE.md's own rule,
  and it leaves 143 correct and untouched.
- **PS-3 was annotated, not deleted.** It is another agent's finding and part of it survives; the
  production measurement and the reduced scope are written onto it.

## Gotchas / what did NOT work

- **My dedup check missed PS-3.** I checked branch names and open PRs; PS-3's branch had never been
  pushed. **Grep the backlog for the symptom**, not just for branch names and PR titles.
- **`get_check_runs` lied twice**, both directions: it read `total_count: 0` for minutes on a PR
  whose base was current, and separately reported `Build`/`Tests` `in_progress` long after they had
  passed — the merge attempt succeeded immediately. Attempting the merge is the reliable check.
- **Premise re-verification paid again.** Q-330's own entry said the two surfaces "may be correctly
  different… check that before changing either". Reading the query settled it: `asc(date)` is the
  start of recorded history, not the weight at the time of anything.
- **A vacuity guard is worth writing.** Every new test here opens with an assertion that the thing
  under test is non-trivial (the MET clears the 1.5 floor; the two weights differ), because the
  scrubbed fixtures make zero-equals-zero the default failure mode.

## Files to look at

- `scripts/local-db/migrate.js` — the runner CI's `Migration Check` job invokes; now gates.
- `lib/data/postgres/idempotent-sqlstates.json` — the SQLSTATE list **both** runners read. Never
  re-inline a copy; a test fails on one.
- `lib/security/csp.ts` — the CSP, and the only place to change it.
- `lib/data/postgres/adapter.ts:1959` — `getBodyMetricsBaseline`, now documented as *not* the
  current weight.

## Open questions / blockers

- **#262 is open with CI running.** Merge it when green. If `Migration Check` is red, read the log:
  the gate now reports real failures, so a red is information rather than noise.
- **Owner still owes two device checks:** the deliberate Sentry error and an APK client check; and
  a Railway-dashboard reading for Q-549.
- **#124 (Q-479) stays open and unmerged** — owner: *"leave that as a known issue for now."*

## Pickup prompt

```
You are Implementation Agent (A) 🚧 on nekodas-neko/TrainingAi_Open. Keep that exact session
title, emoji included.

Read, in order: projectOverview.md · docs/agents/README.md (§3, the lane contract and the new
LA-N identifier scheme — reserved Q-number bands are gone) · docs/agents/state/implementation-lane-a.md
(your baton) · docs/domains/platform/README.md ·
docs/handoff-2026-08-20-platform-migration-gate-and-energy-weight.md (this session's record) ·
docs/implementation-backlog.md (the queue).

FIRST ACTION: check PR #262 (branch fix/migrate-classifies-idempotent). If it is still open,
re-merge origin/main, confirm CI green on the updated head, and squash-merge it. It carries the
migration-runner gate plus the fix for migration 142, which had been failing on every fresh CI
database while three jobs reported success.

THEN take the highest unblocked Lane A entry. Most of the top of the queue is Lane B. PS-1 and
PS-2 are platform housekeeping; Q-362 (`workoutDurations` keyed by session NAME, so two
same-named sessions in a day collide) is the next substantive one. Q-422, Q-420 and Q-421
route (b) are all gated on an owner decision or a spec — do not start them.

CONSTRAINTS that will otherwise be re-discovered:
- Before starting any item, GREP THE BACKLOG FOR THE SYMPTOM, not just for the branch name and
  PR title. A branch-name check missed a duplicate entry this session.
- Re-verify every entry's premise against current main before implementing, and write down what
  you checked. This has corrected the entry roughly every time it has been done.
- Device verification: nothing ran on the S25 this session. Any change touching offline-first,
  native plugins, safe-area, gestures or notifications needs the on-device smoke run or an
  explicit projectOverview.md Known-Issues row saying it is unverified.
- The local gate is `pnpm check:rules` — quote its "Ran N of N" count, never the word "pass".
- `get_check_runs` is unreliable in both directions. Attempting the merge is the authoritative
  check: it validates against real branch protection and refuses with the reason.
- Fixture constants are synthetic: strength is activity 8 with met_moderate 0.6, below
  estWorkoutKcal's 1.5 floor, so EVERY strength estimate is 0 in CI and the sandbox. Open any
  test that touches it with a vacuity guard.
```
