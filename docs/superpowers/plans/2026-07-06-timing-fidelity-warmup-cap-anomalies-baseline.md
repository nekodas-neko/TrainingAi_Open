# Workout Timing Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the fidelity of workout-time monitoring by (1) capping the warmup bucket and
reattributing the overflow to unaccounted, (2) flagging per-session timing anomalies with absolute
thresholds the existing relative outlier band can't catch, and (3) adding a per-user monitoring
baseline date so a chosen "first viable day" bounds both the audit and planning averages.

**Design:** `docs/superpowers/specs/2026-07-06-timing-fidelity-warmup-cap-anomalies-baseline.md`
(read first — it has the full rationale, the central "relative band can't catch warmup/unaccounted"
constraint, and the chosen constants with justification).

**Architecture:** Two independently-shippable chunks, one PR each.
- **Chunk 1** is pure read-time derivation + admin-card display — **no schema, no migration**:
  warmup cap, overflow→unaccounted, and session anomaly flags in `lib/workout/time-audit.ts`,
  surfaced in `components/admin/time-audit-card.tsx`. Fully unit-testable.
- **Chunk 2** adds the monitoring baseline date — schema/migration + repo + audit & planning
  lower-bound + admin control + route.

Chunk 1 delivers the warmup-cap/anomaly value the user asked about; Chunk 2 is the "clean start
date" and depends on nothing in Chunk 1 (could ship first, but Chunk 1 is the higher-value core).

**Tech Stack:** Next.js 15 API routes, TypeScript, Drizzle/Postgres, vitest. Chunk 2 adds one
idempotent SQL migration.

---

## Grounding (verified against `main`, 2026-07-06)

- `lib/workout/time-audit.ts` — `decomposeSessions` builds the five buckets; `robustStats` does the
  `[median×0.25, ×4]` exclusion for set/rest/transition. Existing constants: `MIN_TRUSTED_SAMPLES`,
  `MIN_SESSION_SEC`. **Before implementing, re-read this file** — the shipped "quality improvements"
  version (session ~206) is the baseline this builds on.
- `app/api/admin/time-audit/route.ts` — admin-gated GET, `days` param 7–365, calls
  `repo.getTimingAuditData(userId, days)` then the three pure functions.
- `components/admin/time-audit-card.tsx` — renders equipment / per-exercise / per-session tables;
  has the days selector and `lowN` dimming.
- `lib/data/postgres/adapter.ts` `getTimingAuditData` (~line 1977) — windows on
  `started_at >= now − days*86.4e6`. **This is where Chunk 2's baseline lower-bound goes.**
- `lib/data/postgres/slices/periodization.ts` `getAvgSetDurationPerExercise` (~line 290) — the
  planning consumer; queries all history, no date lower bound. **Chunk 2 threads the baseline here
  too.**
- `lib/data/postgres/schema.ts` `users` table (line ~7-37) — Chunk 2 adds `timing_baseline_date`.
- Latest migration is `112_oura_activity_sleep_extras.sql`; **claim `113` for Chunk 2** (verify no
  collision against the directory AND open PRs/plans at implementation time, per CLAUDE.md).

---

## Chunk 1 — Warmup cap + session anomaly flags (read-time only, no schema)

**Branch:** `feat/timing-warmup-cap-anomalies` (fresh from `main`).

### Task 1.1 — Constants + `decomposeSessions` warmup cap and overflow

**Files:**
- Modify: `lib/workout/time-audit.ts`
- Modify: `lib/__tests__/time-audit.test.ts`

- [ ] **Step 1: Write the failing tests** — add to `lib/__tests__/time-audit.test.ts`:

```ts
describe('decomposeSessions — warmup cap + overflow to unaccounted', () => {
  const cap = 900 // MAX_PLAUSIBLE_WARMUP_SEC
  it('caps warmup at the ceiling and rolls the overflow into unaccounted', () => {
    // 40-min session; raw warmup 22 min (warmupEndedAt 22 min in), no sets → work/rest/transition 0
    const startedAt = 0
    const sessions = [{ workoutSessionId: 'a', startedAt, completedAt: 40 * 60_000, warmupEndedAt: 22 * 60_000 }]
    const [d] = decomposeSessions(sessions, [], [])
    expect(d.rawWarmupSec).toBe(22 * 60)
    expect(d.warmupSec).toBe(cap)                 // capped to 15 min
    expect(d.warmupOverflowSec).toBe(22 * 60 - cap)
    // total 2400s − warmup 900 − 0 − 0 − 0 = 1500 unaccounted (the 7-min overflow is inside it)
    expect(d.unaccountedSec).toBe(2400 - cap)
  })
  it('leaves a normal warmup untouched (no overflow, warmupSec === rawWarmupSec)', () => {
    const sessions = [{ workoutSessionId: 'b', startedAt: 0, completedAt: 40 * 60_000, warmupEndedAt: 10 * 60_000 }]
    const [d] = decomposeSessions(sessions, [], [])
    expect(d.warmupSec).toBe(10 * 60)
    expect(d.rawWarmupSec).toBe(10 * 60)
    expect(d.warmupOverflowSec).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm vitest run lib/__tests__/time-audit.test.ts`
  (fields `rawWarmupSec`/`warmupOverflowSec` don't exist; `warmupSec` isn't capped).

