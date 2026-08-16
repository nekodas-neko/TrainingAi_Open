# Frozen-Cloud Display Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop every remaining surface (UI and AI-fed) from presenting frozen pre-re-key Oura Cloud data as current. Where a BLE-derived replacement exists (temperature deviation), switch to it; where the value is worth keeping (VO₂ max / vascular age), date-stamp it honestly; where it's dead weight (resilience, sleep-time status), remove it from the response; where a fallback can silently surface a weeks-old reading (SpO₂/HRV/RHR card, AI health-insight), show the reading's date. Also fix the admin BLE tester's permanently-stale battery readout (S10).

**Architecture:** One shared re-key constant + `isPreRekey(dateStr)` in a new `lib/oura/cloud-freshness.ts` (One Formula, One Place — today the 2026-07-07 date exists only in comments). The readiness route (`/api/readiness-score`) is the single chokepoint for most of these fields, so almost all sourcing changes happen there: coalesce the already-persisted BLE `oura_daily_summary.temp_dev_c` over the frozen Cloud `temperature_deviation` (with a source tag), add a latest-Cloud-vitals lookup (new repo function) so VO₂/vascular age come back date-stamped, gate the Cloud-only daily fields (`daySummary`, `stressHigh`/`recoveryHigh`, bedtime) behind `isPreRekey`, and drop `resilienceLevel`/`sleepTimeStatus` from the response entirely. AI surfaces (chat context, chat tools, health-insight) get the same BLE-first temp value and lose the frozen resilience field. No migrations, no new endpoints (fields ride the existing `readiness-score` response, which every affected screen already fetches via `cachedFetchToday`), no native/Kotlin changes.

**Tech Stack:** TypeScript, Next.js 15 API routes, Drizzle/Postgres (read-only slice addition), React 19, vitest.

---

## Why now

The 2026-07-16 data-efficiency review (`docs/reviews/2026-07-16-data-efficiency-review.md`) findings **S8 (§3.3)** and **S10 (§3.4)**: displays still fed by frozen `oura_daily` Cloud columns with no staleness marker, and the admin tester's battery reading a tag (`0x61`) that ingest now drops. The ring-battery treatment (`isBatteryStale` in `lib/oura/client.ts:264-274` + the "Not live" state in `components/more/oura-section.tsx:217-222`) is the reference pattern — icon + text, never colour alone.

**Branch:** `fix/frozen-cloud-display-honesty`

## Verification findings vs the review (read before implementing)

Re-verified against `main` on 2026-07-16 — three findings shape the tasks:

1. **The BLE temperature-deviation replacement already exists in the DB.** The review's §1.5 claims `oura_daily_summary.tempDevC` is "never written — always null", but `replaceOuraDailySummary` **does** write it (`lib/data/postgres/slices/oura.ts:580`) from `computeDailySummaries` (`lib/health/daily-summary.ts:59-61`, prior-night baseline via `temperatureDeviationCentiC`). So the temp task is pure surfacing: `latestSummary.tempDevC` is already fetched by the readiness route (`repo.getOuraDailySummary`, route line 128/250). No new computation.
2. **Most of the "presented as current" surfaces have actually been silently *hidden* since the re-key.** The route sources `daySummary`/`stressHigh`/`recoveryHigh`/`recommendedBedtime*`/`vo2Max`/`vascularAge`/`temperatureDeviation` from `ouraToday` — **today's** `oura_daily` row — and post-re-key the only live writer of that row is wear-time, so these are all `null` and their UI (activity tiles, readiness day-summary card, rest-day bedtime, VO₂/vascular tiles, ReadinessCard temp row) hasn't rendered since 2026-07-07. The route-side `isPreRekey` gates below are therefore *defensive* (they make the invariant explicit and survive any future Cloud re-sync); the genuinely user-visible changes are: BLE temp deviation returning, VO₂/vascular returning **with a date stamp**, the AI text fixes, the SpO₂-card dates, and the tester battery.
3. **Two extra stale-as-current paths found during verification** (S8-adjacent, fixed here under the sibling-surface sweep): `app/api/ai/health-insight/route.ts:67` falls back to `ouraRows[ouraRows.length - 1]` and can feed the model a stale row's scores as "today" with no annotation; and `lib/ai-chat/tools.ts:62` exposes the frozen `resilience` (the prompt's item 6 covers the route + context — the tool is the third reader).

Other scoping notes:

- **No badge primitive exists in `components/ui/`** (checked) and only one surface needs an inline chip — so no new shared chip component; copy the `oura-section.tsx` "Not live" inline pattern (icon + text) directly.
- **The daytime-stress-wiring plan (`2026-07-16-daytime-stress-wiring.md`) is being written in parallel and is not on disk yet.** The stress/recovery-tile task therefore only gates the frozen Cloud values and leaves a clearly-marked coalesce point (derived-over-Cloud) for that plan; do not build the derived read here (its writer doesn't exist yet, and its columns are *minutes* where Cloud's are *seconds* — the unit decision belongs to that plan). If it has already landed when you implement, coalesce its derived fields at the marked point and keep the hide-when-neither-exists behaviour.
- **`sleepTimeStatus` is removed alongside `resilienceLevel`**: grep confirms it has zero UI readers (only the route, repo types, and the `health-score-detail.tsx` fallback literal) — same frozen-Cloud-passthrough class.
- **The tester already renders the live plugin battery** (`components/oura-ble/oura-ble-debug.tsx:433`, `status?.battery` — `OuraBleStatus.battery` in `lib/oura-ble/plugin.ts:5`, refreshed by `readBattery()`), so S10's fix is *removing* the dead `latestBatteryPct` stat + its `0x61` query, not adding a readout. `0x61` stays in `RAW_STORAGE_DROP_TAGS` — do NOT re-store it.
- `ai-dynamic.ts`'s `daySummary === 'very_stressful'` consumer (via `adapter.ts:1570`) is **out of scope** — review §2.2, owned by the daytime-stress-wiring plan.
- `computeBlendedScore`'s Cloud `tempDev` argument is deliberately left on the Cloud value: it only runs on the Cloud-readiness path (dead post-re-key), and the own-composite path already carries temperature via its `tempZ` contributor — feeding BLE temp into the blend would double-count.

