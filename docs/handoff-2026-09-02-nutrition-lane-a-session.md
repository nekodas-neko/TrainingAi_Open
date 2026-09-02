# Handoff — 2026-09-02 · Lane A: supplement contributions, three CI ratchets, and six wrong entries

_Domain: `nutrition` (also touches `platform`, `body`) · Branch: `docs/lane-a-session-handoff` · PR: opened with this doc_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/nutrition/README.md`](domains/nutrition/README.md), then
> `docs/implementation-backlog.md`. This file covers only what this session did and left behind.

## Goal

Work the Lane A queue top-down, re-verifying each entry against the code before building. Ten PRs
merged. The most valuable output was not the code — it was discovering that **six of the eight
entries examined were wrong about something load-bearing.**

## Current status

- **Build/test:** full suite green at each merge, last run **6,290 passed / 59 skipped / 744 files**.
  `pnpm check:rules` — **Ran 67 of 67** every time. `tsc` clean. Five of the ten PRs were also
  exercised against `pnpm dev` with a real credentials session.
- **Device-verified:** **no.** Two things need the S25 and have Known-Issues rows: BF-69's **local
  SQLite v34**, which rebuilds a table rather than adding a column (the first local migration in
  this repo to do so), and the local half of LB-18's `getRecentFoodItems`, which `getLocalStore`
  cannot run under vitest or in the web sandbox.

## What shipped

| PR | What | Notes |
|---|---|---|
| #775 | Fixed a guard whose regex matched its own test file | `main` was red |
| **#781** | **BF-69 stage 1 — supplement contributions** | migrations **254 + 255**, local SQLite **v34** |
| #770 | LB-37 — test files typechecked in CI | shrink-only baseline, 320 errors / 90 files |
| #777 | LB-31 — anchor-source race + nightly `main` run | |
| #785 | Queue hygiene — BF-4 and Q-156 removed, findings preserved | first ratchet-**down** of a doc-size baseline |
| #786 | LB-48 — evict `measured-rmr` on save | four lines |
| #788 | LB-49 — meal-log `scale` + journal ceiling 250 → 320 | |
| #791 | LB-50 — prompt no longer claims an activity-scaled TDEE | |
| #792 | BF-77 given the `Gate: owner` its prose already stated | |
| #794 | LB-18 — unscoped `Recent` source | **no migration needed** |

### BF-69 stage 1 is the substantial one

`supplement_logs` was `unique (supplement_id, log_date)`, so a day held one row. With a second
writer (the meal attachment) that made two doses last-writer-wins, made the same meal logged twice
record one dose, and made `unlogSupplement` wipe the day whoever wrote it — silent data loss. Each
act is now its own row with a `source`; the day's amount is summed on read, never stored.

**The replacement constraint is a partial unique over `source = 'manual'` alone, and its predicate
deliberately covers soft-deleted rows.** The first version added `AND deleted_at IS NULL`, which
looked more correct and made an untick-then-re-tick leave two rows — which then needs the pull to
order a tombstone and a re-log correctly. Dropping the clause restores **at most one manual row per
substance per day, ever**, and with it every existing reconciliation behaviour.

## Deliberately NOT done

- **LA-47's remaining piece** (the Coach plan widget). The entry is right that it is *"one change
  across two lanes, not two changes"*: `widget-registry.tsx` narrows by early return, so a new
  union member is a type error until a branch handles it, and a branch rendering `null` **wedges
  the whole thread** because the provider refuses a request with an unanswered tool call. Design is
  settled in the entry — do not re-derive it.
- **BF-69 stages 2–4** — an amount on the supplements page (Lane B) is the gate on everything after.
  Nothing can write a number yet; production holds 2 supplements and 1 log ever.
- **LB-18's Lane B swap** — dropping the query param in `RecentFoodsPanel`.
- **LB-50's activity factor** — needs the not-enough-data state the maintenance figure already has.
- **The real journal compaction** — folding *linked* entries and repointing durable docs. Still
  Orchestrator's; the ceiling raise bought room, it did not do the work.

## Key decisions (with rationale)

- **Journal ceiling 250 → 320**, owner-approved after being surfaced as a blocker. `main` sat at
  exactly 250 and every agent's next PR would have failed CI. The raise is defensible because the
  check's *other* guard — **unlinked** entries, the ones a sweep can fold — read **3 of a limit of
  60**. The ceiling was firing because entries are *well cited*, which is the habit the entries
  README exists to establish. Reversal is one number; the signal to do the real compaction instead
  is the floor rising from something other than journal citations.
- **`loggedToday` tracks the manual contribution only**, not "was it taken today". It is the tick's
  checked state, and a meal's dose turning it on leaves a control that refuses to turn off.
  `loggedAmount` answers the day-level question.
- **LB-49's scale is applied at write time and the factor is not stored.** The rows are
  point-in-time snapshots; a meal-level factor every reader had to remember would put a second
  multiplier in the system. Cost, stated rather than discovered: *"I ate 1.5×"* is not recoverable
  afterwards, only the scaled per-item amounts.

## Gotchas / what did NOT work

**Six of eight entries were wrong about something load-bearing. This is the finding to carry.**

| Entry | What did not survive the code |
|---|---|
| BF-69 | Framing. "Nothing reads them" understated it — the storage was shaped so a second writer would destroy data. |
| LB-48 | Severity. "Stale until the app is restarted" — the RMR form is at `/more/clinical`, **outside** the tab shell, so the section remounts. Measured in Chromium: effect ran 3 times, then 3 more. |
| LA-54 | **Mine.** Filed a checker-gap entry on the same false premise, withdrew it before it reached the queue. |
| LB-49 | Four errors: a function name that does not exist (`logMealFromSaved` → `logMealItems`); a lane justified by a rule that does not apply (it is client-side); a sync chain its own decision made unnecessary; three write sites where there are **five**. |
| BF-77 | No `Gate:` field despite prose saying it needs an owner decision, so it headed Lane A's READY list. |
| LB-18 | A phantom migration. It insists recency ordering "needs a Lane A schema change" — `listSavedMeals` already derives `lastUsedAt` from `max(food_logs.logged_at)`. |

**The shape is consistent: line numbers have been accurate every time; names, conclusions and
"this needs a schema change" have not.** LB-49 cited three correct line numbers inside a function
whose name does not exist. Cheapest check that keeps working: **grep the symbol, then grep its
callers**, before writing anything.

Other traps:

- **`get_check_runs` returning `total_count: 0` meant a stale base every single time tonight**,
  never slow CI. Check `git merge-base --is-ancestor origin/main origin/<branch>` first.
- **A stale local `origin/main` looks like a lost edit.** I nearly reported one; `git fetch` showed
  the commit had merged fine. Fetch before believing anything is missing.
- **Guards find their own documentation.** Happened twice more this session — a PRAGMA check
  matched the migration comment saying "No PRAGMAs here", and `check-reconcile` flagged the rebuild's
  scratch table. Strip comments; exempt by name with an assertion that the exemption is real.
- **LB-37's ratchet caught a test written hours earlier in the same session** — annotated
  `Repository`, which does not exist (it is `WorkoutRepository`), so `listSupplements` returned
  `any` and five callbacks fell to implicit any. The assertions passed the whole time on untyped
  values. `tsc -p tsconfig.json` excludes test files, which is the gap the check closes.

## Files to look at

- `lib/sqlite/migrations.ts` — **v34 rebuilds `supplement_logs`.** SQLite cannot drop an inline
  table constraint. Written so any prefix re-runs to completion; read the comment before touching it.
- `lib/data/postgres/migrations/254_supplement_contributions.sql` — the partial index and why its
  predicate omits `deleted_at`.
- `packages/shared/src/nutrition/log-meal.ts` — `logMealItems`, five scale sites.
- `lib/data/postgres/slices/nutrition.ts` — `recentFoodItems` shared body; `listSavedMeals` above it
  is the derived-recency precedent.
- `scripts/lib/entries-verdict.js` + `docs/doc-size-baseline.json` — the ceiling and its two guards.

## Open questions / blockers

- **Device run owed** for local SQLite v34 (install, open Nutrition, tick a supplement) and for
  `getRecentFoodItems`. Both have Known-Issues rows.
- **BF-77 needs the owner's A-or-B choice** — finish BF-57's QR path (near-free) or build a
  server-stored share code (route, code space, expiry, rate limit).
- **Entry quality is a live pattern, not six coincidences.** Another session hit it independently in
  #789 (a self-contradicting entry, two misfiled lanes, a corrected sample size). Worth raising with
  Orchestrator as a filing-quality issue.

## Pickup prompt

```
You are the Implementation Agent (Lane A) on nekodas-neko/TrainingAi_Open. Session title:
🚧 Implementation Agent (A) 🟢 — set it via get_session (session_id omitted) then set_session_title.