- [ ] **Step 3: Implement** — in `lib/workout/time-audit.ts`:

  1. Add the constant near `MIN_SESSION_SEC`:
```ts
// A warmup longer than this is implausible as actual warming up — it's almost
// always dead time before the first logged set (stepped away, phone). Cap the
// reported warmup here; the overflow rolls into unaccounted (an honest bucket for
// untracked time) rather than inflating "warmup". The raw value is retained and
// surfaced as an anomaly. A *relative* outlier band can't catch this — a 22-vs-12
// min warmup is only ~1.8×, and warmup has no median to band against anyway.
export const MAX_PLAUSIBLE_WARMUP_SEC = 900 // 15 min
```
  2. Extend `SessionDecomposition` with `rawWarmupSec: number | null` and
     `warmupOverflowSec: number`.
  3. In `decomposeSessions`'s `.map`, after computing the existing `warmupSec` (rename it to
     `rawWarmupSec`), derive:
```ts
      const cappedWarmupSec = rawWarmupSec != null ? Math.min(rawWarmupSec, MAX_PLAUSIBLE_WARMUP_SEC) : null
      const warmupOverflowSec = rawWarmupSec != null ? Math.max(0, rawWarmupSec - MAX_PLAUSIBLE_WARMUP_SEC) : 0
```
     and use `cappedWarmupSec` (not raw) in the `unaccountedSec = totalSec - (cappedWarmupSec ?? 0) - workSec - restSec - transitionSec` subtraction. Return `warmupSec: cappedWarmupSec`, plus `rawWarmupSec` and `warmupOverflowSec`.

- [ ] **Step 4: Run to verify PASS** (both new tests + all pre-existing `decomposeSessions` tests —
  the normal-warmup path is byte-identical to before).

- [ ] **Step 5: Commit**

```bash
git add lib/workout/time-audit.ts lib/__tests__/time-audit.test.ts
git commit -m "feat: cap implausible warmup, reattribute overflow to unaccounted in time-audit"
```

### Task 1.2 — Session anomaly detection

**Files:**
- Modify: `lib/workout/time-audit.ts`
- Modify: `lib/__tests__/time-audit.test.ts`

- [ ] **Step 1: Write the failing tests**:

```ts
describe('decomposeSessions — anomaly flags', () => {
  it('flags an over-cap warmup with the raw seconds', () => {
    const sessions = [{ workoutSessionId: 'a', startedAt: 0, completedAt: 40 * 60_000, warmupEndedAt: 22 * 60_000 }]
    const [d] = decomposeSessions(sessions, [], [])
    const warm = d.anomalies.find(x => x.type === 'warmup_over_cap')
    expect(warm?.sec).toBe(22 * 60)
  })
  it('flags a runaway set and excessive unaccounted', () => {
    // 60-min session, one 12-min set, nothing else logged → huge unaccounted
    const sessions = [{ workoutSessionId: 'b', startedAt: 0, completedAt: 60 * 60_000, warmupEndedAt: 60_000 }]
    const sets = [{ workoutSessionId: 'b', exerciseName: 'Bench', equipment: ['barbell'], setNumber: 1, reps: 5, setTimeSec: 12 * 60, restTimeSec: null, setStartMs: 60_000 }]
    const [d] = decomposeSessions(sessions, sets, [])
    expect(d.anomalies.map(a => a.type)).toContain('runaway_set')
    expect(d.anomalies.map(a => a.type)).toContain('excessive_unaccounted')
  })
  it('has no anomalies for a clean session', () => {
    const sessions = [{ workoutSessionId: 'c', startedAt: 0, completedAt: 30 * 60_000, warmupEndedAt: 8 * 60_000 }]
    const sets = [{ workoutSessionId: 'c', exerciseName: 'Bench', equipment: ['barbell'], setNumber: 1, reps: 5, setTimeSec: 40, restTimeSec: 120, setStartMs: 8 * 60_000 }]
    const [d] = decomposeSessions(sessions, sets, [])
    expect(d.anomalies).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify FAIL** (`anomalies` field doesn't exist).

- [ ] **Step 3: Implement** — add constants + type + detection in `time-audit.ts`:

```ts
export const MAX_PLAUSIBLE_UNACCOUNTED_SEC = 600 // 10 min
export const SET_TIME_SANITY_CEILING_SEC = 600   // 10 min — beyond this a single set is a runaway timer
export const REST_TIME_SANITY_CEILING_SEC = 900  // 15 min — beyond this a single rest is a runaway timer

