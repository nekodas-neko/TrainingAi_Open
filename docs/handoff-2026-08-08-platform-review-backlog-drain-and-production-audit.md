# Handoff — 2026-08-08 · Agent-1 review-backlog drain, then a production data audit

_Domain: `platform` (spans workouts, sleep, heart-rate, devices, nutrition) · Branch: `main` (all
work merged) · PR open at time of writing: **#1174** (docs-only, CI green pending merge)_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/implementation-backlog.md` — that file is the live
> queue and is the source of truth by the time you read this. This doc covers what this session did
> and what it leaves behind.

## Goal

Pick up the Agent-1 half of the 2026-08-07 full-app-review dispatch
(`docs/handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md`) — eight items, platform/sync/
security, one PR each — then keep going. It cleared, and the second half of the session turned into
something more valuable: **auditing production data against what the code claims**, which found two
real bugs the queue did not know about.

## What shipped

| Item | PR | What |
|---|---|---|
| Q-128 | #1139 | `sessions_in_phase` reconciled at the read sites that use it |
| Q-122 | #1141 | Server-to-self `fetch`es removed; shared `syncAndAttributeSessionHr`; prescribe in-band |
| Q-123(a) | #1142 | Outbox completions get per-set HR attribution; dead `ctx` param removed |
| Q-129 | #1144 | **Security** — phase-set ownership: validated write, two scoped reads, rowcount guard |
| Q-124 + Q-134 | #1146 | Supplements pull-clobber guard (**local SQLite v22**), cache-variant fix, `updateSupplement` allowlist, 5 admin rate limits |
| Q-131 | #1147 | Shared mood schema both write paths, `food_items` parity, 4 columns restored to the pull |
| Q-130 | #1148 | Date guards on 4 routes, `formatDateDisplay` UTC fix, 8 regexes to `[-/]`, `since` 400 |
| Q-107 (half) | #1150 | `err.cause` captured — every `Failed query` row is now diagnosable |
| — | #1162 | Q-11's coverage question answered; Q-149 filed |
| — | #1164 | **Year Review read a deload as a lift dropping to zero** |
| Q-139 | #1170 | Ring clock stops compressing time during a history drain |
| Q-149 | #1172 | `rest_adequate` requires a measured recovery |
| — | #1173 | Counter audit (clean) + Q-7b corrected 8 → 10 columns |
| Q-156 | #1174 | Always-null `sleep_score` traced — dead column, no fix warranted |

Journal entries: `docs/overview/entries/2026-08-08-*.md`, one per item.

## The three findings worth carrying forward

**1. A stored sentinel is not a null.** Two of today's bugs are the same shape. A deloaded exercise
stores `estimated_1rm = 0` *deliberately*, and `getYearReviewTopExercises` filtered `IS NOT NULL` —
which `0` passes — so the year's headline lift could render "92.75 → 0 kg". Every sibling reader
already guarded `> 0`. When a column carries a deliberate sentinel, `IS NOT NULL` is the wrong
guard everywhere, and the siblings are where to look for the right one.

**2. A constant is worse than an absence.** `rest_adequate` was `true` for all 278 verdicts because
271 hit a `bpmAtLog < 120` shortcut and the ring's highest recorded end-of-set HR is 128. A reader
cannot tell an always-true column from a meaningful one — which is how it got as far as gating an
analysis. Fixed by requiring the measurement and emitting `null` otherwise; coverage honestly drops
to ~7 verdicts.

**3. Check the distribution before trusting a derived column.** Both of the above were found by
querying production, not by reading code. `docs/overview/entries/2026-08-08-production-counter-audit.md`
records the method and the negative results (counters clean) so the next pass starts further along.

## Key decisions (with rationale)

- **Q-139 → fix forward, no backfill** (owner). The slope was never the unknown: the ring's counter
  ticks at exactly 100 ms/ds by construction, so deriving `Δutc/Δds` from two anchors was measuring
  transport lag. Now a fixed slope with a **p10-of-lag offset per epoch**, which also makes the
  mapping monotonic in `ds`. Accepted cost: one offset per epoch ignores crystal drift (seconds/day)
  to remove an error of tens of minutes.
- **Q-149 → drop the shortcut, don't re-tune it** (owner delegated the call). 100 instead of 120 is
  the same population assumption with a different constant. Requiring the measurement is
  source-independent and leaves a per-source threshold available later **without changing what the
  column means**.