## File structure

**Create:**
- `lib/oura/cloud-freshness.ts` — `OURA_CLOUD_REKEY_DATE` + `isPreRekey()` (the single re-key constant).
- `lib/oura/__tests__/cloud-freshness.test.ts`

**Modify:**
- `lib/data/postgres/slices/oura.ts` — `getLatestOuraCloudVitals` (read-only).
- `lib/data/repository.ts` — add `getLatestOuraCloudVitals`; remove `latestBatteryPct` from `OuraRawSampleSummary`.
- `lib/data/postgres/adapter.ts` — delegation; drop the `0x61` query + battery loop in `getOuraRawSampleSummary`.
- `app/api/readiness-score/route.ts` — temp coalesce + source tag, dated vitals, `isPreRekey` gates, field removals.
- `components/health/health-score-detail.tsx` — fallback literal updated to the new response shape.
- `components/readiness-card.tsx` — temp row renders the BLE-first value + "Pre-re-key" marker on the Cloud fallback.
- `app/health/heart-rate/page.tsx` — VO₂/vascular "as of \<date\>" stamps.
- `lib/date-utils.ts` — `formatDayShort` (shared by two components; grep found no existing short-date formatter).
- `lib/ai-chat/context.ts` + `app/api/ai-chat/route.ts` + `lib/__tests__/ai-chat-context.test.ts` — BLE temp into the recovery summary; resilience line removed.
- `lib/ai-chat/tools.ts` — `resilience` removed from `getRecoveryData`.
- `app/api/ai/health-insight/route.ts` — BLE temp + stale-row annotation.
- `app/health/activity/activity-content.tsx` — coalesce-point comment only (tiles already hide on null).
- `components/health/body-cards/rhr-hrv-spo2-card.tsx` — date-stamp non-today fallbacks (all three tiles).
- `components/oura-ble/oura-ble-debug.tsx` — remove the dead battery stat.
- `package.json` version (patch) + `lib/changelog.ts` + journal/`projectOverview.md` (final task).

---

# Chunk A — shared freshness helper

### Task A1: `lib/oura/cloud-freshness.ts` (One Formula, One Place)

**Files:**
- Create: `lib/oura/cloud-freshness.ts`
- Test: `lib/oura/__tests__/cloud-freshness.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/oura/__tests__/cloud-freshness.test.ts
import { describe, it, expect } from 'vitest'
import { isPreRekey, OURA_CLOUD_REKEY_DATE } from '@/lib/oura/cloud-freshness'

describe('isPreRekey', () => {
  it('exports the re-key date', () => {
    expect(OURA_CLOUD_REKEY_DATE).toBe('2026-07-07')
  })
  it('treats days before the re-key as pre-re-key', () => {
    expect(isPreRekey('2026-07-06')).toBe(true)
    expect(isPreRekey('2026-01-01')).toBe(true)
  })
  it('treats the re-key day itself as pre-re-key (partial day, last Cloud data)', () => {
    expect(isPreRekey('2026-07-07')).toBe(true)
  })
  it('treats days after the re-key as live', () => {
    expect(isPreRekey('2026-07-08')).toBe(false)
    expect(isPreRekey('2027-01-01')).toBe(false)
  })
  it('fails closed on missing dates', () => {
    expect(isPreRekey(null)).toBe(true)
    expect(isPreRekey(undefined)).toBe(true)
    expect(isPreRekey('')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/oura/__tests__/cloud-freshness.test.ts`
Expected: FAIL — `Cannot find module '@/lib/oura/cloud-freshness'`

- [ ] **Step 3: Implement**

```typescript
// lib/oura/cloud-freshness.ts
// The Oura Ring 5 was re-keyed onto our own BLE auth key on 2026-07-07 — since then
// the Oura Cloud gets no new data from this ring, EVER (CLAUDE.md, Oura Direct-BLE).
// Any oura_daily Cloud-sourced value dated on/before this day is a frozen snapshot,
// not a current reading. This is the single re-key constant in the codebase — every
// staleness gate imports it from here (One Formula, One Place).
export const OURA_CLOUD_REKEY_DATE = '2026-07-07'

/** True when a YYYY-MM-DD day is on/before the re-key (frozen Cloud era).
 *  No date → cannot prove freshness → treat as stale (fail closed). */
export function isPreRekey(dateStr: string | null | undefined): boolean {
  if (!dateStr) return true
  return dateStr <= OURA_CLOUD_REKEY_DATE
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/oura/__tests__/cloud-freshness.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/oura/cloud-freshness.ts lib/oura/__tests__/cloud-freshness.test.ts
git commit -m "Add shared Oura Cloud re-key freshness helper"
```

---

# Chunk B — readiness route: honest sourcing for every frozen field

### Task B1: latest-Cloud-vitals repo function

