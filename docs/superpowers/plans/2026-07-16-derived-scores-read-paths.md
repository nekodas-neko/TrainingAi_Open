# Derived-Scores Read Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app's own daily-derived scores (`oura_daily_derived`) actually feed the surfaces that today still read the frozen Oura-Cloud `oura_daily` columns — so the 14-day score sparklines stop rendering null for every post-re-key day, Body Battery stops anchoring on a flat 50 on BLE-only days, and the Sleep detail's contributor bars show our own freshly-computed breakdown instead of empty frozen-Cloud JSONB.

**Architecture:** Three read-path fixes plus one small persist. (1) `/api/health/trends` fetches `getOuraDailyDerived` alongside `getOuraDaily` and coalesces derived-over-Cloud per day. (2) `/api/body-battery` anchors on today's persisted derived readiness, falling back to our own `computeSleepScore` of last night, then the frozen Cloud fields, then 50. (3) `/api/readiness-score` stops discarding `computeSleepScore(...).components`: it persists our own sleep score + contributors into `oura_daily_derived.sleep_score/sleep_contributors` (same best-effort COALESCE-upsert pattern its readiness persist already uses) and falls back to them in the response's `sleepContributors` field. A tiny mapping helper in `lib/health/sleep-score.ts` translates the component keys to the Cloud contributor key names the existing `ContributorBars` UI already renders.

**Tech Stack:** TypeScript, Next.js 15 route handlers, the repository pattern (`getOuraDailyDerived`/`upsertOuraDailyDerived` — already implemented, zero production callers today), `lib/health/sleep-score.ts`, vitest (DB integration tests run against local/CI Postgres).

---

## Why now

Source: **`docs/reviews/2026-07-16-data-efficiency-review.md`**, findings **S1 (§3.1, High)**, **S2 (§3.2, High)**, **S6 (§1.3, Medium)** — the three "derived table is write-only / consumers run on frozen Cloud data" gaps. Since the 2026-07-07 BLE re-key, `oura_daily.readinessScore/sleepScore/activityScore` and `sleep_contributors` have no live writer, so:

- **S1:** the Sleep/Readiness/Activity 14-day sparklines (`TrendSparkline` fed by `/api/health/trends`) render null for every post-re-key day, while the readiness route persists a fresh composite into `oura_daily_derived` daily that nothing reads back.
- **S2:** Body Battery's whole-day curve anchors at a constant 50 on BLE-only days despite our own composite existing one route over.
- **S6:** `computeSleepScore` runs on every readiness read but its per-contributor breakdown is thrown away, while the Sleep detail's contributor bars read the frozen Cloud JSONB (empty on BLE nights).

This is the first real read path for `oura_daily_derived` and makes the existing persist work pay off. Bug-fix class (features already on `main` showing stale/empty data) → **patch** version bump, standard-change merge path.

**Branch:** `fix/derived-scores-read-paths` (start from freshly-fetched `main`: `git fetch origin main && git remote prune origin && git checkout -B fix/derived-scores-read-paths origin/main`).

## Verified against current `main` (2026-07-16, post PRs #570/#571/#575)

