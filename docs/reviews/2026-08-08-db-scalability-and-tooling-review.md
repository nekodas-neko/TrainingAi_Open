# Database, scalability and dev-tooling review — 2026-08-08

_Domains: `platform` (primary), `devices`. Companion to
[`2026-08-07-full-app-review.md`](2026-08-07-full-app-review.md), which covered saving, caching,
performance and logic across all 201 routes but did not touch the database layer._

## Why this review exists

Twenty-four review documents precede this one. None of them covers the database: index coverage,
query plans, table growth, or connection behaviour. That gap matters because the database is also
the only layer currently producing faults in production that nobody has explained.

Everything below was measured against **production** via `POST /api/admin/db-query`
(`pg_stat_user_tables`, `pg_indexes`, `claude_ro.error_events`) on 2026-08-08. Row counts from
`pg_stat_user_tables.n_live_tup` are autovacuum estimates and are stale for small tables — where
that matters it is called out rather than quietly relied on.

---

## 1. Findings — Tier 1

### 1.1 The error reporter drops `err.cause`, so 98 production query failures are unattributable

`lib/observability.ts:8-9` records only `err.message` and `err.stack`:

```ts
const message = err instanceof Error ? err.message : String(err)
const stack = err instanceof Error ? err.stack ?? null : null
```

For a Drizzle `DrizzleQueryError` both of those describe the *wrapper*. The actual Postgres error —
the connection reset, the timeout, the terminated session — lives on `err.cause`, which is never
read. Confirmed against real rows: message is `Failed query: select …\nparams: …`, and the stack is

```
Error: Failed query: select "id", "user_id", "log_date", … from "mood_logs" where …
    at p.queryWithCache (/app/.next/server/chunks/6333.js:7:13669)
```

— the Drizzle frame, no underlying cause anywhere.

**Consequence:** 98 `Failed query` events over 30 days carry no diagnosis. The 2026-08-07 review's
§2.9 pool-starvation hypothesis could not be confirmed or refuted from this data, and neither can
any replacement hypothesis, because the one field that names the cause is discarded before the row
is written. This is a *diagnostic blocker*: it is not itself the fault, it is why the fault has
survived a month of review passes.

**⚑ Overtaken by events, same day.** While this review was being written, **PR #1150 (Q-107 first
half) shipped exactly this fix** for `lib/observability.ts` — `summariseCause()` now lifts the
Postgres `code` into a message *prefix*, chosen because the standing session-start query groups by
`left(message,120)` and a `Failed query:` message runs past that. Independent arrival at the same
conclusion within hours is a reasonable signal it was the right call, and that implementation is
better than the scope note originally filed here.

What survives is the half it did not touch: **`lib/observability/request-error.ts:55-59` still
records `message`/`stack` only**, and per [`module-map.md`](../module-map.md) §14 that
`onRequestError` path covers **the 80 route files with no `catch` of their own** — more routes than
the `reportServerError` path that was just fixed. **Q-142** was rewritten to that narrower scope
rather than closed.

### 1.2 The pool-contention hypothesis is weakly supported by the failure distribution

While the cause is missing, the *timing* is not. Grouping the 98 failures by the second they landed
in:

| failures in the same second | occurrences | total errors |
|---|---|---|
| 1 | 77 | 77 |
| 2 | 6 | 12 |
| 4 | 1 | 4 |
| 5 | 1 | 5 |

**79% of failures are a single query failing alone while every other query in flight succeeded.**
Pool exhaustion does not look like that — it fails everything competing for a connection at once,
which is the shape of the four remaining bursts. An isolated single-query failure fits a per-
connection drop or `statement_timeout: 15_000` (`lib/data/postgres/client.ts:25`) far better.

This does not prove the pool is innocent — the bursts are real and 21 of 98 errors are in them. It
means **the batching fix may be aimed at the smaller half of the problem**.