**Files:**
- Modify: `lib/data/postgres/slices/oura.ts`, `lib/data/repository.ts`, `lib/data/postgres/adapter.ts`

- [ ] **Step 1: Slice function (in `lib/data/postgres/slices/oura.ts`, below `getOuraDaily`)**

Add `or`, `isNotNull`, `desc` to the existing `drizzle-orm` import if not already there, then:

```typescript
/** The most recent oura_daily row carrying VO₂ max / vascular age — necessarily
 *  pre-re-key (Cloud-only fields, frozen since 2026-07-07). Returned WITH its date
 *  so the UI can stamp "as of <day>" instead of presenting it as current. */
export async function getLatestOuraCloudVitals(
  db: Db, userId: string,
): Promise<{ date: string; vo2Max: number | null; vascularAge: number | null } | null> {
  const rows = await db
    .select({ date: s.ouraDaily.date, vo2Max: s.ouraDaily.vo2Max, vascularAge: s.ouraDaily.vascularAge })
    .from(s.ouraDaily)
    .where(and(
      eq(s.ouraDaily.userId, userId),
      or(isNotNull(s.ouraDaily.vo2Max), isNotNull(s.ouraDaily.vascularAge)),
    ))
    .orderBy(desc(s.ouraDaily.date))
    .limit(1)
  return rows[0] ?? null
}
```

- [ ] **Step 2: Repository interface + adapter delegation**

In `lib/data/repository.ts` (next to `getOuraDaily`):

```typescript
getLatestOuraCloudVitals(userId: string): Promise<{ date: string; vo2Max: number | null; vascularAge: number | null } | null>
```

In `lib/data/postgres/adapter.ts` (next to the `getOuraDaily` delegation, ~line 4785):

```typescript
  async getLatestOuraCloudVitals(userId: string) { return oura.getLatestOuraCloudVitals(this.db, userId) }
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: clean

```bash
git add lib/data/postgres/slices/oura.ts lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add latest-Cloud-vitals lookup (date-stamped VO2/vascular age)"
```

---

### Task B2: readiness route — coalesce, gate, date-stamp, remove

**Files:**
- Modify: `app/api/readiness-score/route.ts`
- Modify: `components/health/health-score-detail.tsx` (the `satisfies ReadinessScoreResponse` fallback literal — must move in the same commit or typecheck breaks)

- [ ] **Step 1: Interface changes (`ReadinessScoreResponse`)**

```typescript
  // Temperature deviation vs personal baseline (°C). BLE-derived (oura_daily_summary.temp_dev_c,
  // last rolled-up night) when available; frozen Cloud value only as an annotated fallback.
  temperatureDeviation: number | null
  temperatureDeviationSource: 'ble' | 'cloud' | null
```

Remove these two lines from the interface (frozen Cloud passthroughs with no live source and — post-removal — no reader):

```typescript
  resilienceLevel: string | null
  sleepTimeStatus: string | null
```

Add below `vascularAge`:

```typescript
  // Day of the last Cloud row carrying vo2Max/vascularAge — always pre-re-key.
  // UI must render these "as of <cloudVitalsDate>", never as today's reading.
  cloudVitalsDate: string | null
```

- [ ] **Step 2: Imports + fetch**

```typescript
import { isPreRekey } from '@/lib/oura/cloud-freshness'
```

Extend the `Promise.all` (line ~121) with the vitals lookup:

```typescript
  const [bodyMetrics, sleepSessions, recentSessions, ouraRows, program, todayHrRows, dailySummaries, cloudVitals] = await Promise.all([
    repo.listBodyMetrics(userId, from28dIso, todayIso),
    repo.listSleepSessions(userId, from28dIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, from28dDate),
    repo.getOuraDaily(userId, from28dIso, todayIso),
    repo.getActiveProgram(userId),
    repo.getHrForWindow(userId, todayMid, new Date(todayMid.getTime() + 86_400_000)),
    repo.getOuraDailySummary(userId, from28dIso, todayIso),
    repo.getLatestOuraCloudVitals(userId),
  ])
```

- [ ] **Step 3: Source values (after `latestSummary`/`priorSummary` are computed, ~line 251)**

```typescript
  // Temp deviation, BLE-first: the rollup already persists last night's deviation vs the
  // prior night's baseline (daily-summary.ts → oura_daily_summary.temp_dev_c). The Cloud
  // field froze at the re-key — it survives only as an explicitly-tagged fallback.
  const bleTempDevC = latestSummary?.tempDevC ?? null
  const cloudTempDevC = ouraToday?.temperatureDeviation ?? null
  const temperatureDeviation = bleTempDevC ?? cloudTempDevC
  const temperatureDeviationSource: 'ble' | 'cloud' | null =
    bleTempDevC != null ? 'ble' : cloudTempDevC != null ? 'cloud' : null

  // Cloud-only daily products (stress summary, bedtime window) are only emitted when the
  // backing row post-dates the re-key. Structurally always-null today (the wear-time writer
  // is the only live oura_daily writer) — this makes the invariant explicit and survives
  // any future manual Cloud re-sync.
  const cloudDailyLive = ouraToday != null && !isPreRekey(ouraToday.date)
