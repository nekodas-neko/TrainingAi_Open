# Scale Weight Trend — Use the Day's Lowest Confirmed Reading, Not the First

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (owner request):** today, only the **first** confirmed scale reading of the local day ever
sets the `body_metrics` weight trend for that date — every later same-day reading is archived to
`scale_raw_samples` but never touches the trend, by deliberate design (the "fasted-morning-weigh-in
convention", so a heavier evening reading can't drag the trend around). The owner's concern: if the
*first* reading happened to be taken with clothes on and a later reading that same day was nude
(and lower), the clothed reading is permanently stuck as the day's trend value with no way to
correct it short of a manual weight edit.

**Decision (owner, this session):** rather than averaging same-day readings (rejected — averaging a
clothed and a nude reading launders the bad one into the trend instead of replacing it, and in
general blending readings taken at different food/water states makes the trend noisier, not more
accurate) or adding a manual "use this reading instead" UI control (rejected as unnecessary), the
day's trend should default to the **lowest** confirmed reading seen so far that day. Clothes only
ever add weight, so a later nude reading naturally comes in lower and can replace an earlier clothed
one — while on a normal day the fasted morning weigh-in is already the day's lowest point (food/water
only adds weight afterward), so this changes nothing for the common case. It only kicks in for
exactly the failure mode described.

**Tech Stack:** TypeScript/Node (repository layer + one small route), Drizzle/Postgres. No
migration, no native change, no new storage — every reading is already archived to
`scale_raw_samples` unconditionally regardless of this logic.

---

## Current behavior (for reference — do not re-derive, this was traced in the same session)

- `lib/scale-ble/apply-reading.ts` — `applyScaleReadingToBodyMetrics()` calls
  `repo.hasConfirmedScaleTrendForDate(userId, readingDay)` (boolean). If **true** (a trend already
  exists for today), it returns early at line 36 **without writing anything** — the new reading is
  discarded from `body_metrics` (still archived upstream in `scale_raw_samples`, unconditionally, by
  the caller in `app/api/scale-ble/samples/route.ts`).
- `lib/data/postgres/adapter.ts:1849-1860` — `hasConfirmedScaleTrendForDate` is a plain existence
  check: `body_metrics.source_map->>'weight_kg' = 'scale_ble'` for that user+date.
- `app/api/scale-ble/today/route.ts:20-25` — the Settings → Scale "Today's weigh-ins" list computes
  `isTrend: i === 0` (assumes the trend reading is always the chronologically-first one in the
  list) — this assumption breaks once the trend can be a later, lower reading, and **must be fixed
  in the same PR** or the badge will point at the wrong row.
- The anomaly gate (`app/api/scale-ble/samples/route.ts`, compares against
  `getMostRecentConfirmedWeightKg`) already rejects wildly-implausible readings into a
  manual-confirmation queue (`status: 'pending'`) rather than auto-applying them — so this plan's
  comparison only ever runs on readings that already passed that plausibility check. No new
  filtering needed for "legitimate."
- `upsertBodyMetrics(userId, [...], 'scale_ble')` already goes through the ranked per-field merge
  (`lib/data/health-source.ts` `mergeSet`, `manual(5) > scale_ble(4) > ...`). A `manual` weight entry
  for the day already cannot be overwritten by any scale reading, first or not — this plan doesn't
  need to special-case that, it composes correctly through the existing merge as-is.

## Fix

### Task 1: Fetch the current confirmed scale weight, not just its existence

**Files:**
- Modify: `lib/data/repository.ts` (interface), `lib/data/postgres/adapter.ts`

- [ ] Replace `hasConfirmedScaleTrendForDate(userId, date): Promise<boolean>` with
  `getConfirmedScaleTrendForDate(userId, date): Promise<{ weightKg: number } | null>` — same query
  shape as today (`adapter.ts:1849-1860`), just select `weight_kg` instead of a literal `1` and
  return the row (or `null`). Check all call sites before renaming (`apply-reading.ts` is the only
  one found in this session's research, but re-verify).

### Task 2: Compare instead of skip

**Files:**
- Modify: `lib/scale-ble/apply-reading.ts`

- [ ] Replace the boolean early-return with: fetch `existing = await
  repo.getConfirmedScaleTrendForDate(userId, readingDay)`. If `existing === null` → write (today's
  first-reading-of-the-day path, unchanged). If `existing !== null` → write **only if**
  `weightKg < existing.weightKg` (strictly lower — an equal reading is a no-op, matching today's
  de-dup intent; a higher reading is discarded exactly as today). `isAdditionalReadingToday` keeps
  its current meaning ("a confirmed reading already existed today") — it's still `true` in both the
  discarded and the trend-replaced case, so no caller of this return value needs to change.
- [ ] Update this file's own doc comment (currently "Only the day's FIRST confirmed reading sets the
  trend value") to describe the new lowest-wins convention and why (clothes only add weight; a
  fasted morning weigh-in is already the day's low point in the ordinary case, so this only changes
  behavior for the clothed-first-reading scenario it was designed for).

### Task 3: Fix the Settings → Scale "Trend" badge

**Files:**
- Modify: `app/api/scale-ble/today/route.ts`

- [ ] Replace `isTrend: i === 0` with a comparison against the actual current `body_metrics` weight
  for that date (fetch it once, mark whichever reading in the list has the matching value) — the
  assumption "trend = first in the list" no longer holds once a later reading can win.

### Task 4: Tests

**Files:**
- Modify: `lib/data/postgres/__tests__/scale-ble-multi-reading.test.ts` (existing DB-backed test
  file, already covers the current first-wins behavior — update/extend, don't duplicate)

- [ ] First reading of the day sets the trend (unchanged case).
- [ ] A second, **higher** same-day reading does not overwrite (unchanged case — e.g. an evening
  reading after food/water).
- [ ] A second, **lower** same-day reading **does** overwrite (the new case — e.g. a clothed-first,
  nude-second scenario).
- [ ] A third reading equal to the current minimum is a no-op (doesn't error, doesn't re-write).
- [ ] A `manual` weight entry for the day is never overwritten by any scale reading regardless of
  value (confirms the rank-merge composition still holds — this should already pass unchanged,
  written as a regression guard).
- [ ] The Settings → Scale "Today's weigh-ins" list marks the correct row as `isTrend` after a
  lower second reading replaces the first.

### Task 5: Verification

- [ ] `pnpm dev` + the test suite above — this is pure server-side logic, no device/native surface
  is touched, so no on-device gate applies beyond normal `pnpm dev` sanity (confirm a real POST to
  `/api/scale-ble/samples` with a lower second-reading payload actually updates `body_metrics` and
  the Settings page badge).
- [ ] Confirm the existing anomaly-gate/pending-confirmation flow is unaffected — this plan only
  changes what happens to a reading that already passed that gate.