Now that #1149/#1150 have landed the `code` capture, this is settleable by one production read
rather than by argument: a `57014` (`query_canceled`) majority means `statement_timeout` and the
batching fix is aimed correctly; a spread of connection-acquisition failures carrying no code at all
means something else is dropping connections. **Read the codes before writing the batching PR.**
Recorded on **Q-107**, which owns the pool-contention question, rather than filed separately.

---

## 2. Findings — Tier 2

### 2.1 The database is re-accumulating toward the 1 GB volume, and the guard that shipped did not stop it

This is not a new problem — it is [`db-volume-cleanup-handover.md`](../db-volume-cleanup-handover.md)
(2026-07-21) and backlog item **Q-30**. What is new is the measurement, and it changes the reading.

| when | `pg_database_size` | source |
|---|---|---|
| 2026-07-21, pre-REINDEX | 320 MB | handover doc §2 |
| 2026-07-21, post-REINDEX | 205 MB | handover doc §2 |
| **2026-08-08** | **421 MB** | measured this session |

**205 MB → 421 MB in 18 days ≈ 12 MB/day.** `oura_raw_samples` is 306 MB of that 421 MB (73%) at
881,603 rows, up from 432,919 rows on 2026-07-21 — the row count **doubled in 18 days**
(~24,900 rows/day, cross-checked against a monthly bucket: 711,412 rows in July's 25 active days,
170,191 in August's first 8).

The distinction that matters for prioritisation: **Q-46's guard stopped index bloat
re-accumulating; it does not and cannot slow data growth.** The remaining Q-30 work is Railway-
console actions (REINDEX, VACUUM, WAL trim, restart) which reclaim *bloat*. At 12 MB/day the
database alone returns to the ~924 MB alarm level in roughly six weeks regardless of whether those
run. Only D4 (drop-after-pull) or a retention policy changes the trend.

Also worth recording plainly: **CLAUDE.md's stated ~3.2 MB/day for this table is understated by
roughly 3×** against the measured rate. That figure describes the device-local window, and it has
been read as the server rate.

**Action:** this updates **Q-30** in place rather than opening a new entry — its diagnosis is still
correct, only its urgency and the "console actions will fix it" framing need correcting.

### 2.2 `getOuraClockAnchors()` reads the whole anchor table on every rollup

`lib/data/postgres/adapter.ts:4320-4331` selects **every** anchor row for the user, unbounded, on
each call. In production that is the single hottest scan in the database:

| table | seq scans | tuples read by seq scan | live rows |
|---|---|---|---|
| `oura_ble_clock_anchors` | 17,045 | **45,278,531** | 3,297 |

45.3M ÷ 17,045 ≈ 2,657 rows per scan — a full read of the table, 17,000 times.

Two things are worth separating, because only one is a defect:

- **The plan is correct.** The query returns all rows for the only user, so Postgres rightly
  prefers a sequential scan over `idx_oura_ble_clock_anchors_epoch`. Adding an index will not help.
- **The call pattern is the problem.** The anchor table has no pruning and no epoch scoping, so it
  grows for the life of the ring while every rollup re-reads all of it. At 3,297 rows this costs
  little; the cost is linear in a number that only goes up.

This is latent, not urgent — and it sits on the same code path as the open **Q-139** ring-clock
compression bug, so whoever takes Q-139 should read this first. Filed as **Q-143**.

---

## 3. Findings — Tier 3 (multi-user readiness)

The owner has stated that other people already have accounts and that a Play Store listing is
intended, so single-user assumptions are now debt rather than context. Three were found; the
surfaces that were checked and are *clean* are listed in §4, because that is the more useful half.

### 3.1 The repository layer hardcodes `DEFAULT_TZ` on read paths — untracked

Three sites carry an explicit acknowledgement:

```
lib/data/postgres/adapter.ts:1051   // TODO(tz): thread session tz — DEFAULT_TZ assumed (app is AEST-only in practice)
lib/data/postgres/adapter.ts:1109   // TODO(tz): thread session tz — DEFAULT_TZ assumed
lib/data/postgres/slices/oura.ts:1074 // TODO(tz): thread session tz — DEFAULT_TZ assumed
```

A user outside `Australia/Brisbane` gets day boundaries computed in Brisbane time — silently, with
no error, on windows that feed health aggregation. `users.timezone` already exists and is already
stamped into the JWT, so the data is available; it simply is not threaded.

**This is an orphaned finding by the project's own rule** — three `TODO(tz)` markers in source,
zero references in `docs/implementation-backlog.md` or `projectOverview.md`. Filed as **Q-144**.

### 3.2 The error dedup key is not user-scoped

`lib/observability/request-error.ts:59` builds its 60-second dedup key as `` `${url}|${message}` ``.
Two users hitting the same fault on the same route within the window record once, and the second
user's occurrence is dropped — including the `userId` that would have shown it affects more than one
account. Low severity, trivial fix, but it degrades exactly as the user count grows. Filed as
**Q-145**.

### 3.3 Grandfathered debt surfaced by the new CI rules — mostly Q-130's, and it shipped mid-session

Adding the checks in §5 surfaced two pre-existing sets. **Both belonged to the already-queued
[Q-130](../implementation-backlog.md), (c) and (b) respectively — no new backlog entry was opened**,
and Q-130 then shipped (#1148) while this review was being written. What survives is a
machine-checked, shrink-only inventory in place of a hand-written file list, plus two corrections to
the counts it carried:

- **12 files call `toLocaleDateString`/`toLocaleTimeString` with no `timeZone`** (device-local
  rendering — the 2026-08-03 six-screen bug class). Q-130(b) names three of them
  (`stats-content.tsx`, `strength-trend-card.tsx`, `recommendation-card.tsx`); **the real count is
  12**, and `scripts/check-timezone-rendering.js` now holds the authoritative list. These need
  *individual* triage, not a sweep: a Date built from an absolute instant (`new Date(ms)`) genuinely
  shifts across timezones and is a real bug; one built from Y/M/D components renders the intended
  calendar date anywhere and is benign.
- **11 files carry a dash-only date regex** (`/^\d{4}-\d{2}-\d{2}$/`), where Q-130(c) counted 7 — it
  missed `app/api/admin/fix-exercise-units/route.ts`, `app/api/injuries/[id]/route.ts`,
  `app/api/user/profile/route.ts` and `lib/perf/nav-timing.ts`. Confirming Q-130's "all latent today"
  verdict independently: every `localDateString()` call site was traced and **none feeds these
  schemas**, so there was no live bug — but each is one client change away from the 2026-07-19
  ai-chat failure, where a dash-only schema rejected every real request before the handler ran.

  **⚑ Also overtaken same day: Q-130 shipped (#1148) and widened 7 of the 11.** The four that remain
  are the ones Q-130 never knew about, and `scripts/check-date-param-regex.js` holds them. **The
  shrink-only design is what caught this** — the check failed on the merge with *"these files no
  longer carry a dash-only date regex, remove them from GRANDFATHERED"* and named all seven. A
  hand-written list would have silently kept claiming eleven.

  Worth recording as a method note: the first version of this check required `regex(` or `z.string(`
  on the same line and **silently missed the two `const DATE_RE = /…/` copies** — including the one
  Q-130 had already named. A grandfather list generated by a check with a blind spot is worse than a
  hand-written one, because it looks authoritative. The check now keys on the anchored regex literal
  itself, and both const-assigned copies are caught.

---

## 4. Checked and clean

Recorded so the next review does not re-derive them.

- **Index coverage on the hot tables is good.** 64 indexes across 170 migrations; every table in the
  top-15 by scan volume has an appropriate composite index (`oura_heartrate` on `(user_id,
  timestamp)`, `food_logs` on `(user_id, date DESC)`, `exercise_logs` on four covering
  combinations, `oura_ble_clock_anchors` on both `(user_id, created_at DESC)` and `(user_id, epoch,
  anchor_ds)`). No missing-index finding in this review.
- **`users` shows 895,168 seq scans and 0 index scans — this is correct, not a defect.** At a
  handful of rows Postgres will always prefer a sequential scan; the email/oauth_sub/friend_code
  indexes exist and will be chosen when the table grows. Flagging it would be a false positive.
- **The BLE ingest hot path is well bounded.** `aggregateOuraRawSamples` applies `rollupCutoffDs`
  (`adapter.ts:4757`) so the routine path reads a bounded window, and
  `app/api/oura-ble/samples/route.ts:100-131` coalesces concurrent rollups per user, runs them fully
  in the background, and never lets a rollup failure or delay hold the ring cursor. The six
  unbounded full-history reads of `oura_raw_samples` are confined to `previewStepsBackfill()` and
  `getOuraRawSampleSummary()` — both admin-triggered diagnostics, not per-request paths.
- **Rate limiting is correctly user-scoped.** Every `rateLimit()` key in `app/api` embeds a user or
  session id; zero shared buckets, so one account cannot exhaust another's limit.
- **Module-level server state is user-keyed.** `lastRollupAt` and `rollupInFlight`
  (`app/api/oura-ble/samples/route.ts:30,40`) are both `Map<userId, …>`. The only unkeyed
  module-level state found is §3.2.
- **Q-73's hydration fix looks to have held.** The last `React error #418` in production is
  2026-08-07T20:53Z; the fix (#1130) merged 2026-08-07T21:12Z. That is only ~6 hours of clean
  evidence — worth re-checking in a few days before the Known-Issues row is struck, not now.

---

## 5. What was built (dev tooling)

Four checks added to the `Custom Rules` CI job, covering recurring bug classes from CLAUDE.md that
had each already shipped a real bug but were not automated. Each was tested both ways — it passes on
the current tree and fails on a deliberately planted violation.

| script | catches | state today |
|---|---|---|
| `scripts/check-migration-numbers.js` | two migrations claiming the same number (ambiguous apply order; a migration cannot be renamed once applied) | clean; 081/087/146/161 grandfathered. Also prints the next free number — 170, matching the backlog |
| `scripts/check-timezone-rendering.js` | `toLocale*String` without `timeZone` (device-local rendering) | 12 sites grandfathered (Q-130 b); admin + oura-ble consoles exempt per CLAUDE.md |
| `scripts/check-date-param-regex.js` | dash-only date-param Zod schemas | 4 sites grandfathered — was 11 until Q-130 (#1148) widened 7 mid-session |
| `scripts/check-component-size.js` | `.tsx` files over 800 lines | ratchet: the 6 known hotspots may shrink but never grow; any other file crossing 800 fails |

Every grandfather list is **shrink-only** — the script fails if a listed file is fixed but left in
the list, so the debt cannot silently reopen and the lists cannot rot.

**One rule was attempted and deliberately dropped:** `var(--x)` reaching a canvas/chart.js paint API
(canvas cannot resolve CSS custom properties and silently renders black). No reliable grep
distinguishes a canvas paint call from a React inline `style={{ borderColor: 'var(--x)' }}`, which is
perfectly valid — every candidate pattern produced false positives on real inline styles. This
belongs in an ESLint rule where the AST is available, not a grep. Not filed as a backlog item
because it is a tooling idea, not a defect.

---

## 6. Surfaces NOT exercised

No device, no emulator, no browser. The production reads were `pg_stat`/`pg_indexes`/`error_events`
through the read-only `claude_ro` role — **no `EXPLAIN ANALYZE` was run**, because that role reaches
curated views rather than base tables and `pg_relation_size` returns 0 through them. Query *plans*
are therefore inferred from scan counters and table shape, not observed; §2.2's "the plan is
correct" is reasoning about the planner's choice, not a captured plan. Confirming it needs a Railway
console session.

The scan counters are cumulative since the last `pg_stat_reset()` or restart, whose timestamp was
not captured, so the ratios between tables are sound but the absolute rates are not per-day figures.

Nothing in §3 was exercised with a real second account — the multi-user findings are static analysis
of the code paths, not observed behaviour. A genuine second-user pass (seed an account in another
timezone, drive every route as it, diff the outputs) remains undone and is the natural follow-up.