export type SessionAnomalyType = 'warmup_over_cap' | 'excessive_unaccounted' | 'runaway_set' | 'runaway_rest'
export interface SessionAnomaly { type: SessionAnomalyType; sec: number; detail: string }
```

Add `anomalies: SessionAnomaly[]` to `SessionDecomposition`. Inside `decomposeSessions`'s `.map`,
after the buckets are computed, build the array:
- `warmup_over_cap` when `rawWarmupSec != null && rawWarmupSec > MAX_PLAUSIBLE_WARMUP_SEC` (`sec: rawWarmupSec`).
- `excessive_unaccounted` when `unaccountedSec > MAX_PLAUSIBLE_UNACCOUNTED_SEC` (`sec: unaccountedSec`).
- `runaway_set` when `max(wsSets.setTimeSec) > SET_TIME_SANITY_CEILING_SEC` (`sec:` that max).
- `runaway_rest` when `max(wsSets.restTimeSec) > REST_TIME_SANITY_CEILING_SEC` (`sec:` that max).

Keep `detail` short and human (`` `${Math.round(sec/60)}m warmup — ${Math.round((sec-MAX_PLAUSIBLE_WARMUP_SEC)/60)}m over cap` ``, etc.). Extract a small pure `detectSessionAnomalies(...)` helper if it keeps `decomposeSessions` readable — exported so it can be unit-tested directly.

- [ ] **Step 4: Run to verify PASS.** Run the full file + `pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add lib/workout/time-audit.ts lib/__tests__/time-audit.test.ts
git commit -m "feat: flag per-session timing anomalies (warmup/unaccounted/runaway set+rest)"
```

### Task 1.3 — Surface cap + anomalies in the admin card

**Files:**
- Modify: `components/admin/time-audit-card.tsx`

No component test (consistent with the rest of this admin-only card; verify manually in Step 3).

- [ ] **Step 1:** Extend the `SessionRow` interface with `rawWarmupSec: number | null`,
  `warmupOverflowSec: number`, and `anomalies: { type: string; sec: number; detail: string }[]`.

- [ ] **Step 2:** In the "Recent sessions" table: when `warmupOverflowSec > 0`, render the warmup
  cell as the capped value with a small muted suffix showing the raw (e.g. `15.0m` + `⚠ raw 22m`).
  Add a trailing "flags" cell (or an expandable row) listing each anomaly's `detail` with a
  `TriangleAlert` icon — reuse the existing compact `text-xs` aesthetic and the already-imported
  lucide icon set. Don't add colour-only signalling (pair the icon with the text, per CLAUDE.md).

- [ ] **Step 3: Typecheck + lint + manual verify** — `pnpm dev`, Admin → Time Audit. Seed a
  session with a 22-min pre-first-set gap and a 12-min runaway set for the test user (raw
  `INSERT`s, as prior time-audit tasks did), confirm: warmup shows capped 15m with a raw-22m note,
  the overflow appears in unaccounted, and the ⚠ flags list `warmup_over_cap` + `runaway_set`.
  Delete the synthetic rows after.

- [ ] **Step 4: Commit + Chunk 1 wrap-up** — full gate (`pnpm lint && pnpm exec tsc --noEmit &&
  pnpm test && pnpm build`). Patch version bump + `lib/changelog.ts` entry (admin-facing, but a
  user-visible number-behaviour change in the audit — bug-fix-class, merge-gate-exempt). Push, open
  PR. State NOT-exercised surfaces: on-device Samsung WebView rendering of the admin card.

```bash
git add components/admin/time-audit-card.tsx
git commit -m "feat: show warmup cap + anomaly flags in the admin time-audit card"
```

---

## Chunk 2 — Monitoring baseline date

**Branch:** `feat/timing-monitoring-baseline` (fresh from `main`; if Chunk 1 is unmerged, still
branch from `main` — the two don't share code beyond the changelog/version bump).

### Task 2.1 — Migration + schema + repo mapper

**Files:**
- Add: `lib/data/postgres/migrations/113_timing_baseline_date.sql` (claim `113`; re-verify at impl time)
- Modify: `lib/data/postgres/schema.ts` (`users.timingBaselineDate`)
- Modify: the `users` row→object mapper(s) and any SELECT list that hydrates the user/session
  (grep `rowToUser`/user SELECTs — per CLAUDE.md, update **every** mapper or the field silently
  fails to persist).

- [ ] **Step 1:** Migration — idempotent:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS timing_baseline_date date;
```
- [ ] **Step 2:** Schema: `timingBaselineDate: date('timing_baseline_date', { mode: 'string' }),`.
- [ ] **Step 3:** Add `getTimingBaselineDate(userId)` + `setTimingBaselineDate(userId, date|null)`
  to the repository interface + adapter (a scoped `UPDATE ... WHERE id = userId`). Update every
  user mapper to carry the new column.