```

- [ ] **Step 4: Response changes (the JSON at ~line 354)**

Replace the affected lines:

```typescript
    temperatureDeviation,
    temperatureDeviationSource,
    daySummary:              cloudDailyLive ? ouraToday.daySummary ?? null : null,
    // seconds-in-state, frozen Cloud. COALESCE POINT for the daytime-stress-wiring plan
    // (2026-07-16): once derived daytime stress persists, prefer it here (mind its
    // minutes-vs-seconds unit) and keep the null-hides-tiles behaviour.
    stressHigh:              cloudDailyLive ? ouraToday.stressHigh ?? null : null,
    recoveryHigh:            cloudDailyLive ? ouraToday.recoveryHigh ?? null : null,
    vo2Max:                  cloudVitals?.vo2Max                    ?? null,
    vascularAge:             cloudVitals?.vascularAge               ?? null,
    cloudVitalsDate:         cloudVitals?.date                      ?? null,
    recommendedBedtimeStart: cloudDailyLive ? ouraToday.recommendedBedtimeStart ?? null : null,
    recommendedBedtimeEnd:   cloudDailyLive ? ouraToday.recommendedBedtimeEnd ?? null : null,
```

Delete the `resilienceLevel:` and `sleepTimeStatus:` lines. Keep `daySummary` in the interface (the readiness page still renders it when live).

- [ ] **Step 5: Update the `health-score-detail.tsx` fallback literal (~line 133)**

In the local-store fallback object: delete `resilienceLevel: null` and `sleepTimeStatus: null`, add `temperatureDeviationSource` and `cloudVitalsDate`, and stop surfacing a *stale* row's temp deviation as today's (the `rows[rows.length - 1]` fallback can be an old row):

```typescript
          daySummary: null,
          temperatureDeviation: row.day === today ? row.temperatureDeviation : null,
          temperatureDeviationSource: row.day === today && row.temperatureDeviation != null ? 'cloud' : null,
          vo2Max: null, vascularAge: null, cloudVitalsDate: null,
```

(Keep the rest of the literal as-is; `recommendedBedtimeStart/End` stay null there.)

- [ ] **Step 6: Typecheck — expect it to enumerate every remaining reader**

Run: `npx tsc --noEmit`
Expected errors in: `components/readiness-card.tsx` (none — `temperatureDeviation` kept its name; verify), `lib/ai-chat/*` (none — context/tools read `OuraDailyRow`, not the response). If anything else reads `resilienceLevel`/`sleepTimeStatus` off the response, this step finds it — fix in this commit (sibling-surface sweep).

- [ ] **Step 7: Dev-server smoke against the local DB**

`pnpm dev`, log in as `test@local.dev` / `testpass123`, then:

```bash
curl -s http://localhost:3000/api/readiness-score -H "Cookie: $SESSION_COOKIE" | python3 -m json.tool | grep -E 'temperatureDeviation|cloudVitals|resilience|sleepTimeStatus|daySummary|stressHigh'
```

Expected: `temperatureDeviation` + `temperatureDeviationSource` present (likely null/null on seed data), `cloudVitalsDate` present, **no** `resilienceLevel`/`sleepTimeStatus` keys. Then seed a Cloud vitals row and re-check the date-stamp path:

```bash
psql -p 5433 -U postgres trainingai_dev -c \
  "UPDATE oura_daily SET vo2_max = 44.5, vascular_age = 27 WHERE date = (SELECT max(date) FROM oura_daily) "
```

(If the seed has no `oura_daily` rows, INSERT one dated pre-re-key for the test user instead.) Re-curl: `vo2Max`/`vascularAge` populated with `cloudVitalsDate` = that row's date.

- [ ] **Step 8: Commit**

```bash
git add app/api/readiness-score/route.ts components/health/health-score-detail.tsx
git commit -m "Source readiness-route Cloud fields honestly (BLE temp, dated vitals, re-key gates)"
```

---

### Task B3: ReadinessCard — temp row gets a source marker (/overview)

**Files:**
- Modify: `components/readiness-card.tsx`

- [ ] **Step 1: Mark the Cloud fallback**

The row at ~line 195 already renders only when `temperatureDeviation != null && |v| > 0.3` — it now shows the BLE value by default. Add the frozen-Cloud marker (icon + text, copying the oura-section "Not live" pattern — never colour alone). Import `HistoryIcon` from `lucide-react`, then inside the row's label cluster:

```tsx
                    {readiness.temperatureDeviation != null && Math.abs(readiness.temperatureDeviation) > 0.3 && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <ThermometerIcon className="h-3 w-3" />
                          <span>Temp deviation</span>
                          {readiness.temperatureDeviationSource === 'cloud' && (
                            <span
                              className="flex items-center gap-0.5 text-[9px] text-muted-foreground/70"
                              title="Frozen Cloud value from before the direct-BLE re-key — not last night's reading"
                            >
                              <HistoryIcon className="h-2.5 w-2.5" />
                              Pre-re-key
                            </span>
                          )}
                        </div>
                        <span className="font-semibold tabular-nums text-amber-400">
                          {readiness.temperatureDeviation > 0 ? '+' : ''}
                          {readiness.temperatureDeviation.toFixed(1)}°C
                        </span>
                      </div>
                    )}
```

(The `text-amber-400` value colour is pre-existing on this row — leave it; retheming the card is out of scope.)

- [ ] **Step 2: Lint + commit**

Run: `npx eslint components/readiness-card.tsx`

```bash
git add components/readiness-card.tsx
git commit -m "Mark Cloud-fallback temp deviation as pre-re-key on the readiness card"
```

---

### Task B4: heart-rate page — date-stamped VO₂ max / vascular age

**Files:**
- Modify: `lib/date-utils.ts`, `app/health/heart-rate/page.tsx`

- [ ] **Step 1: Add `formatDayShort` to `lib/date-utils.ts`**

Grep first (`grep -n "MMM d\|formatDayShort" lib/date-utils.ts components -r`) — if an equivalent exists, use it. Otherwise add (shared by this task and Task D1):

```typescript
/** 'YYYY-MM-DD' → 'Jul 6'. Component-wise construction — never `new Date(isoDay)`,
 *  which parses as UTC midnight and shifts the day in AEST. */