- **Q-124(c) does not exist.** The review claimed web supplement edits never bump `updated_at`;
  migration 078 installs a `BEFORE UPDATE` trigger that always has. Verified with a live PATCH and a
  real `/api/sync/pull` delta. Struck from the review, and the false changelog line removed.
- **Q-156 → traced, then deliberately not fixed.** No surface renders the null; the column is inert.
  Deleting it needs a migration and removing it from payloads risks an unknown offline consumer, both
  for zero gain.

## Gotchas / what did not work

- **Two wrong hypotheses preceded the Year Review fix** (a `useFor1rm` style-index bug, then a
  submaximal-set guard). Both were disproved by checking production and then the source — which is
  the only reason a *deliberate* sentinel didn't get "fixed" into something worse. Check before
  writing.
- **Splicing changelog conflict hunks fuses two entries.** It happened twice: another agent's line
  ended up inside my entry's `changes` array, silently dropping their version. CLAUDE.md already
  prescribes the fix — rebuild from `git show origin/main:...changelog.ts` and prepend — and once I
  did that, the remaining merges were clean. A helper lives at
  `scratchpad/relog.py` in that session only; the technique is what matters, not the script.
- **Q numbers and versions collided repeatedly** under two parallel agents. My entry moved 147 → 148
  → 149; the version moved four times. Nothing was lost, but **re-grep the file, never trust the
  counter**, and re-derive the version from `origin/main` at merge time.
- **`total_count: 0` on `get_check_runs` right after a push is propagation delay**, not the stale-base
  tell — that only applies several minutes in.
- **The long-standing `scale-ble-multi-reading` local failure was not mine and is now fixed** (Q-146,
  another agent). The suite is fully green locally.

## Deliberately NOT done

- **The device smoke check for local SQLite v22** (Q-124). The owner has it; steps are in
  `projectOverview.md`'s Known-Issues row. The one that matters: rename a supplement offline, sync,
  confirm the rename survives. If it reverts, the clobber guard is not working on device.
- **Q-107's batching half.** The cause capture is deployed and **zero server errors have been recorded
  since** — so there is no evidence yet. Read `error_events` in production *first*; the codes will be
  there now (`57014` = statement timeout; a pool-acquisition timeout arrives with no code).
- **Q-7b's ten missing producers**, Q-72/Q-137 (owner calibration decisions), and everything in the
  other agent's territory (`components/*`, `lib/cache-groups.ts`).

## State of this doc's own PR (#1174)

Docs-only, and **the last thing outstanding from this session**. Lint, Custom Rules and Migration
Check went green; Tests and Build sat `in_progress` with no log output for ~35 minutes — a stalled
GitHub Actions runner, not a failure (logs 404 because the jobs never started emitting).

**It then sat open for nine more hours and its base drifted well behind `main`.** A later session
picked it up, merged `origin/main` in, and found the sleep_score entry needed renumbering **twice
over**: `Q-150` had been taken by the running-app review (already on `main`), and the `Q-153` the
app-shell handoff prescribed as the replacement had *also* been taken in the meantime, by open
PR #1180. The entry is now **Q-156**. Both collisions were with numbers that were not in this file
when the entry was drafted — which is the case for *claim against the open-PR list*, stated plainly.

## Pickup prompt

**Superseded.** This session's work is history; the two-agent territory split it was written under
**ended on 2026-08-08**, so the "stay out of `components/*`" constraint below no longer applies to
anyone. The live pickup prompt for a single agent owning the whole queue is in
[`docs/handoff-2026-08-08-app-shell-review-backlog-ui-batch.md`](handoff-2026-08-08-app-shell-review-backlog-ui-batch.md)
under its own `## Pickup prompt`. Kept here only for the two facts inside it that are still true and
still worth carrying:

- **Q-107 still has no evidence.** The `err.cause` capture is deployed; production `error_events` was
  re-read on 2026-08-08 at 22:06 UTC and **no server row carries a `[pg …]` prefix**. Do not build
  the batching fix until one appears: `57014` means statement_timeout (chase the slow query); a
  pool-acquisition timeout arrives with **no code at all**, which would mean the `max: 10` pool is
  the constraint and `getSyncDelta`'s 22-query fan-out is what to chunk.
- **The supplements local-SQLite v22 migration is still NOT device-verified.** If the owner reports
  supplements behaving oddly, suspect that first.