- `app/api/health/trends/route.ts` — Cloud-only score reads at **lines 70–72** inside the day loop (63–84). ✓ matches the review.
- `app/api/body-battery/route.ts` — anchor block at **lines 107–119**; untouched by today's stress PRs (#570/#571/#575 changed the stress series + `MODEL_VERSION`, now `v3:…:oura-rule` at line 50). ✓
- `app/api/readiness-score/route.ts` — `computeSleepScore(lastSleep, tz)?.score` at **line 152** (only `.score` kept); best-effort readiness persist at **lines 342–352**; `sleepContributors: ouraToday?.sleepContributors ?? null` at **line 369**. ✓
- `getOuraDailyDerived` interface now at `lib/data/repository.ts:729` and slice at `lib/data/postgres/slices/oura.ts:660` (review cited 727/639 — minor drift from today's merges, same code). Adapter delegation exists (`adapter.ts:4811`). Still **zero production callers**. ✓
- `upsertOuraDailyDerived` (slice line 643) COALESCEs `excluded` over existing per provided key — a **non-null new value wins**, a null/absent key never clobbers. `sleep_score`/`sleep_contributors` columns exist (migration 123) and are never written in production. ✓
- `computeSleepScore` returns `{ score, components }` where `components` keys are **camelCase**: `totalSleep`, `efficiency`, `rem`, `deep`, `latency`, `timing`, `restfulness` (each 0–100, absent when its input is missing). The Cloud JSONB the UI renders uses **snake_case**: `total_sleep`, `efficiency`, `rem_sleep`, `deep_sleep`, `latency`, `timing`, `restfulness`. `ContributorBars` (`components/health/health-score-detail.tsx:65-86`) renders any `Record<string, number|null>` via `key.replace(/_/g, " ")` — so mapping our keys onto the Cloud names makes own-data bars read identically ("total sleep", "rem sleep", …). `readiness-card.tsx:221-222` is the second consumer of the response field; both pick up the fallback with no UI change.
- `body-battery-card.tsx:143-144,174-175` only branches on `anchorSource === 'readiness' | 'sleep'` — the copy ("from this morning's readiness" / "from last night's sleep") stays accurate for derived-readiness and own-sleep-score anchors, so the union and the card **stay unchanged**; the snapshot-table provenance shift is captured by bumping `MODEL_VERSION` v3→v4 (the tuning doc's mechanism for never mixing constant/semantics sets).
- CI runs the DB integration tests against a real Postgres service (`.github/workflows/ci.yml` — `DATABASE_URL` set in the Tests job); locally they run against the port-5433 dev DB and `describe.skipIf(!process.env.DATABASE_URL)` skips them elsewhere. Route-level tests with a mocked `@/auth` are established convention (`app/api/workout-entry/__tests__/workout-entry-tombstone.test.ts`).

**Known limitation (state in the PR, journal it):** `oura_daily_derived` only has rows from the day each persist first ran — there is no backfill, so sparklines fill in from persist-date forward (readiness: persisting since ~2026-07-15; sleep: starts with this PR). Derived `activity_score` is never written today (P-D will populate it), so the activity sparkline stays honestly Cloud-only-then-null until then — the coalesce is already in place for when P-D lands.

## Repo rules this plan honours

- **Repository pattern** — routes call `repo.getOuraDailyDerived`/`repo.upsertOuraDailyDerived`; no raw SQL in routes.
- **One Formula, One Place** — `computeSleepScore` is imported (readiness route already does; body-battery adds the import); the key mapping lives once in `lib/health/sleep-score.ts` next to the components it maps.
- **Best-effort persist** — the new sleep persist copies the readiness persist's try/catch-log pattern; a persist failure never fails the read.
- **COALESCE partial-column upsert** — the sleep persist writes only `sleepScore`/`sleepContributors`, never the shared `source`/`model_versions` columns (same discipline as the readiness persist's comment: those would clobber body-comp/illness provenance on the same row).
- **No cache-group changes** — all three changes are server-side value fixes; no response *shape* changes (`sleepContributors` was already in the interface, `anchorSource` union unchanged), no new cache keys. The trends route keeps its `Cache-Control: private, max-age=60, stale-while-revalidate=120` header; body-battery keeps its 15/30 header.

## File structure

**Create:**
- `app/api/readiness-score/__tests__/sleep-contributors-persist.test.ts` — DB integration test (S6).
- `app/api/health/trends/__tests__/derived-coalesce.test.ts` — DB integration test (S1).
- `app/api/body-battery/__tests__/anchor-source.test.ts` — DB integration test (S2).

**Modify:**
- `lib/health/sleep-score.ts` — export `sleepComponentsToContributors` key-mapping helper.
- `lib/health/__tests__/sleep-score.test.ts` — unit tests for the helper.
- `app/api/readiness-score/route.ts` — keep the full `computeSleepScore` result; persist `sleep_score`/`sleep_contributors`; response fallback.
- `app/api/health/trends/route.ts` — fetch derived rows; coalesce derived-over-Cloud per day.
- `app/api/body-battery/route.ts` — anchor chain: derived readiness → own sleep score → Cloud → 50; `MODEL_VERSION` v4.
- `package.json` (patch bump) + `lib/changelog.ts` — final task.
- `projectOverview.md` + `docs/overview/history-newest.md` (or current newest journal) + `docs/planned_upgrades.md` Batch S (tick S1/S2/S6) + the `docs/implementation-backlog.md` entry for this plan — final task, same PR.

---

### Task 1: `sleepComponentsToContributors` — one mapping, Cloud-shaped keys

**Files:**
- Modify: `lib/health/sleep-score.ts`
- Test: `lib/health/__tests__/sleep-score.test.ts`

We persist and serve the contributors under the **Cloud contributor key names** (`total_sleep`, `rem_sleep`, `deep_sleep`, …) so (a) `ContributorBars` renders identical labels whether Cloud or own data feeds it, and (b) any future reader of `oura_daily_derived.sleep_contributors` sees one key vocabulary regardless of provenance.

- [ ] **Step 1: Write the failing test** — append to the existing `describe` file (do not create a new file):

```typescript
// append to lib/health/__tests__/sleep-score.test.ts
import { sleepComponentsToContributors } from '@/lib/health/sleep-score'

describe('sleepComponentsToContributors', () => {
  it('maps component keys onto the Oura Cloud contributor key names', () => {
    expect(sleepComponentsToContributors({
      totalSleep: 90, efficiency: 80, rem: 70, deep: 60, latency: 95, timing: 97, restfulness: 66,
    })).toEqual({
      total_sleep: 90, efficiency: 80, rem_sleep: 70, deep_sleep: 60, latency: 95, timing: 97, restfulness: 66,
    })
  })

  it('omits absent components instead of fabricating them (BLE night without stages)', () => {
    const out = sleepComponentsToContributors({ totalSleep: 85, efficiency: 78, timing: 90 })
    expect(out).toEqual({ total_sleep: 85, efficiency: 78, timing: 90 })
    expect(out).not.toHaveProperty('rem_sleep')
    expect(out).not.toHaveProperty('deep_sleep')
  })

  it('round-trips a real computeSleepScore result', () => {
    const r = computeSleepScore(night({ efficiency: 92, remSleepHours: 1.4, deepSleepHours: 1.1, onsetLatencySec: 12 * 60 }), TZ)!
    const out = sleepComponentsToContributors(r.components)
    expect(out.total_sleep).toBe(r.components.totalSleep)
    expect(out.rem_sleep).toBe(r.components.rem)
    expect(out.deep_sleep).toBe(r.components.deep)
  })
})
```

(The `import`, `night()` helper and `TZ` constant already exist at the top of the file — merge the named import into the existing `computeSleepScore` import line.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/health/__tests__/sleep-score.test.ts`
Expected: FAIL — `sleepComponentsToContributors` is not exported.

- [ ] **Step 3: Implement** — append to `lib/health/sleep-score.ts` (below `computeSleepScore`):

```typescript
// SleepScoreResult.components keys → the Oura Cloud daily_sleep contributor key names
// (the vocabulary oura_daily.sleep_contributors already uses and ContributorBars renders).
// One mapping, one place — both the oura_daily_derived persist and the readiness-score
// response fallback go through this, so own-data bars are indistinguishable from Cloud bars.
const CONTRIBUTOR_KEYS: Record<string, string> = {
  totalSleep: 'total_sleep',
  rem: 'rem_sleep',
  deep: 'deep_sleep',
  efficiency: 'efficiency',
  latency: 'latency',
  timing: 'timing',
  restfulness: 'restfulness',
}

export function sleepComponentsToContributors(components: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(components)) out[CONTRIBUTOR_KEYS[k] ?? k] = v
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/health/__tests__/sleep-score.test.ts`
Expected: PASS (existing tests + 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/health/sleep-score.ts lib/health/__tests__/sleep-score.test.ts
git commit -m "Map own sleep-score components onto Cloud contributor key names"
```

---

### Task 2 (S6): Persist own sleep score + contributors; serve them when Cloud is empty

**Files:**
- Modify: `app/api/readiness-score/route.ts`
- Test: `app/api/readiness-score/__tests__/sleep-contributors-persist.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
// app/api/readiness-score/__tests__/sleep-contributors-persist.test.ts
// S6 (data-efficiency review 2026-07-16 §1.3): the readiness route must persist our own
// sleep score + contributors into oura_daily_derived and fall back to them in the
// response's sleepContributors when the Cloud JSONB is absent (every BLE night).
// Runs only against a real Postgres — skips without DATABASE_URL (CI's Tests job sets one).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005c6'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))

describe.skipIf(!canRun)('readiness-score — own sleep contributors persist + fallback (S6)', () => {
  let pool: import('pg').Pool
  let today: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz, todayMidnightUtc } = await import('@/lib/date-utils')
    pool = getPool()
    today = todayInTz('Australia/Brisbane')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `sleep-contrib-${TEST_USER_ID}@example.com`],
    )
    // One BLE-style night ending this morning: 22:00 local → 06:00 local, no Cloud row at all.
    const mid = todayMidnightUtc('Australia/Brisbane')
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, onset_latency_sec)
       VALUES ($1, $2, $3, $4, 8, 92, 720)
       ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, today, new Date(mid.getTime() - 2 * 3_600_000), new Date(mid.getTime() + 6 * 3_600_000)],
    )
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]) // cascades all rows
  })

  it('serves own contributors when Cloud sleep_contributors is null, and persists them', async () => {
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    // Response fallback: Cloud JSONB absent → our own mapped components.
    expect(body.sleepContributors).not.toBeNull()
    expect(body.sleepContributors).toHaveProperty('total_sleep')
    expect(body.sleepContributors).toHaveProperty('efficiency')
    expect(body.sleepContributors).toHaveProperty('latency')
    expect(body.sleepContributors).not.toHaveProperty('rem_sleep') // no stage data → never fabricated
    expect(body.sleepScore).toBeGreaterThan(0)

    // Persist: same score + contributors landed in oura_daily_derived for the wake day.
    const { rows } = await pool.query(
      `SELECT sleep_score, sleep_contributors FROM oura_daily_derived WHERE user_id = $1 AND day = $2`,
      [TEST_USER_ID, today],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].sleep_score).toBe(body.sleepScore)
    expect(rows[0].sleep_contributors).toEqual(body.sleepContributors)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/readiness-score/__tests__/sleep-contributors-persist.test.ts`
Expected: FAIL — `body.sleepContributors` is null (Cloud-only read) and the `oura_daily_derived` SELECT returns 0 rows with a non-null `sleep_score`.

- [ ] **Step 3: Implement in `app/api/readiness-score/route.ts`**

3a. Extend the import at line 10:

```typescript
import { computeSleepScore, sleepComponentsToContributors } from '@/lib/health/sleep-score'
```

3b. Replace line 152 (`const sleepScore100 = lastSleep ? computeSleepScore(lastSleep, tz)?.score ?? null : null`) with:

```typescript
  const sleepScoreResult = lastSleep ? computeSleepScore(lastSleep, tz) : null
  const sleepScore100 = sleepScoreResult?.score ?? null
  const ownSleepContributors = sleepScoreResult ? sleepComponentsToContributors(sleepScoreResult.components) : null
```

(`sleepScore100` keeps its name — it feeds `sleepComponent`, the A4 composite's `previousNightScore` at ~line 264, and the response's `sleepScore` fallback at ~line 365; none of those change.)

3c. Directly **after** the existing readiness persist block (lines 342–352), add a second, independently-gated best-effort persist. Kept separate deliberately: different gate (`sleepScoreResult` needs only a sleep session, not the A4 summary) and different day key (`lastSleep.date` is the wake day of the actual scored night; `latestSummary.date` can lag it when the rollup hasn't run yet). Writes only the sleep_* columns — never the shared `source`/`model_versions` (see the readiness persist's comment). COALESCE means a later recompute with richer inputs (e.g. staged REM/deep arriving) overwrites with the better value, since a non-null `excluded` wins:

```typescript
  // Persist our own sleep score + contributor breakdown (S6 — data-efficiency review §1.3).
  // Same compute-and-persist posture as the readiness block above; the Sleep detail's
  // contributor bars stop depending on the frozen Cloud JSONB. Best-effort: a persist
  // failure must never fail the read.
  if (sleepScoreResult && lastSleep) {
    try {
      await repo.upsertOuraDailyDerived(userId, lastSleep.date, {
        sleepScore: sleepScoreResult.score,
        sleepContributors: ownSleepContributors,
      })
    } catch (err) {
      console.error('[readiness-score] sleep-score persist failed (read still served):', err)
    }
  }
```

3d. Change the response field at line 369 from

```typescript
    sleepContributors:       ouraToday?.sleepContributors           ?? null,
```

to

```typescript
    sleepContributors:       ouraToday?.sleepContributors ?? ownSleepContributors,
```

(`ownSleepContributors` is already `Record<string, number> | null`, assignable to the interface's `Record<string, number | null> | null` — no interface change, no cache-group change. Both response consumers — `health-score-detail.tsx` via `contributorsField="sleepContributors"` and `readiness-card.tsx:221` — pick this up with zero UI edits.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/api/readiness-score/__tests__/sleep-contributors-persist.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "readiness-score" || echo clean`
Expected: `clean`

```bash
git add app/api/readiness-score/route.ts app/api/readiness-score/__tests__/sleep-contributors-persist.test.ts
git commit -m "Persist own sleep score + contributors; serve them when Cloud JSONB is empty"
```

---

### Task 3 (S1): Trends sparklines read derived-over-Cloud

**Files:**
- Modify: `app/api/health/trends/route.ts`
- Test: `app/api/health/trends/__tests__/derived-coalesce.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
// app/api/health/trends/__tests__/derived-coalesce.test.ts
// S1 (data-efficiency review 2026-07-16 §3.1): /api/health/trends must coalesce
// oura_daily_derived scores over the frozen-Cloud oura_daily columns per day, so
// post-re-key days stop rendering null in the 14-day sparklines.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005c1'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))

describe.skipIf(!canRun)('health/trends — derived-over-Cloud coalesce (S1)', () => {
  let pool: import('pg').Pool
  let dDerivedOnly: string, dCloudOnly: string, dBoth: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    const { todayInTz, shiftDateStr } = await import('@/lib/date-utils')
    pool = getPool()
    const today = todayInTz('Australia/Brisbane')
    dDerivedOnly = shiftDateStr(today, -3)  // BLE era: derived row only
    dCloudOnly   = shiftDateStr(today, -5)  // Cloud era: oura_daily only
    dBoth        = shiftDateStr(today, -7)  // both → derived must win

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `trends-coalesce-${TEST_USER_ID}@example.com`],
    )
    await pool.query(
      `INSERT INTO oura_daily (user_id, date, readiness_score, sleep_score, activity_score)
       VALUES ($1, $2, 61, 62, 63), ($1, $3, 41, 42, 43)`,
      [TEST_USER_ID, dCloudOnly, dBoth],
    )
    const repo = await getRepository()
    await repo.upsertOuraDailyDerived(TEST_USER_ID, dDerivedOnly, { readinessScore: 71, sleepScore: 72 })
    await repo.upsertOuraDailyDerived(TEST_USER_ID, dBoth, { readinessScore: 91, sleepScore: 92 })
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('fills BLE-era days from derived, keeps Cloud-era days, and prefers derived when both exist', async () => {
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(200)
    const { trends } = await res.json() as { trends: { date: string; readinessScore: number | null; sleepScore: number | null; activityScore: number | null }[] }
    const byDate = new Map(trends.map(t => [t.date, t]))

    // Derived-only day: was null before this change.
    expect(byDate.get(dDerivedOnly)?.readinessScore).toBe(71)
    expect(byDate.get(dDerivedOnly)?.sleepScore).toBe(72)
    expect(byDate.get(dDerivedOnly)?.activityScore).toBeNull() // derived activity never written yet — honest null

    // Cloud-only day: unchanged.
    expect(byDate.get(dCloudOnly)?.readinessScore).toBe(61)
    expect(byDate.get(dCloudOnly)?.activityScore).toBe(63)

    // Both: derived wins per score; Cloud still backfills the scores derived lacks.
    expect(byDate.get(dBoth)?.readinessScore).toBe(91)
    expect(byDate.get(dBoth)?.sleepScore).toBe(92)
    expect(byDate.get(dBoth)?.activityScore).toBe(43)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/health/trends/__tests__/derived-coalesce.test.ts`
Expected: FAIL — `dDerivedOnly` day has `readinessScore: null` and `dBoth` shows the Cloud 41, not 91.

- [ ] **Step 3: Implement in `app/api/health/trends/route.ts`**

3a. Add the derived fetch to the parallel read (lines 43–47):

```typescript
  const [ouraRows, derivedRows, bodyRows, workoutSessions] = await Promise.all([
    repo.getOuraDaily(userId, from14dIso, todayIso),
    repo.getOuraDailyDerived(userId, from14dIso, todayIso),
    repo.listBodyMetrics(userId, from14dIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, from14dDate),
  ])
```

3b. Below `ouraByDate` (line 49), add:

```typescript
  // Our own persisted daily scores (oura_daily_derived) — the live writer post-re-key.
  // Coalesced over the frozen Cloud columns per day/per score below (S1).
  const derivedByDate = new Map(derivedRows.map(r => [r.day, r]))
```

3c. In the day loop, fetch the derived row next to `oura` (line 65) and coalesce the three scores (lines 70–72):

```typescript
    const derived = derivedByDate.get(d)
```

```typescript
      readinessScore: derived?.readinessScore ?? oura?.readinessScore ?? null,
      sleepScore: derived?.sleepScore ?? oura?.sleepScore ?? null,
      activityScore: derived?.activityScore ?? oura?.activityScore ?? null,
```

Everything else in the route — `wornHours` (still Cloud/BLE `nonWearTimeSec`), body metrics, workout aggregation, and the SWR `Cache-Control` header on the response — stays exactly as is.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/api/health/trends/__tests__/derived-coalesce.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "health/trends" || echo clean`
Expected: `clean`

```bash
git add app/api/health/trends/route.ts app/api/health/trends/__tests__/derived-coalesce.test.ts
git commit -m "Coalesce derived daily scores over frozen Cloud columns in health trends"
```

---

### Task 4 (S2): Body Battery anchors on our own composite

**Files:**
- Modify: `app/api/body-battery/route.ts`
- Test: `app/api/body-battery/__tests__/anchor-source.test.ts`

Anchor precedence (per the review): **today's persisted derived readiness → our own sleep score from last night's `sleep_sessions` row → frozen Cloud (readiness, then sleep) → 50.** The ordering hazard the sleep-score fallback exists for: today's derived readiness row is only written once `/api/readiness-score` has run at least once today — before that (early morning, or a day the readiness surface was never opened) the sleep-score fallback carries the anchor. The Cloud arms are legacy-only — post-re-key, today's `oura_daily` scores are permanently null — but stay in the chain so historical behaviour is strictly preserved. `anchorSource` labels stay `'readiness'`/`'sleep'` (still semantically true for the new sources; the card copy at `body-battery-card.tsx:143-144,174-175` remains accurate untouched); the provenance change is versioned via `MODEL_VERSION` v3→v4 so tuning analysis never mixes anchor semantics.

- [ ] **Step 1: Write the failing integration test**

```typescript
// app/api/body-battery/__tests__/anchor-source.test.ts
// S2 (data-efficiency review 2026-07-16 §3.2): the day's battery curve must anchor on our
// own derived readiness (or our own sleep score) before falling back to the frozen Cloud
// columns / flat 50. Assertions run in escalating-precedence order on one user.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005c2'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

describe.skipIf(!canRun)('body-battery — anchor precedence (S2)', () => {
  let pool: import('pg').Pool
  let today: string
  let mid: Date

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz, todayMidnightUtc } = await import('@/lib/date-utils')
    pool = getPool()
    today = todayInTz(TZ)
    mid = todayMidnightUtc(TZ)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `bb-anchor-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('defaults to 50 with no data at all', async () => {
    const { GET } = await import('../route')
    const body = await (await GET()).json()
    expect(body.anchor).toBe(50)
    expect(body.anchorSource).toBe('default')
  })

  it('anchors on our own computed sleep score when only a sleep session exists', async () => {
    // 22:00 → 06:00 local, efficiency 92, ~12 min latency → computeSleepScore lands well above 60.
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, onset_latency_sec)
       VALUES ($1, $2, $3, $4, 8, 92, 720)
       ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, today, new Date(mid.getTime() - 2 * 3_600_000), new Date(mid.getTime() + 6 * 3_600_000)],
    )
    const { GET } = await import('../route')
    const body = await (await GET()).json()
    expect(body.anchorSource).toBe('sleep')
    expect(body.anchor).toBeGreaterThan(60)
    expect(body.anchor).toBeLessThanOrEqual(100)
  })

  it('prefers today’s persisted derived readiness over the sleep-score fallback', async () => {
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()
    await repo.upsertOuraDailyDerived(TEST_USER_ID, today, { readinessScore: 77, readinessSource: 'ble-derived' })
    const { GET } = await import('../route')
    const body = await (await GET()).json()
    expect(body.anchor).toBe(77)
    expect(body.anchorSource).toBe('readiness')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/body-battery/__tests__/anchor-source.test.ts`
Expected: test 1 passes (default already 50); tests 2 and 3 FAIL — current code returns `anchorSource: 'default'`/`anchor: 50` because it only reads the frozen Cloud columns.

- [ ] **Step 3: Implement in `app/api/body-battery/route.ts`**

3a. Add the import (next to the other `lib/health` imports at lines 6–7):

```typescript
import { computeSleepScore } from '@/lib/health/sleep-score'
```

3b. Add the derived fetch to the parallel read (lines 79–86):

```typescript
  const [ouraRows, derivedRows, bodyMetrics, sleepSessions, hrRows, user, daytimeSignals] = await Promise.all([
    repo.getOuraDaily(userId, todayIso, todayIso),
    repo.getOuraDailyDerived(userId, todayIso, todayIso),
    repo.listBodyMetrics(userId, from28dIso, todayIso),
    repo.listSleepSessions(userId, yesterdayIso, todayIso),
    repo.getHrForWindow(userId, todayMid, now),
    repo.getUserById(userId),
    repo.getOuraDaytimeSignals(userId, todayMid, now),
  ])

  const ouraToday = ouraRows[0] ?? null
  const derivedToday = derivedRows[0] ?? null
```

3c. Replace the anchor block (lines 107–119) with:

```typescript
  // Anchor precedence (S2 — data-efficiency review §3.2): our own persisted composite
  // readiness for today, then our own sleep score computed from last night's session,
  // then the frozen Cloud columns (null for every post-re-key day — legacy arms only),
  // then 50. The derived readiness row only exists once /api/readiness-score has run
  // today, which is exactly why the sleep-score fallback matters in the early morning.
  const ownSleepScore = todaySleep ? computeSleepScore(todaySleep, tz)?.score ?? null : null
  let anchor: number
  let anchorSource: BodyBatteryResponse['anchorSource']
  if (derivedToday?.readinessScore != null) {
    anchor = derivedToday.readinessScore
    anchorSource = 'readiness'
  } else if (ownSleepScore != null) {
    anchor = ownSleepScore
    anchorSource = 'sleep'
  } else if (ouraToday?.readinessScore != null) {
    anchor = ouraToday.readinessScore
    anchorSource = 'readiness'
  } else if (ouraToday?.sleepScore != null) {
    anchor = ouraToday.sleepScore
    anchorSource = 'sleep'
  } else {
    anchor = 50
    anchorSource = 'default'
  }
  anchor = clamp(anchor, 0, 100)
```

(`todaySleep` is already computed just above the anchor block, at lines 100–101 — no reordering needed.)

3d. Bump the model version (line 50) — anchor provenance changed, so tuning snapshots must not mix eras:

```typescript
const MODEL_VERSION = `v4:rest${REST_THRESHOLD}:chg${CHARGE_RATE}:drn${DRAIN_RATE}:str${STRESS_DRAIN_RATE}:oura-rule`
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/api/body-battery/__tests__/anchor-source.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "body-battery" || echo clean`
Expected: `clean`

```bash
git add app/api/body-battery/route.ts app/api/body-battery/__tests__/anchor-source.test.ts
git commit -m "Anchor Body Battery on own derived readiness / sleep score before frozen Cloud"
```

---

### Task Final: Full gate, dev-server smoke, version + docs

- [ ] **Step 1: Full gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: all green. The three new integration tests run against the local port-5433 Postgres (the session-start hook writes `DATABASE_URL` into `.env.local`; export it into the test shell if `pnpm test` reports them skipped: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/trainingai_dev pnpm test`). In CI they run against the workflow's Postgres service.

- [ ] **Step 2: Dev-server smoke (`pnpm dev` against the local DB on port 5433)**

Log in as `test@local.dev` / `testpass123`, capture the session cookie, then:

1. `GET /api/readiness-score` — expect 200; `sleepContributors` **non-null** with snake_case keys (`total_sleep`, `efficiency`, …; the seed has sleep sessions but the seeded `oura_daily` rows may carry Cloud contributors — if `sleepContributors` shows Cloud data, null the seed row's `sleep_contributors` via psql and re-hit to see the fallback). Then on the local DB: `psql -p 5433 -U postgres trainingai_dev -c "SELECT day, sleep_score, sleep_contributors FROM oura_daily_derived ORDER BY day DESC LIMIT 3"` — today's wake-day row must show a non-null `sleep_score` and the same JSONB the response served. Hit the route twice — second read must not error (COALESCE upsert idempotent).
2. `GET /api/health/trends` — expect 200 with the SWR `Cache-Control` header still present (`curl -sI`). Insert a synthetic derived row for a recent day (`INSERT INTO oura_daily_derived (user_id, day, readiness_score) VALUES ('<seed-user-id>', '<3 days ago>', 71) ON CONFLICT (user_id, day) DO UPDATE SET readiness_score = 71`), re-hit past the 60s max-age (or restart dev), and confirm that day's `readinessScore` flips from its Cloud value/null to 71.
3. `GET /api/body-battery` — expect 200; with the seeded sleep data and no derived readiness row for today, `anchorSource` should be `'sleep'` with a plausible `anchor` (not flat 50); after step 1 has persisted... note: step 1 persists *sleep* fields only, so to see `'readiness'` insert today's derived readiness via psql (or hit `/api/readiness-score` on a DB state where the A4 composite computes) and re-hit — `anchor` must equal that readiness value.
4. UI pass at the S25 viewport (≤640px): `/health/sleep` — contributor bars render with the same labels as before ("Total Sleep", "Efficiency", …); `/health/readiness` and `/overview` — no regression in the readiness card's sleep bars; Home → Body Battery card — the "from last night's sleep"/"from this morning's readiness" caption reflects the new source.

- [ ] **Step 3: Version + changelog + docs (before merge, same PR)**

- `package.json`: **patch** bump (bug-fix class) on the fresh rebase — re-bump if a parallel PR lands first.
- `lib/changelog.ts` entry (top of `CHANGELOG`), e.g.: "The 14-day Readiness and Sleep sparklines, the Body Battery morning anchor, and the Sleep contributor bars now run on the app's own daily scores computed from your ring — instead of the pre-July Oura Cloud data that stopped updating when the ring moved to direct Bluetooth. Sparklines fill in from today forward; the battery no longer starts every day at a flat 50."
- `docs/planned_upgrades.md`: tick/remove the Batch S entries for review findings 3.1, 3.2 and 1.3.
- `docs/implementation-backlog.md`: remove this plan's queue entry.
- `projectOverview.md`: current status line; add a Known-Issues/notes row: "Derived-score sparklines have no backfill — days before 2026-07-16 stay on Cloud data or null; derived activity_score pending P-D."
- Append the session journal entry to the newest `docs/overview/history-*.md`.

- [ ] **Step 4: Commit + push, open PR, watch CI, merge when green**

```bash
git add package.json lib/changelog.ts projectOverview.md docs/overview/ docs/planned_upgrades.md docs/implementation-backlog.md
git commit -m "Bump version, changelog and docs for derived-score read paths"
git push -u origin fix/derived-scores-read-paths
```

Standard change (no destructive migration, no auth/security/secrets) → merge or auto-merge without asking once CI is green and the smoke pass above is done; update the branch to latest `main` and re-confirm green before merging.

---

## Verification summary

- **Automated:** 3 unit tests (key mapping) + 3 DB integration tests (persist+fallback, trends coalesce, anchor precedence — all route-level with mocked auth against real Postgres, CI-executed) + the full existing suite.
- **Dev-server smoke:** the three routes exercised against the local seed as in Task Final Step 2, plus the S25-viewport UI pass.
- **NOT exercised in the sandbox:** real BLE-derived production data (the local seed is Cloud-shaped and always fresh — prod's frozen/drifted `oura_daily` vs live `oura_daily_derived` split is exactly what this fixes, so verify on prod after deploy: open Health → Sleep/Readiness and confirm sparkline points appear for today forward and the contributor bars render on a BLE night); Samsung WebView rendering. No native plugin, safe-area, gesture, offline-write or notification surface is touched (server-side reads + one server persist), so the on-device smoke checklist is not triggered — but state the prod-data caveat in the PR.

## Notes for the implementer

- **Do not** add a read-first path to the readiness route itself (serving the persisted composite instead of computing live) — that is deliberately perf-gated and out of scope (review §1.1 note; P-E §2.3).
- **Do not** write `oura_daily_derived.activity_score` here — P-D owns activity; the trends coalesce is already future-proofed for it.
- **Do not** touch `source`/`model_versions` in the new sleep persist — the readiness persist's in-code comment explains the clobber hazard for body-comp/illness provenance on the same row.
- The `anchorSource` union and `body-battery-card.tsx` stay untouched by design; if you find yourself editing the card, re-read the Task 4 preamble.
- Backfill of historical derived sleep scores from `sleep_sessions` is possible (the data exists) but is **not** in this plan — if the owner wants sparkline history pre-filled, that's a follow-up backlog entry, not scope creep here.