- [ ] **Step 4:** `pnpm exec tsc --noEmit`, `pnpm db:local` (applies the migration cleanly), commit.

### Task 2.2 — Thread the baseline into audit + planning windows

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (`getTimingAuditData` — clamp `since`)
- Modify: `lib/data/postgres/slices/periodization.ts` (`getAvgSetDurationPerExercise` — add lower bound)

- [ ] **Step 1:** In `getTimingAuditData`, read the baseline; set the effective window start to
  `max(now − days*86.4e6, timingBaselineDate)` (compare in UTC-day terms; the column is a plain
  date — construct its midnight consistently with the repo's existing day helpers, **not**
  `new Date(str)` raw, per the CLAUDE.md date-arithmetic rule).
- [ ] **Step 2:** In `getAvgSetDurationPerExercise`, add `gte(s.workoutSessions.startedAt,
  baselineMidnight)` to the `where` when a baseline is set. Pass the baseline in from the caller
  (or fetch it inside — keep it one query).
- [ ] **Step 3:** Add a unit test where feasible for the clamping helper (extract the
  `max(windowStart, baseline)` decision into a pure function so it's testable without a DB).
- [ ] **Step 4:** `pnpm exec tsc --noEmit && pnpm test`, commit.

### Task 2.3 — Admin baseline control + route

**Files:**
- Add: `app/api/admin/timing-baseline/route.ts` (GET returns `{ date }`; POST `{ date: string|null }`
  sets it — admin-gated, mirror `time-audit/route.ts`'s `requireAdmin` + Zod-validate the date)
- Modify: `components/admin/time-audit-card.tsx` (baseline row: current value + "Set to today" /
  "Clear", refetch the audit on change)

- [ ] **Step 1:** Route — `requireAdmin`, Zod `{ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }`
  on POST; "today" is computed client-side via `todayInTz()` and sent explicitly (don't derive
  "today" server-side from UTC — CLAUDE.md timezone rule).
- [ ] **Step 2:** Card control — small row above the day selector; on change, POST then re-`load()`.
- [ ] **Step 3: Manual verify** — `pnpm dev`: set baseline to today, confirm the audit window
  clamps (older seeded sessions drop out) and planning `getAvgSetDurationPerExercise` respects it
  (spot-check via a prescribe call or a direct query); clear it, confirm full history returns.
- [ ] **Step 4: Chunk 2 wrap-up** — full gate + `pnpm db:local` clean apply. Patch bump + changelog
  (user-visible: a new admin control + monitoring-window behaviour). Push, open PR. NOT-exercised:
  on-device rendering; the migration applies locally but re-verify it's idempotent on a
  partially-migrated DB per the CLAUDE.md Postgres-migration rule.

---

## Self-review checklist (per chunk)

- Chunk 1 mutates **no stored value** — confirm `decomposeSessions` only reinterprets at read time.
- Constants all live in `time-audit.ts` (one place); no duplicated thresholds in the card.
- Anomaly flags never feed an average — `robustStats`/`robustAvgSetDurationsByExercise` untouched.
- Chunk 2: every user row→object mapper carries `timing_baseline_date`; migration is idempotent and
  registered; date math uses the repo's tz-aware helpers, never raw `new Date(string)`.
- Per CLAUDE.md, each PR states which surfaces were NOT exercised (on-device admin-card render).
