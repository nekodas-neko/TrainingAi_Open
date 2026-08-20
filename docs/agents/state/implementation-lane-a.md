# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title is how six concurrent sessions stay tellable apart — Orchestrator 🪐 joined on 2026-08-20 (#263); a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-20 · **By:** the fifth session to run as Lane A · **Next ID:** `LA-1` (bands are gone — `docs/agents/README.md` §3; legacy `Q-` IDs stay valid where already used)
**Migrations:** 189–206 taken; next free is **207**. Local SQLite **v28**, untouched this session.

## Now

**One thing is in flight: PR #262** (`fix/migrate-classifies-idempotent`), CI running at handoff.
Everything else this session opened is merged. Clear #262 first, then take the queue top-down.

Full record: [`docs/handoff-2026-08-20-platform-migration-gate-and-energy-weight.md`](../../handoff-2026-08-20-platform-migration-gate-and-energy-weight.md).

### The headline: a CI gate that could not fail, and what it caught

`scripts/local-db/migrate.js` **exited 0 no matter what**, and three CI jobs run it — `Tests`,
`Migration Check`, `E2E`. So the job named for catching a bad migration could not fail on one.

The moment the gate existed it caught a real one: **`142_claude_ro_views.sql` creates a view over
`public.db_query_log`, and `143_db_query_log.sql` creates that table.** One migration too late. A
multi-statement migration is one implicit transaction, so 142 aborted there and **every view below
it rolled back** — on every fresh CI database, invisibly, because `144` rebuilds the whole schema
and the end state came out right.

Both fixed in #262. If `Migration Check` goes red now, **read the log rather than re-running**: it
reports real failures.

### The habit that keeps paying, and the one that failed this session

**Re-verify an entry's premise against current `main` before implementing.** Q-330's own entry said
the two energy surfaces "may be correctly different — check that before changing either". Reading
the query settled it in a minute: `getBodyMetricsBaseline` orders `asc(date)`, so it is the first
weight ever logged, not the weight at the time of anything.

**And the one that failed: dedup by branch name is not enough.** PS-3 already described the
migration finding; my check covered branch names and open PRs, and PS-3's branch had never been
pushed. **Grep the backlog for the symptom.**

## Open PRs — clear these first

- **#262** `fix/migrate-classifies-idempotent` — the migration gate + the 142 fix + PS-3's
  annotation. Merge when green.
- **#124 (Q-479) is deliberately open and must NOT be merged.** Owner, verbatim: *"leave that as a
  known issue for now - only admin will be me for a long time."* Do not re-implement it either.

## Shipped this session

| PR | What |
|---|---|
| **#258** | **Q-330** — the done screen estimated calories from the **first weight ever logged** (`asc(date)`). Both wrong callers moved to `getMostRecentConfirmedWeightKg`; `progress-summary` correctly keeps the baseline, since its consumer is a goal-progress bar. Also closed **Q-419**'s acceptance criterion: the two surfaces now agree exactly (106 = 106, measured). |
| **#259** | **Q-546** — `script-src` had no `'wasm-unsafe-eval'`, so no WASM session could start in the browser. Owner-approved. Extracting the CSP to `lib/security/csp.ts` immediately exposed that `connect-src` still permitted both Oura Cloud hosts a week after the integration was deleted. |
| **#257** | **Q-329** — `shiftDateStr` for years 0–99. |
| #262 (open) | The migration gate, above. |

## Standing constraints

- **The local gate is `pnpm check:rules`** — quote its `Ran N of N` count, never the word "pass".
  It read **50 of 50** all session.
- **`get_check_runs` is unreliable in both directions** — it read `total_count: 0` for minutes on a
  PR whose base was current, and reported `Build`/`Tests` `in_progress` long after they passed.
  **Attempting the merge is the authoritative check**; it validates against real branch protection.
- **Fixture constants are synthetic.** Strength is activity 8 with `met_moderate: 0.6`, below
  `estWorkoutKcal`'s 1.5 floor — so **every strength estimate is 0** in CI and the sandbox. Open any
  test that touches it with a vacuity guard, or it passes by comparing zeroes (this is Q-391's trap
  and it is easy to walk into twice).
- **Nothing ran on the S25 this session.** Any change touching offline-first, native plugins,
  safe-area, gestures or notifications needs the on-device smoke run or an explicit
  `projectOverview.md` Known-Issues row saying it is unverified.

## The database reclaim is still the standing deadline item

Inherited unchanged for the fourth baton running, because **no session has been able to touch it**:

| Step | Worth | State |
|---|---:|---|
| Migration **193** drops `idx_oura_raw_samples_user_measured` | **136 MB** | ✅ merged, landed on deploy |
| Pack the raw frames (Q-541 Task 5 backfill) | **~630 MB** | ⛔ **needs a press against production** |
| `VACUUM FULL error_events` (Q-315) | **~49 MB** | ⛔ **needs a press against production** |

Every reclaim is admin-session-gated and a sandbox session cannot authenticate to production
(`CLAUDE_DB_QUERY_SECRET` is read-only; `ADMIN_EXPORT_SECRET` is GET-only on one route). Either the
owner runs the curls, or Lane B builds the buttons (Q-316), or a **confirm-first** bearer path is
added — **do not build the third without an explicit yes, it is an auth change.** Runbook:
[`docs/handoff-2026-08-18-platform-database-reclaim.md`](../../handoff-2026-08-18-platform-database-reclaim.md).

## Waiting on the owner

- Two Sentry checks on-device: one deliberate server error, one APK client check.
- A Railway-dashboard reading for **Q-549** (is 0.79 GB still the warmed steady state).
- **Q-422** (calibrate the burn estimate) is *Tuning proposes → owner signs off → Lane A
  implements*. Do not start it as Lane A.
- **Q-420** needs an owner decision on the 6–10 → 1–10 scale mapping; **Q-421 route (b)** is blocked
  on the feature spec.

## What to take next

**Use `node scripts/next-item.js --lane A`** — #254 added it and it is a better answer than reading
the queue file, which cannot show you which of its top entries are startable. At handoff it read
**READY 157 · PARKED 19 · UNCLASSIFIED 1**, topped by PS-3 (now mostly defused — read its
annotation), then Q-331, then Q-421.

**But the tool only sees the `Gate:` field, and most entries state their blocker in prose.** Q-420
and Q-422 both listed as READY while each says in its own body that it waits on the owner; I added
`Gate: owner` to both. Expect more of these — when an entry turns out to be blocked, add the field
rather than just walking away from it, or the next session rediscovers it.

**Q-331** is mine and low: a CI-level parity test for the two energy surfaces, blocked on the
fixture MET above. Its entry names the shape that would work. **Q-362** (`workoutDurations` keyed by
session **name**, so two same-named sessions in a day collide) is the next substantive one after
that.