export function formatDayShort(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })
}
```

- [ ] **Step 2: Stamp the tiles (`app/health/heart-rate/page.tsx` ~112-127)**

Import `HistoryIcon` from `lucide-react` and `formatDayShort` from `@/lib/date-utils`, then:

```tsx
        {(data?.vo2Max != null || data?.vascularAge != null) && (
          <div className="grid grid-cols-2 gap-3">
            {data.vo2Max != null && (
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">VO₂ Max</p>
                <p className="text-xl font-bold tabular-nums mt-1">{data.vo2Max}</p>
                {data.cloudVitalsDate && (
                  <p className="mt-1 flex items-center justify-center gap-1 text-[9px] text-muted-foreground">
                    <HistoryIcon className="h-2.5 w-2.5" /> as of {formatDayShort(data.cloudVitalsDate)}
                  </p>
                )}
              </div>
            )}
            {data.vascularAge != null && (
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Vascular Age</p>
                <p className="text-xl font-bold tabular-nums mt-1">{data.vascularAge} <span className="text-xs font-normal text-muted-foreground">yrs</span></p>
                {data.cloudVitalsDate && (
                  <p className="mt-1 flex items-center justify-center gap-1 text-[9px] text-muted-foreground">
                    <HistoryIcon className="h-2.5 w-2.5" /> as of {formatDayShort(data.cloudVitalsDate)}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 3: Dev-server check + commit**

With the Step B2.7 seeded vitals row: open `http://localhost:3000/health/heart-rate` at a ≤640px viewport — tiles render with "as of \<pre-re-key date\>".

```bash
git add lib/date-utils.ts app/health/heart-rate/page.tsx
git commit -m "Date-stamp frozen VO2 max / vascular age tiles"
```

---

# Chunk C — AI-fed surfaces (chat context, chat tool, health-insight)

### Task C1: chat recovery summary — BLE temp in, frozen resilience out

**Files:**
- Modify: `lib/ai-chat/context.ts`, `app/api/ai-chat/route.ts`
- Test: `lib/__tests__/ai-chat-context.test.ts`

- [ ] **Step 1: Update the test first**

In `lib/__tests__/ai-chat-context.test.ts`, the `buildRecoverySummary` fixture (~line 61) passes an oura row with `temperatureDeviation: 0.5, resilienceLevel: 'solid'`. Update the tests to the new contract:

```typescript
  it('prefers the BLE temp deviation and omits resilience', () => {
    const out = buildRecoverySummary(
      [{ date: '2026-07-01', readinessScore: 78, sleepScore: 82, activityScore: null, temperatureDeviation: 0.5, resilienceLevel: 'solid' }],
      [], null, null, '2026-07-01',
      0.7, // BLE tempDevC
    )
    expect(out).toContain('+0.7°C')
    expect(out).toContain('ring baseline')
    expect(out).not.toContain('resilience')
    expect(out).not.toContain('pre-re-key')
  })

  it('falls back to the Cloud temp deviation with a pre-re-key annotation', () => {
    const out = buildRecoverySummary(
      [{ date: '2026-07-01', readinessScore: 78, sleepScore: 82, activityScore: null, temperatureDeviation: 0.5, resilienceLevel: 'solid' }],
      [], null, null, '2026-07-01',
      null,
    )
    expect(out).toContain('+0.5°C')
    expect(out).toContain('pre-re-key')
  })
```

(Adapt the existing assertions in the same describe block — anything asserting a `resilience:` line now asserts its absence. The fixture rows keep `resilienceLevel` since `OuraDailyRow` still carries the column.)

Run: `npx vitest run lib/__tests__/ai-chat-context.test.ts` — expected FAIL.

- [ ] **Step 2: Implement in `lib/ai-chat/context.ts`**

New trailing parameter (defaulted, so any untouched caller still compiles):

```typescript
export function buildRecoverySummary(
  ouraRows: OuraDailyRow[],
  sleepSessions: SleepSession[],
  morningCheckin: DayCheckin | null,
  eveningCheckin: DayCheckin | null,
  todayIso: string,
  /** Last rolled-up night's BLE temperature deviation (°C, oura_daily_summary.temp_dev_c). */
  bleTempDevC: number | null = null,
): string {
```

Replace the `ouraParts` temp/resilience entries (lines ~89-92):

```typescript
  const tempLine = bleTempDevC != null && Math.abs(bleTempDevC) > 0.3
    ? `body temp deviation ${bleTempDevC > 0 ? '+' : ''}${bleTempDevC.toFixed(1)}°C (vs ring baseline)`
    : ouraToday?.temperatureDeviation != null && Math.abs(ouraToday.temperatureDeviation) > 0.3
      ? `body temp deviation ${ouraToday.temperatureDeviation > 0 ? '+' : ''}${ouraToday.temperatureDeviation.toFixed(1)}°C (pre-re-key Cloud value — not current)`
      : null
  const ouraParts = ouraToday ? [
    ouraToday.readinessScore != null ? `Oura readiness ${ouraToday.readinessScore}/100` : null,
    ouraToday.sleepScore != null ? `sleep score ${ouraToday.sleepScore}/100` : null,
    ouraToday.activityScore != null ? `activity score ${ouraToday.activityScore}/100` : null,
    tempLine,
  ].filter(Boolean) : []
```

(The `resilienceLevel` line is gone. `tempLine` must sit outside the `ouraToday ?` ternary or BLE temp vanishes on days without an oura row — restructure so `tempLine` is appended even when `ouraToday` is null: `const parts = [...ouraParts]; if (!ouraToday && tempLine) parts.push(tempLine)` or equivalent.)

- [ ] **Step 3: Feed it from `app/api/ai-chat/route.ts`**

Extend the `Promise.all` (line ~67) with `repo.getOuraDailySummary(userId, from7dIsoStr, todayIso)`, then:

```typescript
    const latestSummary = dailySummaries[dailySummaries.length - 1] ?? null;
    const recoverySummary = buildRecoverySummary(
      ouraRows, sleepSessions, morningCheckin, eveningCheckin, todayIso,
      latestSummary?.tempDevC ?? null,
    );
```

- [ ] **Step 4: Run tests + typecheck + commit**

Run: `npx vitest run lib/__tests__/ai-chat-context.test.ts && npx tsc --noEmit 2>&1 | head -5`

```bash
git add lib/ai-chat/context.ts app/api/ai-chat/route.ts lib/__tests__/ai-chat-context.test.ts
git commit -m "Feed chat context BLE temp deviation; drop frozen resilience"
```

---

### Task C2: chat tool — remove frozen resilience from `getRecoveryData`

**Files:**
- Modify: `lib/ai-chat/tools.ts`

- [ ] **Step 1: Edit the tool (line ~46-63)**

Description: change `'Oura daily scores (readiness/sleep/activity, temp deviation, resilience), …'` to:

```
'Oura daily scores (readiness/sleep/activity, temp deviation — Cloud-era fields end 2026-07-07, the ring re-key), sleep sessions (duration, efficiency, overnight HRV, lowest HR) and body metrics (HRV, resting HR, steps, weight) for a date range. Use for recovery, sleep, HRV and readiness questions.'
```

Map: delete the `resilience: r.resilienceLevel ?? null,` line. Per-row `tempDeviationC` **stays** — the tool returns dated historical rows, which is honest by construction; the description now names the Cloud cutoff so the model doesn't treat post-re-key nulls as missing data.

- [ ] **Step 2: Verify no other resilience reader remains**

Run: `grep -rn "resilienceLevel" app components lib --include='*.ts' --include='*.tsx' | grep -v -E 'repository|schema|slices|sync/route|webhook/route|__tests__'`
Expected: no hits (the DB column, its Cloud writers, and the derived-table plumbing legitimately keep the name; the 2026-07-15 oura-models plan re-introduces a *derived* resilience later — removal now is forward-compatible).

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | head -5
git add lib/ai-chat/tools.ts
git commit -m "Stop exposing frozen Cloud resilience to the chat tool"
```

---

### Task C3: health-insight — BLE temp + stale-row annotation

**Files:**
- Modify: `app/api/ai/health-insight/route.ts`

- [ ] **Step 1: Fetch the daily summaries**

Extend the `Promise.all` (line ~61):

```typescript
  const [ouraRows, sleepRows, bodyMetrics, summaries] = await Promise.all([
    repo.getOuraDaily(userId, since7, date),
    repo.listSleepSessions(userId, since7, date),
    repo.listBodyMetrics(userId, since7, date),
    repo.getOuraDailySummary(userId, since7, date),
  ])
```

- [ ] **Step 2: Annotate the stale-row fallback (found in verification — S8-adjacent)**

`todayOura` (line 67) falls back to the last row in the window and can present its scores as "today". After it's computed:

```typescript
  const latestSummary = summaries[summaries.length - 1] ?? null
  const staleNote = todayOura && todayOura.date !== date
    ? `NOTE: Oura daily fields below are from ${todayOura.date} (latest available — ring Cloud data is frozen since the 2026-07-07 re-key).`
    : null
```

Prepend `staleNote` to `dataLines` in every section branch when non-null (e.g. after the branch chain: `if (staleNote) dataLines.unshift(staleNote)`).

- [ ] **Step 3: BLE-first temp line (readiness branch, lines ~74-76)**

```typescript
      latestSummary?.tempDevC != null
        ? `Body temp deviation (vs personal ring baseline): ${latestSummary.tempDevC > 0 ? '+' : ''}${latestSummary.tempDevC.toFixed(1)}°C`
        : todayOura?.temperatureDeviation != null
          ? `Body temp deviation: ${todayOura.temperatureDeviation > 0 ? '+' : ''}${todayOura.temperatureDeviation.toFixed(1)}°C (pre-re-key Cloud value — not current)`
          : 'Body temp deviation: no data',
```

- [ ] **Step 4: Dev-server smoke + commit**

`pnpm dev`; POST `/api/ai/health-insight` with `{"section":"readiness","force":true}` (logged-in cookie). Expected: 200 with an insight (or a clean JSON error if no Gemini key locally — the route must not 500 from these changes; the data-lines construction is what's under test, add `console.log(dataLines)` temporarily if needed and remove it).

```bash
git add app/api/ai/health-insight/route.ts
git commit -m "Health-insight: BLE temp deviation, annotate stale Oura rows"
```

---

# Chunk D — remaining display surfaces + tester battery

### Task D1: SpO₂/HRV/RHR card — date-stamp non-today fallbacks (all three tiles)

**Files:**
- Modify: `components/health/body-cards/rhr-hrv-spo2-card.tsx`

- [ ] **Step 1: Track which row supplied each value**

The card's `metaRecent.find(...)` fallback (line ~22-24) can surface a weeks-old value as "latest" with no date — the review names SpO₂, but RHR/HRV share the identical pattern (sibling-surface sweep: fix all three). Replace the three lookups:

```tsx
function latestWithDate(
  metaToday: BodyMetaRow | null,
  metaRecent: BodyMetaRow[],
  key: 'restingHeartRate' | 'hrvMs' | 'spo2Pct',
): { value: number; staleDate: string | null } | null {
  if (metaToday?.[key] != null) return { value: metaToday[key]!, staleDate: null }
  const row = metaRecent.find(r => r[key] != null)
  return row ? { value: row[key]!, staleDate: row.date } : null
}
```

```tsx
  const rhr  = latestWithDate(metaToday, metaRecent, 'restingHeartRate')
  const hrv  = latestWithDate(metaToday, metaRecent, 'hrvMs')
  const spo2 = latestWithDate(metaToday, metaRecent, 'spo2Pct')
```

- [ ] **Step 2: Render the date in the unit line when stale**

Import `formatDayShort` from `@/lib/date-utils`. Per tile (SpO₂ shown; RHR/HRV identical with their units):

```tsx
          {metaLoading ? (
            <div className="h-6 w-12 animate-pulse rounded bg-muted" />
          ) : spo2 != null ? (
            <p className="text-xl font-bold tabular-nums" style={{ color: "#06b6d4" }}>{spo2.value.toFixed(1)}</p>
          ) : (
            <p className="text-xs text-muted-foreground">No data</p>
          )}
          <p className="text-[9px] text-muted-foreground mt-0.5">
            % O₂{spo2?.staleDate ? ` · ${formatDayShort(spo2.staleDate)}` : ''}
          </p>
```

(Text marker, not colour — the date itself is the staleness signal, e.g. "% O₂ · Jul 2". Existing hex accents on this card are pre-existing; don't add new ones.)

- [ ] **Step 3: Dev-server check + commit**

On the local DB, null out today's `spo2_pct` in `body_metrics` and confirm the card shows the older reading's date; restore afterwards.

```bash
git add components/health/body-cards/rhr-hrv-spo2-card.tsx
git commit -m "Show the reading date when RHR/HRV/SpO2 tiles fall back to an older day"
```

---

### Task D2: activity tiles — coalesce-point note (no behaviour change)

**Files:**
- Modify: `app/health/activity/activity-content.tsx`

- [ ] **Step 1: Add the coordination comment above the tiles (line ~30)**

The route-side gate (Task B2) is the functional change; the tiles already hide on null. Mark the render site for the parallel plan:

```tsx
          {/* stressHigh/recoveryHigh are frozen-Cloud seconds, gated at the route since the
              2026-07-07 re-key (hidden until then). The daytime-stress-wiring plan replaces
              them with derived values — when it lands, these tiles light back up automatically
              via the route's coalesce point; keep the null-hides behaviour. */}
          {data.stressHigh != null && data.recoveryHigh != null && (
```

- [ ] **Step 2: Commit**

```bash
git add app/health/activity/activity-content.tsx
git commit -m "Mark the stress/recovery tiles' derived-stress coalesce point"
```

(`readiness-content.tsx` day-summary and `rest-day-card.tsx` bedtime need **no** component change — they already hide on null and the route now guarantees null for frozen rows. Verify both render nothing in the final smoke.)

---

### Task D3: admin tester battery — drop the dead `0x61` read (S10)

**Files:**
- Modify: `lib/data/postgres/adapter.ts`, `lib/data/repository.ts`, `components/oura-ble/oura-ble-debug.tsx`

`0x61 debug_data` is in `RAW_STORAGE_DROP_TAGS` (`lib/oura-ble/raw-storage.ts:17`) so no new rows ever carry `battery_pct` — `getOuraRawSampleSummary`'s battery figure is permanently frozen at the last pre-drop row. The tester **already shows the live plugin battery** (`status?.battery` at `oura-ble-debug.tsx:433`, fed by `OuraBleStatus.battery` + the `readBattery()` button at line 651), so the fix is removal, not addition. Do **not** re-store 0x61.

- [ ] **Step 1: Adapter (`getOuraRawSampleSummary`, ~lines 4520-4535, 4560)**

Remove the `recent([0x61])` element and its `battRows` binding from the `Promise.all` destructure:

```typescript
    const [hrRows, tempRows, hrvRows, spo2Rows, spo2RPiRows, [anchor], [span]] = await Promise.all([
      recent([0x80, 0x60, 0x5d]),
      recent([0x46, 0x69, 0x75]),
      recent([0x5d]),
      recent([0x6f]),
      recent([0x8b]),
      anchorQuery,
      spanQuery,
    ])
```

Delete the `let latestBatteryPct …` loop (lines 4531-4535) and the `latestBatteryPct,` line from the returned object (line 4560).

- [ ] **Step 2: Repository type (`lib/data/repository.ts:137`)**

Delete `latestBatteryPct: number | null` from `OuraRawSampleSummary`.

- [ ] **Step 3: Tester component (`components/oura-ble/oura-ble-debug.tsx`)**

Delete `latestBatteryPct: number | null` from the local summary interface (line ~40) and the Battery `<Stat …/>` from the "Recorded to server" grid (line ~487) — battery is device state, not server-recorded data; the live readout in the status strip (line 433) is the honest source. The grid drops from 5 stats to 4.

- [ ] **Step 4: Typecheck + grep + commit**

Run: `npx tsc --noEmit 2>&1 | head -5` and `grep -rn "latestBatteryPct" app components lib` (expected: no hits).

```bash
git add lib/data/postgres/adapter.ts lib/data/repository.ts components/oura-ble/oura-ble-debug.tsx
git commit -m "Read tester battery from live plugin status only; drop dead 0x61 summary read"
```

---

### Task Final: full gate + smoke + version + docs

- [ ] **Step 1: Full gate**

Run: `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 2: Dev-server smoke — S25 viewport (≤640px), BOTH themes**

`pnpm dev` against the local DB (seed Cloud vitals + a pre-re-key temp row per Task B2 Step 7 so the stale paths actually render). Check each screen in dark **and** light:

1. **/overview** — expand the ReadinessCard: temp-deviation row shows the BLE value with no marker (seed `oura_daily_summary.temp_dev_c` > 0.3 on the latest row to force it), or the "Pre-re-key" icon+text marker on a Cloud-only fallback; no `resilience` anywhere.
2. **/health/heart-rate** — VO₂ Max / Vascular Age tiles render with the "as of \<date\>" stamp.
3. **/health/activity** — no Stress/Recovery tiles (gated); score + contributors unaffected.
4. **/health/readiness** — no day-summary card; score/contributors/illness advisory unaffected.
5. **Home rest-day card** (visible on a rest day, or temporarily force `guidance.band === 'rest'` locally) — no "Recommended bedtime" line.
6. **/health Body tab** — SpO₂ tile shows "· \<date\>" when today's `spo2_pct` is null (null it in the local DB to check); RHR/HRV tiles likewise.
7. **Admin BLE tester page** — renders without the Battery stat in "Recorded to server"; page loads clean on web (plugin-gated sections show their fallbacks).
8. **AI chat** — ask a recovery question; response reflects the summary without erroring (temp line present when seeded).

- [ ] **Step 3: State what was NOT exercised (honesty statement for the PR)**

- **On-device (APK):** the admin tester's live battery strip (`status?.battery`) only populates with the native plugin — web shows `—`. This PR removes a dead server-side stat and touches no Kotlin, so **no APK rebuild is needed** (JS/server only, ships via Railway); the live-battery readout itself is pre-existing device behaviour. Verify on the S25 per `docs/device-smoke-checklist.md`, or add the Known-Issues row marking the tester readout not-yet-device-verified.
- **Prod data drift:** the local seed has no real Cloud-era rows; the seeded-row smoke above approximates prod. The vitals date-stamp and temp fallback paths depend on real pre-re-key rows existing in prod (they do — Cloud synced until 2026-07-07).
- Real Gemini calls (health-insight/chat) if no API key is present locally.

- [ ] **Step 4: Version + changelog + journal + index (before merge — same PR)**

Bump `package.json` **patch** (1.154.1 → 1.154.2 at plan time — re-bump on whatever `main` holds). `lib/changelog.ts` entry:

> "Health surfaces no longer present frozen pre-re-key Oura Cloud data as current: temperature deviation now comes from the ring's own nightly baseline (Cloud shown only as a marked pre-re-key fallback), VO₂ max and vascular age are back on the heart-rate page date-stamped 'as of' their last Cloud day, the SpO₂/HRV/resting-HR tiles show the reading's date when it isn't from today, the AI coach is told which values are frozen, and the frozen stress/recovery/day-summary/bedtime/resilience passthroughs are gated or removed."

Append the session note to the current `docs/overview/history-*.md`, update `projectOverview.md` (current status; strike/annotate the review-S8/S10 Known-Issues rows if present), and **remove this plan's backlog entry** from `docs/implementation-backlog.md` in the same PR.

- [ ] **Step 5: Push + PR**

```bash
git push -u origin fix/frozen-cloud-display-honesty
```

Open the PR, subscribe to CI, merge when green per the standing CI/CD workflow (standard change — no destructive carve-out applies: no migrations, no auth/security, no secrets).

---

## Verification summary

- **Automated:** `cloud-freshness` unit tests (5), updated `ai-chat-context` tests, full existing suite + lint + typecheck + build.
- **Dev-server (sandbox):** readiness-route JSON contract curl; the eight-screen smoke above at ≤640px in both themes with seeded stale rows.
- **On-device:** only the tester's live battery strip is plugin-gated (pre-existing behaviour, no Kotlin change) — everything this PR changes is web-verifiable.

## Notes for the implementer

- **Re-verify against `main` first** (standing rule): this plan was written 2026-07-16 against a fast-moving tree. In particular, if the **daytime-stress-wiring** PR has landed, wire its derived stress fields into the Task B2 coalesce point (mind minutes-vs-seconds) instead of leaving the tiles gated-dark; if the **oura-models** resilience work has landed, keep its *derived* `resilience_level` — this plan removes only the frozen Cloud string passthrough.
- Do not touch `RAW_STORAGE_DROP_TAGS`, `computeBlendedScore`'s Cloud temp argument, `ai-dynamic.ts`'s `daySummary` consumer, or the Cloud sync/webhook writers — all deliberately out of scope (rationale in the scoping notes above).
- The `readiness-score` cache key/TTL/invalidation groups are untouched — same endpoint, additive-or-narrowing response shape; `cachedFetchToday` self-expires at date rollover.
- Field names against the pinned source, not memory: `oura_daily_summary.temp_dev_c` ↔ `OuraDailySummaryRow.tempDevC` (`slices/oura.ts:580/615`), `OuraBleStatus.battery` (`lib/oura-ble/plugin.ts:5`).