Read in this order:
  1. projectOverview.md — status and the live Known Issues
  2. docs/agents/state/implementation-lane-a.md — your baton
  3. docs/handoff-2026-09-02-nutrition-lane-a-session.md — the previous session
  4. docs/domains/nutrition/README.md — the pillar you will most likely be in

First action: `node scripts/next-item.js --lane A`. LA-47 should head the list.

BEFORE BUILDING ANY ENTRY, verify its premise against the code. Six of the eight entries checked
on 2026-09-02 were wrong about something load-bearing — a function name that does not exist, a
severity that does not reproduce, a migration that was already built. Line numbers have been
reliable; names and conclusions have not. Grep the symbol, then grep its callers, then decide.

Constraints you would otherwise rediscover:
- LA-47's remaining piece is ONE change across two lanes. `widget-registry.tsx` narrows by early
  return, so a new union member is a type error until a branch handles it, and a branch rendering
  null WEDGES THE COACH THREAD (the provider refuses a request with an unanswered tool call). The
  design is settled in the entry — do not re-derive it.
- `get_check_runs` returning total_count 0 means a STALE BASE, not slow CI. Confirm with
  `git merge-base --is-ancestor origin/main origin/<branch>`, re-merge, push.
- Expect a 405 merge conflict on nearly every PR: projectOverview.md, doc-size-baseline-history.md
  and the two .size files. Merge origin/main, resolve, verify `grep -c '**Version:**'
  projectOverview.md` is 1, re-derive both .size files with `awk 'END{print NR+1}'`.
- Local SQLite v34 (supplement_logs rebuild) and LB-18's getRecentFoodItems are NOT device-verified.
- Merging is self-authorised once CI is green and the change is tested, EXCEPT for data-dropping
  migrations, auth/security and secrets — those are confirm-first.
```
