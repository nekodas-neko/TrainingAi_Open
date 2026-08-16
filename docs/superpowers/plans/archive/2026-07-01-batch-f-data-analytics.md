# Batch F — Data & Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five Batch F items from `docs/planned_upgrades.md`: (F1) a morning check-in stored as `phase='morning'` on the existing `day_checkins` domain, fully offline-first, pre-filled from Oura and fed into the AI periodization signals; (F2) sync Oura enhanced tags, sessions, rest-mode periods and the breathing disturbance index, surfacing tags on the day timeline; (F3) a one-tap session-RPE prompt on the done screen plus a tested rest-adherence helper; (F4) a generic correlation-bucketing engine extracted from the sleep-performance route powering five new trend views on Health > Progress; (F5) data-viz consolidation — hypnogram transform helper, `HealthScoreDetail` dedupe, one `<Sparkline>` + `scoreBand()`, N-hue `SET_COLORS`, MuscleHeatmap weekly-volume tint, and a 1RM projection/plateau detector feeding `signals.ts`.

**Architecture:** Five independently shippable phases, one feature branch + PR each, in order F1→F5. All Batch F Postgres DDL lives in **one reserved migration file, `106_batch_f_data_analytics.sql`**, which ships in the *first* Batch F PR to merge (planned: F1) — later phases depend on it being on `main`. Local SQLite changes are **purely additive columns delivered via `RECONCILE_COLUMNS`** (runs on every open, guarded by `PRAGMA table_info`), so Batch F consumes **no local schema version** and is completely order-independent from Batch A's reserved v13 (see "Local SQLite strategy" below). Offline-first rule applies to every new write path (F1 morning check-in, F3 session RPE): local write + outbox, renderable columns locally, local-first reads, hydration, pull delta.

**Tech Stack:** Next.js 15 + React 19 + TypeScript, Drizzle/Postgres (Railway), Capacitor local SQLite (`lib/local-store/`, `lib/sqlite/`), Oura v2 API (PAT/OAuth), chart.js + react-chartjs-2 (dynamic-imported), Vitest (`lib/__tests__/`, `pnpm test`), pnpm only.

---

## Migration & schema ledger — single source of truth

### Postgres: `lib/data/postgres/migrations/106_batch_f_data_analytics.sql`

**Verified facts (investigated 2026-07-01):**
- Migration `102_day_checkins.sql` already declares `UNIQUE (user_id, log_date, phase)` and `lib/data/postgres/schema.ts:341` mirrors it (`unique().on(t.userId, t.logDate, t.phase)`). **No constraint migration is needed for F1** — the reserved `106_day_checkins_phase_unique.sql` name is NOT used; 106 is instead the combined Batch F DDL file below.
- `oura_daily` (schema.ts:578–628) has **no** `breathing_disturbance_index` column → added in 106.
- `workout_sessions` (schema.ts:142–157) has **no** `session_rpe` column → added in 106.
- Migrations 103–105 are reserved by other batches (103 = Batch B indexes). `ensureSchema` applies migration files in filename order; gaps in the sequence are fine, so 106 can land before 103–105 exist.

**The complete contents of 106 — everything Batch F adds to Postgres, in one place:**

```sql
-- Batch F (data & analytics): morning check-in scales, Oura tags/sessions/rest-mode,
-- SpO2 breathing disturbance index, one-tap session RPE.

-- F1 — morning check-in scales on day_checkins. phase='morning' rows use these five;
-- the UNIQUE (user_id, log_date, phase) constraint from migration 102 already covers
-- one morning row per (user, day) — no constraint change needed.
ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS wake_mood          INTEGER;
ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS perceived_recovery INTEGER;
ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS motivation         INTEGER;
ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS sleep_quality_feel INTEGER;
ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS resting_soreness   INTEGER;

-- F2 — Oura enhanced tags, sessions (moments) and rest-mode periods; one row each.
-- oura_id is the Oura document id (dedup key on re-sync).
CREATE TABLE IF NOT EXISTS oura_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  oura_id     TEXT NOT NULL UNIQUE,
  source      TEXT NOT NULL,     -- 'enhanced_tag' | 'session' | 'rest_mode'
  tag_type    TEXT,              -- tag_type_code | session type (breathing/meditation/nap/…) | 'rest_mode'
  custom_name TEXT,              -- enhanced_tag custom_name
  comment     TEXT,              -- enhanced_tag freeform comment
  mood        TEXT,              -- session mood: bad|worse|same|good|great
  start_day   DATE NOT NULL,
  end_day     DATE,
  start_time  TIMESTAMPTZ,
  end_time    TIMESTAMPTZ,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oura_tags_user_day ON oura_tags (user_id, start_day);

-- F2 — BDI from the spo2_daily payload the sync already fetches but drops.
ALTER TABLE oura_daily ADD COLUMN IF NOT EXISTS breathing_disturbance_index DOUBLE PRECISION;

-- F3 — one-tap session RPE captured on the done screen (Foster sRPE method, 1–10).
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS session_rpe INTEGER;
```

This file is created in **Task 1.1** and ships with the F1 PR. F2 and F3 tasks reference these columns but add no further DDL. If phase order ever changes, move the file into whichever Batch F PR merges first — it must exist on `main` before F2/F3 merge.

### Local SQLite strategy — no version bump; RECONCILE_COLUMNS only

Batch A reserves local schema **v13** (`lib/sqlite/migrations.ts` is at v12). Batch F's local changes are six **purely additive columns**, and `reconcileSchema()` (`lib/sqlite/sqlite-service.ts:85`) runs `RECONCILE_COLUMNS` on **every DB open**, guarded per-column by `PRAGMA table_info`. Delivering the columns through `RECONCILE_COLUMNS` alone:

- is idempotent and safe (existing precedent: `exercise_logs.muscle_groups` was delivered reconcile-only, migrations.ts:94-95);
- avoids the documented duplicate-column rollback hazard (migrations.ts:82-86) — a versioned `ALTER` that races the reconcile path would fail with "duplicate column" and roll the whole version back;
- makes Batch F **completely order-independent from Batch A**: no `toVersion: 14` entry is added, so a device can receive A-then-F or F-then-A in any order. v14 stays free.

**The complete local additions (Task 1.3 adds the first five, Task 3.3 adds the sixth — both to `RECONCILE_COLUMNS` in `lib/sqlite/migrations.ts`):**

```ts
// Batch F — additive columns, delivered via reconcile (runs every open) so they are
// version-independent from Batch A's v13. Do NOT also add a versioned ALTER.
{ table: 'day_checkins',     column: 'wake_mood',          ddl: `ALTER TABLE day_checkins ADD COLUMN wake_mood INTEGER` },
{ table: 'day_checkins',     column: 'perceived_recovery', ddl: `ALTER TABLE day_checkins ADD COLUMN perceived_recovery INTEGER` },
{ table: 'day_checkins',     column: 'motivation',         ddl: `ALTER TABLE day_checkins ADD COLUMN motivation INTEGER` },
{ table: 'day_checkins',     column: 'sleep_quality_feel', ddl: `ALTER TABLE day_checkins ADD COLUMN sleep_quality_feel INTEGER` },
{ table: 'day_checkins',     column: 'resting_soreness',   ddl: `ALTER TABLE day_checkins ADD COLUMN resting_soreness INTEGER` },
{ table: 'workout_sessions', column: 'session_rpe',        ddl: `ALTER TABLE workout_sessions ADD COLUMN session_rpe INTEGER` },
```

Do **not** modify `CREATE_DAY_CHECKINS` / `CREATE_WORKOUT_SESSIONS` base definitions — per the file's convention, base CREATEs keep their original shape and reconcile restores later columns. No new local tables are needed (Oura tags are server-read via the day-timeline API, not a local-store domain).

---

## Phase F1 — Morning check-in (`feat/morning-checkin`)

The `day_checkins` domain already exists end-to-end for `phase='evening'` (Postgres table + Drizzle schema, `saveDayCheckin`/`getDayCheckin` in `adapter.ts:1871–1911`, `pushMutations` branch at `adapter.ts:2502`, `getSyncDelta` at `adapter.ts:2365`, local table `CREATE_DAY_CHECKINS` in `lib/sqlite/migrations.ts:304`, `upsertDayCheckin`/`getDayCheckin`/`applyDelta` in `lib/local-store/sqlite-backend.ts:456–519,807–819`, pull mapping in `lib/local-store/sync-engine.ts:280–293`, confirm branch at `sync-engine.ts:386-388`, API route `app/api/day-checkin/route.ts`). Every one of those sites already threads `phase`. **What's missing is only: the five morning scale columns, their mappings at each of those sites, the UI, the prompt, and the AI wiring.**

### Task 1.1 — Migration 106 + Drizzle schema + types

- [ ] Create `lib/data/postgres/migrations/106_batch_f_data_analytics.sql` with the exact SQL from the ledger above.
- [ ] `lib/data/postgres/schema.ts` — add to `dayCheckins` (after `lateHeavyMeal`):

```ts
  wakeMood:          integer('wake_mood'),
  perceivedRecovery: integer('perceived_recovery'),
  motivation:        integer('motivation'),
  sleepQualityFeel:  integer('sleep_quality_feel'),
  restingSoreness:   integer('resting_soreness'),
```

  Also add to `ouraDaily` (F2 uses it, schema ships once): `breathingDisturbanceIndex: doublePrecision('breathing_disturbance_index'),` and to `workoutSessions` (F3): `sessionRpe: integer('session_rpe'),`.
- [ ] `lib/types/day-checkin.ts` — extend `DayCheckin` and add `MORNING_SCALES`:

```ts
export interface DayCheckin {
  // …existing fields…
  // Morning (phase='morning') scales — null on evening rows.
  wakeMood: number | null          // 1 (great) … 5 (awful)
  perceivedRecovery: number | null // 1 (fully recovered) … 5 (wrecked)
  motivation: number | null        // 1 (fired up) … 5 (none)
  sleepQualityFeel: number | null  // 1 (slept great) … 5 (terrible)
  restingSoreness: number | null   // 1 (none) … 5 (very sore)
}

// The five morning scales, in display order — same shape as EVENING_SCALES so
// ScaleSelector/WellnessSection render either set.
export const MORNING_SCALES = [
  { key: 'wakeMood',          label: 'Wake mood',            low: 'Great',           high: 'Awful' },
  { key: 'perceivedRecovery', label: 'Recovery',             low: 'Fully recovered', high: 'Wrecked' },
  { key: 'motivation',        label: 'Motivation to train',  low: 'Fired up',        high: 'None' },
  { key: 'sleepQualityFeel',  label: 'Sleep quality (feel)', low: 'Slept great',     high: 'Terrible' },
  { key: 'restingSoreness',   label: 'Resting soreness',     low: 'None',            high: 'Very sore' },
] as const

export type MorningScaleKey = typeof MORNING_SCALES[number]['key']
```

- [ ] Run `pnpm db:local` (idempotent) so the local dev Postgres picks up 106; verify with `psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c "\d day_checkins"`.
- [ ] Commit: `Add morning check-in scale columns, oura_tags table, BDI and session_rpe (migration 106)`

### Task 1.2 — Server write/read paths carry the morning fields

- [ ] `lib/data/postgres/adapter.ts` `getDayCheckin` (~:1871): add the five fields to the returned object (`wakeMood: r.wakeMood, …`).
- [ ] `adapter.ts` `saveDayCheckin` (~:1885): add the five fields to `.values({...})` and to the `onConflictDoUpdate` `set` (`wakeMood: sql\`EXCLUDED.wake_mood\``, etc.). Evening saves pass `null`s — harmless, they only ever touch the evening row (conflict target includes `phase`).
- [ ] `adapter.ts` `pushMutations` `day_checkins` branch (~:2502): add `wakeMood: num(p.wakeMood), perceivedRecovery: num(p.perceivedRecovery), motivation: num(p.motivation), sleepQualityFeel: num(p.sleepQualityFeel), restingSoreness: num(p.restingSoreness),`.
- [ ] `getSyncDelta` (~:2365) uses `this.db.select().from(s.dayCheckins)` — full row select, so the new columns ride the pull delta automatically. **Verify** (read the query, confirm no explicit column list).
- [ ] `app/api/day-checkin/route.ts` — extend the Zod `Body` with the five optional 1–5 ints (same shape as `physicalTiredness`) and pass them through in the `saveDayCheckin` call. Update the `saveDayCheckin` call sites in this route and anywhere else `Omit<DayCheckin, …>` is constructed (TypeScript will flag them once the interface grows).
- [ ] `pnpm lint && pnpm test` green.
- [ ] Commit: `Thread morning check-in scales through day-checkin write and sync paths`

### Task 1.3 — Local store carries the morning fields (offline-first checklist part 1)

- [ ] `lib/sqlite/migrations.ts` — add the **five** `day_checkins` entries to `RECONCILE_COLUMNS` exactly as listed in the ledger (leave `CREATE_DAY_CHECKINS` untouched; no `toVersion` entry).
- [ ] `lib/local-store/types.ts` `LocalDayCheckin` (:214) — add `wakeMood`, `perceivedRecovery`, `motivation`, `sleepQualityFeel`, `restingSoreness` as `number | null`.
- [ ] `lib/local-store/sqlite-backend.ts`:
  - `getDayCheckin` (:456) — map the five new columns (`wakeMood: (r.wake_mood as number) ?? null`, …).
  - `upsertDayCheckin` (:479) — add the five columns to the INSERT column list, VALUES placeholders, `ON CONFLICT … DO UPDATE SET` list, and the params array.
  - `applyDelta` `dayCheckins` branch (:807) needs no change — it delegates to `upsertDayCheckin`.
- [ ] `lib/local-store/sync-engine.ts` `pullDelta` `dayCheckins` mapping (:280) — add the five fields (`wakeMood: (r.wakeMood as number) ?? null`, …). The confirm branch (:386) keys on `(date, phase)` and already works for morning rows.
- [ ] `pnpm lint && pnpm test` green.
- [ ] Commit: `Mirror morning check-in scales in the local day_checkins store and pull delta`

### Task 1.4 — Prefill helper (TDD)

- [ ] Write the test first — `lib/nutrition/__tests__/day-checkin-prefill.test.ts` (extend or create alongside the existing prefill helper):

```ts
import { describe, it, expect } from 'vitest'
import { prefillMorningScales } from '@/lib/nutrition/day-checkin-prefill'

describe('prefillMorningScales', () => {
  it('maps high Oura readiness to a recovered default', () => {
    expect(prefillMorningScales({ readiness: 85, sleepScore: 88 })).toEqual({
      wakeMood: 3, perceivedRecovery: 1, motivation: 3, sleepQualityFeel: 1, restingSoreness: 3,
    })
  })
  it('maps low readiness / sleep to strained defaults', () => {
    expect(prefillMorningScales({ readiness: 40, sleepScore: 55 })).toEqual({
      wakeMood: 3, perceivedRecovery: 4, motivation: 3, sleepQualityFeel: 3, restingSoreness: 3,
    })
  })
  it('defaults everything to 3 with no Oura data', () => {
    expect(prefillMorningScales({ readiness: null, sleepScore: null })).toEqual({
      wakeMood: 3, perceivedRecovery: 3, motivation: 3, sleepQualityFeel: 3, restingSoreness: 3,
    })
  })
})
```

- [ ] Implement in `lib/nutrition/day-checkin-prefill.ts` (next to `prefillEveningScales`):

```ts
// Oura score (0-100, higher = better) → 1-5 scale (1 = best), mirroring
// readinessToEnergy in mood-checkin-sheet.tsx.
const scoreToScale = (s: number | null | undefined): number => {
  if (s == null) return 3
  if (s >= 80) return 1
  if (s >= 65) return 2
  if (s >= 50) return 3
  if (s >= 35) return 4
  return 5
}

export function prefillMorningScales(sig: { readiness?: number | null; sleepScore?: number | null }) {
  return {
    wakeMood: 3,          // no reliable objective signal
    perceivedRecovery: scoreToScale(sig.readiness),
    motivation: 3,        // no reliable objective signal
    sleepQualityFeel: scoreToScale(sig.sleepScore),
    restingSoreness: 3,   // subjective only
  }
}
```

- [ ] `pnpm test` green.
- [ ] Commit: `Prefill morning check-in scales from Oura readiness and sleep score`

### Task 1.5 — Reusable scale UI + MorningCheckinSheet

Reuse, don't fork: `ScaleSelector` (`components/nutrition/end-of-day/scale-selector.tsx`) is already generic (`{ label, low, high, value, onChange }`). `WellnessSection` is hard-coded to `EVENING_SCALES` + sore-muscle chips; the morning sheet has no muscle chips, so it maps `MORNING_SCALES` over `ScaleSelector` directly — `WellnessSection` stays untouched.

- [ ] Create `components/morning-checkin-sheet.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { X, Sunrise, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { toast } from 'sonner'
import { useSheetBackDismiss } from '@/lib/hooks/use-sheet-back-dismiss'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { invalidateReadinessInputs } from '@/lib/cache-groups'
import { prefillMorningScales } from '@/lib/nutrition/day-checkin-prefill'
import { MORNING_SCALES, type MorningScaleKey } from '@/lib/types/day-checkin'
import { ScaleSelector } from '@/components/nutrition/end-of-day/scale-selector'
import { todayInTz } from '@/lib/date-utils'

interface Props {
  open: boolean
  onClose: () => void
  userId?: string
  readiness?: number | null   // Oura readiness — perceived-recovery default
  sleepScore?: number | null  // Oura sleep score — sleep-quality-feel default
  onSaved?: () => void
}

export function MorningCheckinSheet({ open, onClose, userId, readiness, sleepScore, onSaved }: Props) {
  useSheetBackDismiss(open, onClose)
  const [scales, setScales] = useState<Record<MorningScaleKey, number>>(() =>
    prefillMorningScales({ readiness, sleepScore }))
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open) { setLoaded(false); return }
    if (loaded) return
    let cancelled = false
    async function init() {
      const date = todayInTz()
      const store = userId ? getLocalStore(userId) : null
      const saved = store
        ? await store.getDayCheckin(date, 'morning')
        : await fetch(`/api/day-checkin?date=${date}&phase=morning`)
            .then(r => (r.ok ? r.json() : null)).catch(() => null)
      if (cancelled) return
      if (saved) {
        setScales({
          wakeMood:          saved.wakeMood ?? 3,
          perceivedRecovery: saved.perceivedRecovery ?? 3,
          motivation:        saved.motivation ?? 3,
          sleepQualityFeel:  saved.sleepQualityFeel ?? 3,
          restingSoreness:   saved.restingSoreness ?? 3,
        })
      } else {
        setScales(prefillMorningScales({ readiness, sleepScore }))
      }
      setLoaded(true)
    }
    init()
    return () => { cancelled = true }
  }, [open, loaded, userId, readiness, sleepScore])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    const date = todayInTz()
    const payload = {
      phase: 'morning' as const,
      wakeMood:          scales.wakeMood,
      perceivedRecovery: scales.perceivedRecovery,
      motivation:        scales.motivation,
      sleepQualityFeel:  scales.sleepQualityFeel,
      restingSoreness:   scales.restingSoreness,
      soreMuscles: [] as string[],
      journal: null,
    }
    try {
      const store = userId ? getLocalStore(userId) : null
      if (store) {
        await store.upsertDayCheckin({
          logDate: date,
          physicalTiredness: null, mentalDrain: null, barelyMoved: null,
          hydration: null, lateHeavyMeal: null,
          ...payload,
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          syncStatus: 'pending',
        })
        await store.queueMutation({ userId: userId!, domain: 'day_checkins', date, payload })
        pushMutations(userId!).catch(() => {})
      } else {
        await fetch('/api/day-checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, ...payload }),
        })
      }
      invalidateReadinessInputs().catch(() => {})
      toast.success('Morning check-in saved')
      onSaved?.()
      onClose()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[92vh] flex flex-col p-0 bg-secondary border-t border-border/70"
        hideCloseButton
      >
        <SheetTitle className="sr-only">Morning Check-in</SheetTitle>
        <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Sunrise className="w-4 h-4 text-brand" />
            <h2 className="text-base font-semibold">Morning Check-in</h2>
            {readiness != null && (
              <span className="text-[10px] text-muted-foreground">· Oura readiness {readiness}</span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2.5 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-4">
          {MORNING_SCALES.map(scale => (
            <ScaleSelector
              key={scale.key}
              label={scale.label}
              low={scale.low}
              high={scale.high}
              value={scales[scale.key]}
              onChange={v => setScales(s => ({ ...s, [scale.key]: v }))}
            />
          ))}
        </div>
        <div className="shrink-0 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-border/60 bg-secondary">
          <Button onClick={handleSave} disabled={saving} className="w-full h-12 gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

  (Verify the exact `LocalDayCheckin` field order/`useSheetBackDismiss` import against the codebase while implementing — the shape above mirrors `EndOfDayReview`.)
- [ ] Commit: `Add morning check-in sheet reusing the end-of-day scale selector`

### Task 1.6 — First-open-of-day prompt on the home screen

Follow the `REST_DAY_KEY` date-stamped-marker pattern in `app/session-select/session-select-content.tsx:250–265`.

- [ ] In `session-select-content.tsx`, add next to `REST_DAY_KEY`:

```ts
// First-open-of-day morning check-in prompt. Marker is date-stamped so it fires
// once per day; set on save OR dismiss so a "not now" doesn't re-nag all day.
const MORNING_CHECKIN_KEY = 'ta_morning_checkin'

function isMorningCheckinPromptDone(): boolean {
  if (typeof window === 'undefined') return true
  try { return localStorage.getItem(MORNING_CHECKIN_KEY) === todayInTz() } catch { return true }
}
function markMorningCheckinPromptDone(): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(MORNING_CHECKIN_KEY, todayInTz()) } catch { /* ignore */ }
}
```

- [ ] Add state `const [morningCheckinOpen, setMorningCheckinOpen] = useState(false)` and a mount effect:

```ts
// Prompt the morning check-in on the first app open of the day. Local store is
// checked first so a check-in saved on another device (or before a reinstall)
// suppresses the prompt.
useEffect(() => {
  if (isMorningCheckinPromptDone()) return
  let cancelled = false
  ;(async () => {
    const today = todayInTz()
    const store = userId ? getLocalStore(userId) : null
    const existing = store
      ? await store.getDayCheckin(today, 'morning').catch(() => null)
      : await fetch(`/api/day-checkin?date=${today}&phase=morning`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null)
    if (cancelled) return
    if (existing) { markMorningCheckinPromptDone(); return }
    setMorningCheckinOpen(true)
  })()
  return () => { cancelled = true }
}, [userId])
```

- [ ] Mount the sheet next to the existing `<MoodCheckInSheet>` (~:1474), reusing the already-fetched readiness state:

```tsx
<MorningCheckinSheet
  open={morningCheckinOpen}
  onClose={() => { markMorningCheckinPromptDone(); setMorningCheckinOpen(false) }}
  userId={userId}
  readiness={readiness?.score ?? null}
  sleepScore={null /* wire from oura-stats if already in state; otherwise omit */}
  onSaved={markMorningCheckinPromptDone}
/>
```

  Check whether `session-select-content.tsx` already holds an Oura sleep score in state (it holds `readiness`); pass it if present, otherwise pass `null` — do not add a new fetch just for the prefill.
- [ ] `pnpm lint` green.
- [ ] Commit: `Prompt the morning check-in on first app open of the day`

### Task 1.7 — Feed morning scales into AI signals and the briefing

- [ ] `lib/ai-periodization/signals.ts`:
  - Add to `PrescriptionSignals` (after `sorenessLogDate`):

```ts
  // This morning's subjective check-in (phase='morning' day_checkin), null if none.
  morningCheckin: {
    wakeMood: number | null
    perceivedRecovery: number | null
    motivation: number | null
    sleepQualityFeel: number | null
    restingSoreness: number | null
  } | null
```

  - In `aggregateSignals`, add `repo.getDayCheckin(userId, today, 'morning')` to the second `Promise.all` (:105) and populate the field from the result.
- [ ] `lib/ai-periodization/prompt.ts` — in `recoveryLines` (:125), append:

```ts
    signals.morningCheckin
      ? `  Morning check-in (1=best, 5=worst): recovery ${signals.morningCheckin.perceivedRecovery ?? '—'}, ` +
        `motivation ${signals.morningCheckin.motivation ?? '—'}, sleep feel ${signals.morningCheckin.sleepQualityFeel ?? '—'}, ` +
        `soreness ${signals.morningCheckin.restingSoreness ?? '—'}, wake mood ${signals.morningCheckin.wakeMood ?? '—'}`
      : `  Morning check-in: not logged today`,
```

- [ ] `app/api/morning-briefing/route.ts` — add `repo.getDayCheckin(userId, todayIso, 'morning')` to the `Promise.all` (:32) and a context part:

```ts
  const checkinStr = morningCheckin
    ? `self-reported this morning (1 best – 5 worst): recovery ${morningCheckin.perceivedRecovery ?? '—'}, motivation ${morningCheckin.motivation ?? '—'}, sleep feel ${morningCheckin.sleepQualityFeel ?? '—'}`
    : null
```

  and include `checkinStr` in `parts`.
- [ ] Any existing tests touching `PrescriptionSignals` fixtures (`lib/__tests__/confidence.test.ts`, `explain.test.ts`, `autoregulation.test.ts` etc.) — add `morningCheckin: null` to fixtures until they compile; `pnpm test` green.
- [ ] Commit: `Feed the morning check-in into prescription signals and the daily briefing`

### Task 1.8 — Offline-first checklist verification + local testing + PR

Explicit checklist for the new write path (per CLAUDE.md):
1. **Write path**: `MorningCheckinSheet.handleSave` → `store.upsertDayCheckin` + `queueMutation('day_checkins')` + async `pushMutations` — verified in code review of Task 1.5.
2. **Renderable locally**: the five scales are columns on the local `day_checkins` table (Task 1.3) — nothing else is needed to render the sheet's saved state.
3. **Local-first reads**: both the sheet's `init()` and the home-screen prompt read `store.getDayCheckin(date,'morning')` first, API only as fallback.
4. **Hydration**: fallback API reads are display-only (web sandbox); on device the pull delta hydrates (`getSyncDelta` returns the columns, `pullDelta` maps them — Tasks 1.2/1.3).
5. **Pull delta**: morning rows ride the existing `dayCheckins` delta with the new fields mapped.
6. **APK caveat**: web/dev sandbox has no native SQLite (`getLocalStore` → null) so dev-server testing exercises the API-fallback path only; on-device APK verification is the authoritative offline check — flag this in the PR description.

- [ ] Run `pnpm dev` against the local DB and verify:
  - Open `http://localhost:3000` as `test@local.dev` / `testpass123` → morning sheet auto-opens on first load of the day.
  - Save; `psql … -c "SELECT log_date, phase, wake_mood, perceived_recovery FROM day_checkins ORDER BY updated_at DESC LIMIT 3"` shows the morning row.
  - Reload — sheet does not reopen; opening it manually (temporarily clear the marker) shows the saved values, not the prefill.
  - `POST /api/sync/push` path: hit the app once with the local-store mock unavailable (web default) — the API fallback saved correctly, so the push branch is only verifiable by unit-inspecting `pushMutations`' `day_checkins` branch handling a payload containing `wakeMood`.
  - Existing End of Day sheet still saves an evening row unchanged.
- [ ] Update `projectOverview.md` (tick F1 with ⚠️ "needs APK verification" if applicable), bump `package.json` minor version + `lib/changelog.ts` entry.
- [ ] Open PR (branch `feat/morning-checkin`), CI green, **ask the user before merging** ("Ready to merge to main and deploy?").

---

## Phase F2 — Oura tags / sessions / BDI / rest-mode sync (`feat/oura-tags-sync`)

Depends on migration 106 (`oura_tags` table, `oura_daily.breathing_disturbance_index`) being on `main` from F1.

### Task 2.1 — Types + typed clients

- [ ] `lib/oura/types.ts` — add (shapes verified against the openapi v1.34 spec in `.claude/skills/oura-api/references/`):

```ts
// GET /v2/usercollection/enhanced_tag — Scope: tag
export interface OuraEnhancedTag {
  id: string
  tag_type_code: string | null   // e.g. 'tag_generic_caffeine'; null for text-only; 'custom' for custom tags
  custom_name: string | null
  comment: string | null
  start_time: string             // local ISO 8601
  end_time: string | null        // null when the tag has no duration
  start_day: string              // YYYY-MM-DD
  end_day: string | null
}

// GET /v2/usercollection/session — Scope: session (breathing/meditation/nap moments)
export interface OuraSession {
  id: string
  day: string
  start_datetime: string
  end_datetime: string
  type: 'breathing' | 'meditation' | 'nap' | 'relaxation' | 'rest' | 'body_status'
  mood: 'bad' | 'worse' | 'same' | 'good' | 'great' | null
}

// GET /v2/usercollection/rest_mode_period — Scope: daily
export interface OuraRestModePeriod {
  id: string
  start_day: string
  end_day: string | null
  start_time: string | null
  end_time: string | null
}
```

- [ ] `lib/oura/client.ts` — add three clients following the `fetchDailyStress` pattern (paginated, `.catch(() => [])`):

```ts
export async function fetchEnhancedTags(
  token: string, startDate: string, endDate: string,
): Promise<OuraEnhancedTag[]> {
  return ouraGetAll<OuraEnhancedTag>(token, '/v2/usercollection/enhanced_tag', { start_date: startDate, end_date: endDate })
    .catch(() => [])
}

export async function fetchSessions(
  token: string, startDate: string, endDate: string,
): Promise<OuraSession[]> {
  return ouraGetAll<OuraSession>(token, '/v2/usercollection/session', { start_date: startDate, end_date: endDate })
    .catch(() => [])
}

export async function fetchRestModePeriods(
  token: string, startDate: string, endDate: string,
): Promise<OuraRestModePeriod[]> {
  return ouraGetAll<OuraRestModePeriod>(token, '/v2/usercollection/rest_mode_period', { start_date: startDate, end_date: endDate })
    .catch(() => [])
}
```

- [ ] `buildAuthUrl` (`client.ts:28`) — add `tag` to the OAuth scope string: `'daily heartrate spo2 workout personal session tag ring_configuration'`. (PATs are unscoped, so the user's current PAT connection works immediately.)
- [ ] Commit: `Add Oura enhanced-tag, session and rest-mode API clients`

### Task 2.2 — Repository + adapter

- [ ] `lib/data/repository.ts` — in the "Oura Ring" section add:

```ts
  upsertOuraTags(userId: string, rows: OuraTagRow[]): Promise<void>
  listOuraTags(userId: string, startDay: string, endDay: string): Promise<OuraTagRow[]>
```

  and next to `OuraDailyRow` define:

```ts
export interface OuraTagRow {
  ouraId: string
  source: 'enhanced_tag' | 'session' | 'rest_mode'
  tagType: string | null
  customName: string | null
  comment: string | null
  mood: string | null
  startDay: string
  endDay: string | null
  startTime: Date | null
  endTime: Date | null
}
```

- [ ] `OuraDailyRow` — add `breathingDisturbanceIndex?: number | null`.
- [ ] `lib/data/postgres/slices/oura.ts` (where `upsertOuraDaily`/`upsertOuraSleep` live): implement `upsertOuraTags` (INSERT … `ON CONFLICT (oura_id) DO UPDATE` on the mutable fields) and `listOuraTags` (`WHERE user_id = $1 AND start_day BETWEEN $2 AND $3 ORDER BY start_time`). Add `breathing_disturbance_index` to the `upsertOuraDaily` column list with the same `COALESCE(EXCLUDED.…, oura_daily.…)` pattern the other columns use.
- [ ] Commit: `Store Oura tags, sessions and rest-mode periods in a dedicated table`

### Task 2.3 — Sync route wiring

- [ ] `app/api/oura/sync/route.ts`:
  - Import the three new clients; append to the parallel fetch block (:93):

```ts
      safeFetch('enhanced_tag',     fetchEnhancedTags(token, startDate, endDate)),
      safeFetch('session',          fetchSessions(token, startDate, endDate)),
      safeFetch('rest_mode_period', fetchRestModePeriods(token, startDate, endDate)),
```

  - BDI — the spo2 payload is already fetched; next to `spo2ByDay` (:249) merge it into `dailyMap`:

```ts
    for (const s of spo2) {
      if (s.breathing_disturbance_index == null) continue
      dailyMap.set(s.day, {
        ...dailyMap.get(s.day),
        date: s.day,
        breathingDisturbanceIndex: s.breathing_disturbance_index,
      })
    }
```

  - Map all three tag sources to `OuraTagRow[]` and upsert once:

```ts
    const tagRows: OuraTagRow[] = [
      ...tags.map(t => ({
        ouraId: t.id, source: 'enhanced_tag' as const,
        tagType: t.tag_type_code, customName: t.custom_name, comment: t.comment, mood: null,
        startDay: t.start_day, endDay: t.end_day,
        startTime: t.start_time ? new Date(t.start_time) : null,
        endTime: t.end_time ? new Date(t.end_time) : null,
      })),
      ...ouraSessions.map(s => ({
        ouraId: s.id, source: 'session' as const,
        tagType: s.type, customName: null, comment: null, mood: s.mood,
        startDay: s.day, endDay: null,
        startTime: new Date(s.start_datetime), endTime: new Date(s.end_datetime),
      })),
      ...restModes.map(r => ({
        ouraId: r.id, source: 'rest_mode' as const,
        tagType: 'rest_mode', customName: null, comment: null, mood: null,
        startDay: r.start_day, endDay: r.end_day,
        startTime: r.start_time ? new Date(r.start_time) : null,
        endTime: r.end_time ? new Date(r.end_time) : null,
      })),
    ]
    if (tagRows.length > 0) await repo.upsertOuraTags(userId, tagRows)
```

  - Add `tagRows: tagRows.length` to the `synced` response block.
- [ ] Commit: `Sync Oura tags, sessions, rest-mode and breathing disturbance index`

### Task 2.4 — Render tags on the day timeline

- [ ] `app/api/day-timeline/route.ts`:
  - Add `'tag'` to `TimelineEventType` and optional `tagSource?: string` to `TimelineEvent`.
  - Add `repo.listOuraTags(userId, yesterday, date)` to the `Promise.all` (:86).
  - Emit events (after the walks block):

```ts
  // ── Oura tags / sessions / rest-mode ─────────────────────────────────────
  const TAG_LABEL: Record<string, string> = { rest_mode: 'Rest mode', nap: 'Nap', meditation: 'Meditation', breathing: 'Breathing' }
  for (const t of ouraTags) {
    const startMs = t.startTime?.getTime()
    if (startMs == null || !Number.isFinite(startMs)) continue
    const label = t.customName
      ?? TAG_LABEL[t.tagType ?? '']
      ?? (t.tagType ? t.tagType.replace(/^tag_(generic_)?/, '').replace(/_/g, ' ') : 'Tag')
    events.push({
      type: 'tag',
      time: fmtTime(new Date(startMs), tz),
      endTime: t.endTime ? fmtTime(t.endTime, tz) : undefined,
      timeMs: startMs,
      title: label.charAt(0).toUpperCase() + label.slice(1),
      subtitle: t.comment ?? (t.mood ? `mood: ${t.mood}` : undefined),
      icon: 'Tag',
      day: 'today',  // recomputed below from timeMs
      tagSource: t.source,
    })
  }
```

- [ ] `components/home-day-timeline.tsx` — add a `TagCard` following the `MealCard` pattern (title + subtitle, muted styling), register the `Tag` lucide icon in `ICON_MAP` and a color in `TYPE_ICON_COLOR`, and route `type === 'tag'` to it in `EventRow`.
- [ ] Manual verification (`pnpm dev`): the local dev DB has no Oura token, so seed a row directly — `psql … -c "INSERT INTO oura_tags (user_id, oura_id, source, tag_type, start_day, start_time) SELECT id, 'test-tag-1', 'enhanced_tag', 'tag_generic_caffeine', CURRENT_DATE, now() FROM users LIMIT 1"` — then confirm the tag renders on the home day timeline (and that `/api/day-timeline` returns the `tag` event). Delete the seed row afterwards.
- [ ] `pnpm lint && pnpm test`; update `projectOverview.md`, changelog + version bump; PR, CI green, **ask before merging**.

---

## Phase F3 — Session RPE + rest adherence (`feat/session-rpe`)

Depends on migration 106 (`workout_sessions.session_rpe`) from F1's PR.

### Task 3.1 — Rest-adherence pure helper (TDD)

- [ ] Test first — `lib/workout/__tests__/rest-adherence.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { restAdherencePct } from '@/lib/workout/rest-adherence'

describe('restAdherencePct', () => {
  it('averages actual/prescribed over sets with both values', () => {
    // 90/90 = 1.0, 45/90 = 0.5 → mean 0.75 → 75%
    expect(restAdherencePct([
      { actualRestSec: 90, prescribedRestSec: 90 },
      { actualRestSec: 45, prescribedRestSec: 90 },
      { actualRestSec: null, prescribedRestSec: 90 },   // skipped
      { actualRestSec: 120, prescribedRestSec: null },  // skipped
    ])).toBe(75)
  })
  it('returns null when no set has both values', () => {
    expect(restAdherencePct([{ actualRestSec: null, prescribedRestSec: 90 }])).toBeNull()
    expect(restAdherencePct([])).toBeNull()
  })
  it('caps a single wildly long rest so one forgotten timer cannot dominate', () => {
    // 900/90 capped at 3.0 → (3.0 + 1.0) / 2 = 2.0 → 200%
    expect(restAdherencePct([
      { actualRestSec: 900, prescribedRestSec: 90 },
      { actualRestSec: 90, prescribedRestSec: 90 },
    ])).toBe(200)
  })
})
```

- [ ] Implement `lib/workout/rest-adherence.ts`:

```ts
export interface RestAdherenceSet {
  actualRestSec: number | null | undefined     // set_logs.rest_time_sec
  prescribedRestSec: number | null | undefined // style_sets.rest_sec for the same set number
}

// Mean of actual/prescribed rest across sets where both are known, as a percentage.
// 100 = perfectly on prescription; <100 = rushing rests; >100 = resting long.
// Each ratio is capped at 3× so a forgotten timer doesn't swamp the session mean.
const MAX_RATIO = 3

export function restAdherencePct(sets: RestAdherenceSet[]): number | null {
  const ratios = sets
    .filter(s => s.actualRestSec != null && s.prescribedRestSec != null && s.prescribedRestSec > 0)
    .map(s => Math.min(s.actualRestSec! / s.prescribedRestSec!, MAX_RATIO))
  if (ratios.length === 0) return null
  return Math.round((ratios.reduce((a, r) => a + r, 0) / ratios.length) * 100)
}
```

- [ ] `pnpm test` green. Commit: `Add rest-adherence helper comparing actual vs prescribed rest`

### Task 3.2 — Server path for session RPE

- [ ] `lib/types/log.ts` `WorkoutSession` — add `sessionRpe?: number | null`.
- [ ] `lib/data/repository.ts` — add `setSessionRpe(userId: string, workoutSessionId: string, rpe: number): Promise<void>` to the Workout Logging section.
- [ ] `lib/data/postgres/adapter.ts` — implement:

```ts
  async setSessionRpe(userId: string, workoutSessionId: string, rpe: number): Promise<void> {
    await this.db.update(s.workoutSessions)
      .set({ sessionRpe: rpe, updatedAt: new Date() })
      .where(and(eq(s.workoutSessions.id, workoutSessionId), eq(s.workoutSessions.userId, userId)))
  }
```

  Also add `sessionRpe` wherever `WorkoutSession` rows are mapped from DB rows (TypeScript optional field — extend the mappers that already list `isEarlyDeload`/`wasOverride` so trend queries can read it).
- [ ] New route `app/api/workout-sessions/rpe/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'

const Body = z.object({
  workoutSessionId: z.string().uuid(),
  sessionRpe: z.number().int().min(1).max(10),
})

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const repo = await getRepository()
  await repo.setSessionRpe(userId, parsed.data.workoutSessionId, parsed.data.sessionRpe)
  return NextResponse.json({ success: true })
}
```

- [ ] Commit: `Store one-tap session RPE on workout sessions`

### Task 3.3 — Offline path for session RPE (offline-first checklist)

- [ ] `lib/sqlite/migrations.ts` — add the `workout_sessions.session_rpe` entry to `RECONCILE_COLUMNS` (exact line in the ledger above). No version bump.
- [ ] `lib/local-store/types.ts` `LocalWorkoutSession` — add `sessionRpe: number | null`.
- [ ] `lib/local-store/index.ts` `LocalStore` interface — add `setSessionRpe(workoutSessionId: string, rpe: number): Promise<void>`.
- [ ] `lib/local-store/sqlite-backend.ts` — implement:

```ts
  async setSessionRpe(workoutSessionId: string, rpe: number): Promise<void> {
    await runSQL(
      `UPDATE workout_sessions SET session_rpe = ?, updated_at = ? WHERE id = ?`,
      [rpe, new Date().toISOString(), workoutSessionId],
    );
  }
```

  and add `session_rpe` to every place the backend reads/writes `workout_sessions` rows (the `applyDelta` workout_sessions upsert and any `getWorkoutHistory` mapping — grep `workout_sessions` in the file and extend each column list).
- [ ] `lib/local-store/sync-engine.ts`:
  - `pullDelta` workoutSessions mapping (:87) — add `sessionRpe: (r.sessionRpe as number) ?? null,`.
  - `pushMutations` needs no change (generic envelope); the confirm branch needs a `session_rpe` no-op case only if the exhaustive `else if` chain would otherwise mis-handle it — the chain simply falls through for unknown domains, which is correct here (the outbox row is deleted on confirm; no local `sync_status` flip needed because the workout_sessions row's sync state is owned by the `workout_log` domain).
- [ ] `lib/data/postgres/adapter.ts` `pushMutations` — add the server branch:

```ts
        } else if (mut.domain === 'session_rpe') {
          const p = clean as Record<string, unknown>
          if (typeof p.workoutSessionId === 'string' && typeof p.sessionRpe === 'number') {
            await this.setSessionRpe(userId, p.workoutSessionId, p.sessionRpe)
          }
          processed++
```

- [ ] Verify `getSyncDelta`'s workout_sessions query is a full-row `select()` so `session_rpe` rides the pull delta automatically (it is a plain `.select().from(s.workoutSessions)` — confirm while editing).

**Offline-first checklist for this write path:**
1. Write path: done-screen tap → `store.setSessionRpe` + `queueMutation({ domain: 'session_rpe', date: todayInTz(), payload: { workoutSessionId, sessionRpe } })` + `pushMutations` (Task 3.4).
2. Renderable locally: `session_rpe` column on local `workout_sessions` (reconcile entry).
3. Local-first reads: the done screen holds the value in state after tap; history consumers read via `getWorkoutHistory` which now maps the column.
4. Hydration: server value returns via the pull delta mapping.
5. Pull delta: covered by the `sessionRpe` mapping + `applyDelta` upsert column.
- [ ] Commit: `Wire session RPE through the local store, outbox and pull delta`

### Task 3.4 — One-tap prompt on the done screen

- [ ] `components/workout/done-screen.tsx`:
  - Add `userId?: string` to `DoneScreenProps`; pass it from `components/workout-screen.tsx` (which already receives `userId`) at the `<DoneScreen …>` call site.
  - Add state + save handler and an RPE card between the stats grid and the HR Recovery card:

```tsx
const [sessionRpe, setSessionRpe] = useState<number | null>(null);
const [rpeSaved, setRpeSaved] = useState(false);

const handleRpeTap = async (rpe: number) => {
  if (!workoutSessionId || rpeSaved) return;
  setSessionRpe(rpe);
  setRpeSaved(true);
  try {
    const store = userId ? getLocalStore(userId) : null;
    if (store) {
      await store.setSessionRpe(workoutSessionId, rpe);
      await store.queueMutation({
        userId: userId!, domain: 'session_rpe', date: todayInTz(),
        payload: { workoutSessionId, sessionRpe: rpe },
      });
      pushMutations(userId!).catch(() => {});
    } else {
      await fetch('/api/workout-sessions/rpe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutSessionId, sessionRpe: rpe }),
      });
    }
  } catch { /* keep the optimistic UI; outbox retries on device */ }
};
```

```tsx
{/* Session RPE one-tap (Foster sRPE) */}
{workoutSessionId && (
  <div className="w-full max-w-xs rounded-2xl bg-muted/40 border border-border p-4">
    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
      {rpeSaved ? `Session effort: ${sessionRpe}/10` : 'How hard was that session?'}
    </p>
    {!rpeSaved && (
      <div className="grid grid-cols-5 gap-1.5">
        {[...Array(10)].map((_, i) => (
          <button
            key={i + 1}
            type="button"
            onClick={() => handleRpeTap(i + 1)}
            className="h-10 rounded-xl text-sm font-semibold border border-border/60 text-muted-foreground hover:text-foreground transition"
          >
            {i + 1}
          </button>
        ))}
      </div>
    )}
    {!rpeSaved && (
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>Easy</span><span>Max effort</span>
      </div>
    )}
  </div>
)}
```

  (Imports: `getLocalStore` from `@/lib/local-store`, `pushMutations` from `@/lib/local-store/sync-engine`, `todayInTz` from `@/lib/date-utils` — note `todayInTz`, never `toISOString().slice(0,10)`.)
- [ ] Manual verification (`pnpm dev`, local DB): complete a short workout as the test user, tap an RPE on the done screen, confirm `psql … -c "SELECT id, session_name, session_rpe FROM workout_sessions ORDER BY started_at DESC LIMIT 1"` shows the value; reload the done screen — no crash, prompt hidden logic only depends on in-memory state (acceptable: re-tapping just overwrites the same column).
- [ ] `pnpm lint && pnpm test`; update `projectOverview.md`, changelog + version bump; PR, CI green, **ask before merging**.

---

## Phase F4 — Five trend views (`feat/health-trends`)

Views 1 and 2 need F1 (morning scales) and F3 (session RPE) data respectively — the *code* has no hard dependency (they render an empty state until data accrues), but ship F4 after F1/F3 so the cards aren't permanently empty.

### Task 4.1 — Generic correlation engine (TDD)

- [ ] Test first — `lib/health/__tests__/correlation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { bucketize, computeBaselines, pctFromBaseline, type BucketDef } from '@/lib/health/correlation'

const DEFS: BucketDef[] = [
  { label: '<6h', min: 0, max: 6 },
  { label: '6–7h', min: 6, max: 7 },
]

describe('bucketize', () => {
  it('averages y per x-bucket and drops empty buckets', () => {
    // '<6h': (2 + -4)/2 = -1.0 (count 2); '6–7h': 3.0 (count 1); x=9 falls in no bucket
    expect(bucketize([
      { x: 5.5, y: 2 }, { x: 5.0, y: -4 }, { x: 6.5, y: 3 }, { x: 9, y: 100 },
    ], DEFS)).toEqual([
      { label: '<6h', avg: -1, count: 2 },
      { label: '6–7h', avg: 3, count: 1 },
    ])
  })
  it('rounds averages to one decimal', () => {
    // (1 + 2)/3 … use 1,2,2 → 5/3 = 1.666… → 1.7
    expect(bucketize([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 2 }],
      [{ label: 'a', min: 0, max: 2 }])).toEqual([{ label: 'a', avg: 1.7, count: 3 }])
  })
})

describe('computeBaselines', () => {
  it('returns the mean per key, only for keys with enough samples', () => {
    const out = computeBaselines(new Map([
      ['Bench', [100, 102, 98]],   // mean 100, 3 samples → kept
      ['Squat', [140, 150]],       // 2 samples → dropped
    ]), 3)
    expect(out.get('Bench')).toBe(100)
    expect(out.has('Squat')).toBe(false)
  })
})

describe('pctFromBaseline', () => {
  it('computes percentage deviation', () => {
    expect(pctFromBaseline(105, 100)).toBe(5)
    expect(pctFromBaseline(95, 100)).toBe(-5)
  })
})
```

- [ ] Implement `lib/health/correlation.ts` (pure, no imports beyond types):

```ts
// Generic bucketed-correlation engine, extracted from
// app/api/sleep-performance-correlation/route.ts so all trend views share it.

export interface BucketDef { label: string; min: number; max: number } // [min, max)
export interface CorrelationBucket { label: string; avg: number; count: number }

export function bucketize(
  points: Array<{ x: number; y: number }>,
  defs: BucketDef[],
): CorrelationBucket[] {
  const acc = new Map<string, number[]>(defs.map(d => [d.label, []]))
  for (const p of points) {
    const def = defs.find(d => p.x >= d.min && p.x < d.max)
    if (def) acc.get(def.label)!.push(p.y)
  }
  return defs
    .map(d => {
      const ys = acc.get(d.label)!
      return {
        label: d.label,
        avg: ys.length ? parseFloat((ys.reduce((a, v) => a + v, 0) / ys.length).toFixed(1)) : 0,
        count: ys.length,
      }
    })
    .filter(b => b.count > 0)
}

export function computeBaselines(
  valuesByKey: Map<string, number[]>,
  minSamples = 3,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const [key, vals] of valuesByKey) {
    if (vals.length >= minSamples) out.set(key, vals.reduce((a, v) => a + v, 0) / vals.length)
  }
  return out
}

export function pctFromBaseline(value: number, baseline: number): number {
  return ((value - baseline) / baseline) * 100
}

// Best-vs-worst sentence used by every bucketed view. minCount guards noise.
export function correlationInsight(
  buckets: CorrelationBucket[],
  render: (best: CorrelationBucket, worst: CorrelationBucket) => string,
  minCount = 3,
): { insight: string; hasSufficientData: boolean } {
  const eligible = buckets.filter(b => b.count >= minCount)
  const hasSufficientData = eligible.length >= 2
  if (!hasSufficientData) return { insight: 'Not enough paired data yet.', hasSufficientData }
  const best = [...eligible].sort((a, b) => b.avg - a.avg)[0]
  const worst = [...eligible].sort((a, b) => a.avg - b.avg)[0]
  if (best.label === worst.label || Math.abs(best.avg - worst.avg) <= 1) {
    return { insight: 'No meaningful difference across buckets so far.', hasSufficientData }
  }
  return { insight: render(best, worst), hasSufficientData }
}
```

- [ ] `pnpm test` green. Commit: `Extract a generic correlation bucketing engine`

### Task 4.2 — Refactor the sleep route onto the engine (behaviour-preserving)

- [ ] Rewrite `app/api/sleep-performance-correlation/route.ts` steps 1–3 in terms of `computeBaselines` / `pctFromBaseline` / `bucketize` / `correlationInsight`, keeping `BUCKETS`, the response shape (`SleepCorrelationResponse`) and the insight wording identical. Diff the JSON output against the pre-refactor route on the local dev DB (seeded workouts + sleep) to confirm parity.
- [ ] Commit: `Reuse the correlation engine in the sleep-performance route`

### Task 4.3 — Trends API route

- [ ] Create `app/api/health-trends/route.ts` — `GET ?view=<name>`, auth + `session.user.timezone`, 90-day window (same `todayInTz`/`todayMidnightUtc` pattern as the sleep route), returning `{ view, insight, buckets, hasSufficientData }` (plus `{ series }` for the time-series view). Views:
  1. `subjective-recovery` — pairs each `day_checkins` `phase='morning'` row (needs a repo method `listDayCheckins(userId, from, to, phase)`; add it to `repository.ts` + adapter as a simple range select) with the same-day `oura_daily.readinessScore`. `x` = readiness, buckets `[<50, 50–65, 65–80, 80+]`; `y` = `perceivedRecovery` (1 best…5 worst). Insight: whether self-perception tracks the ring.
  2. `session-rpe` — no bucketing: time series of completed `workout_sessions` with `sessionRpe != null`, `series: [{ date, sessionRpe, sessionLoad }]` where `sessionLoad = sessionRpe × durationMin` (Foster). Sort ascending by date.
  3. `rest-adherence` — per completed session: compute `restAdherencePct` from `set_logs.restTimeSec` vs the prescribed `style_sets.restSec` (build a `styleId → setNumber → restSec` map from `repo.listProgressionStyles(userId)`; each `ExerciseLog` carries `styleId` and its `sets[]` carry `setNumber`/`restTimeSec`). `x` = adherence pct, buckets `[<70%, 70–90%, 90–115%, 115%+]` → `{min:0,max:70},{70,90},{90,115},{115,999}`; `y` = session-mean 1RM pct-from-baseline (reuse `computeBaselines` over per-exercise `estimated1rm`).
  4. `recovery-vs-strength` — `?metric=hrv|rhr|temp` sub-param. For each workout day, `x` = that morning's metric as pct-of-28-day-baseline (HRV/RHR from `body_metrics.hrvMs`/`restingHeartRate`; temp = `oura_daily.temperatureDeviation` in absolute °C with buckets `[<-0.2, -0.2–0.2, 0.2+]`); HRV/RHR buckets `[<-10%, -10–0%, 0–10%, 10%+]` → offset by 100 for `bucketize` (e.g. `{min:0,max:90}` etc.). `y` = 1RM pct-from-baseline, same as the sleep route.
  5. `meal-timing` — for each night: `x` = minutes between the **latest** `food_logs.loggedAt` of the prior evening and that night's `sleep_sessions.sleepStart` (skip nights with no food log within 12h before sleep), buckets `[<60, 60–120, 120–180, 180+]` minutes; `y` = `sleep_sessions.efficiency` (fallback view value: onset latency — include both `avgEfficiency` buckets and a secondary `latency` buckets array if trivial, otherwise efficiency only). Fold in the evening check-in's `lateHeavyMeal` as a secondary series only if it doesn't complicate the response — otherwise leave for a follow-up.
  - Cache: `Cache-Control: private, max-age=300, stale-while-revalidate=600` header; these are heavy reads and change at most a few times a day.
- [ ] All date strings via `todayInTz`/`toAestDay` — never `toISOString().slice(0,10)`. No session names in any logic (bucket by ids/dates only).
- [ ] Manual check on local DB: `curl -b <session-cookie> "localhost:3000/api/health-trends?view=rest-adherence"` returns buckets from the seeded workouts (seed data has restTimeSec? — if not, views legitimately return `hasSufficientData: false`; verify the empty shape).
- [ ] Commit: `Add the health-trends API with five correlation views`

### Task 4.4 — Trends section on Health > Progress

- [ ] Create `components/health/trends-section.tsx`:
  - A card titled "Trends" with a horizontally scrollable pill selector (follow the existing pill-tab markup in `health-content.tsx:778–791`) for: `Recovery calibration · Session effort · Rest discipline · Recovery vs strength · Meals vs sleep`.
  - Fetch via `cachedFetch(\`health-trends:\${view}\`, \`/api/health-trends?view=\${view}\`, TTL_MEDIUM, …)` with `readCacheSync` seed (per Batch B conventions).
  - Bucketed views render a `CorrelationBars` sub-component (same visual family as the existing `buckets` bar rendering in the sleep-performance card — locate its client card and copy the bar/label styling; axis label under bars, count as small muted text, insight sentence above). `session-rpe` renders a chart.js `Bar` time series.
  - Chart.js is **dynamic-imported** following the `HrRecoveryChart` convention (`health-content.tsx:10-13`): `const TrendChart = dynamic(() => import('./trend-chart').then(m => ({ default: m.TrendChart })), { ssr: false, loading: () => <div className="h-32 animate-pulse rounded-xl bg-muted" /> })`. Follow the dataviz skill conventions already used by existing chart cards (muted grid, no legend for single-series, tabular-nums labels).
  - Empty state: reuse the muted "Not enough paired data yet — keep logging" copy pattern.
- [ ] Wire it in: add `"trends"` to `PROGRESS_DEFAULT_ORDER` in `app/health/health-content.tsx:78` and a `case "trends": return <TrendsSection />` branch in `renderProgressSection` in `app/health/health-sections.tsx` (~:824). Keep the component itself in `components/health/` — don't grow `health-sections.tsx`.
- [ ] Manual verification (`pnpm dev`): Health tab → swipe to Progress → Trends card renders; each pill switches views without spinner-on-repeat (cache seed works); views with no data show the empty state, not a crash. Check on a 412×915 viewport (S25 Ultra).
- [ ] `pnpm lint && pnpm test`; update `projectOverview.md`, changelog + version bump; PR, CI green, **ask before merging**.

---

## Phase F5 — Data-viz consolidation (`feat/dataviz-uplift`)

Independent of F1–F4 except 5.7's signals wiring (pure addition).

### Task 5.1 — `scoreBand()` util (TDD) + threshold unification

Investigated duplication: the ≥70/≥50 vs ≥70/≥45 split appears **within the same files** — hero `bandColor` uses 50 (`app/health/readiness/readiness-content.tsx:18-20`, same in `sleep-content.tsx`/`activity-content.tsx`), contributor bars use 45 (`:51` in all three, plus `components/readiness-card.tsx:67`, `components/health/oura-section.tsx:25,117`, `app/api/readiness-score/route.ts:214`). **Decision: 50 is canonical** (matches the heroes, the High/Moderate/Low labels at `:82`, and `ai/health-insight`).

- [ ] Test — `lib/health/__tests__/score-band.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scoreBand } from '@/lib/health/score-band'

describe('scoreBand', () => {
  it('maps scores to canonical bands', () => {
    expect(scoreBand(85)).toEqual({ label: 'High', color: '#22c55e' })
    expect(scoreBand(70)).toEqual({ label: 'High', color: '#22c55e' })
    expect(scoreBand(69)).toEqual({ label: 'Moderate', color: '#f59e0b' })
    expect(scoreBand(50)).toEqual({ label: 'Moderate', color: '#f59e0b' })
    expect(scoreBand(49)).toEqual({ label: 'Low', color: '#ef4444' })
    expect(scoreBand(0)).toEqual({ label: 'Low', color: '#ef4444' })
  })
})
```

- [ ] Implement `lib/health/score-band.ts`:

```ts
// Canonical 0-100 score → band. Single source of truth for the label and color
// that were previously copy-pasted ~15× with a 45-vs-50 threshold drift.
export interface ScoreBand { label: 'High' | 'Moderate' | 'Low'; color: string }

export function scoreBand(score: number): ScoreBand {
  if (score >= 70) return { label: 'High', color: '#22c55e' }
  if (score >= 50) return { label: 'Moderate', color: '#f59e0b' }
  return { label: 'Low', color: '#ef4444' }
}
```

- [ ] Replace every listed site with `scoreBand(score).color` / `.label`: the three detail pages (`bandColor` at :18-20, ContributorBars at :51, label at :82 — largely absorbed by Task 5.3's dedupe, so do 5.3 first if convenient), `components/readiness-card.tsx:67`, `components/oura-score-chip-row.tsx:13-14`, `components/health/oura-section.tsx:25,117`, `app/api/readiness-score/route.ts:214` (45→50 — note the user-visible Moderate/Low boundary change in the changelog), `app/session-explain/components/{score-ring,contributor-bars,alternatives-card}.tsx:8`. Leave `ai/health-insight`'s server-side wording alone if it already matches (≥70/≥50).
- [ ] Commit: `Unify score band thresholds behind one scoreBand util`

### Task 5.2 — One `<Sparkline>` replacing the 4 SVG implementations

The four: `components/home/mini-sparkline.tsx` (`MiniSparkline`), `app/health/components/weight-sparkline.tsx`, `app/health/components/lean-mass-sparkline.tsx` (both polyline + dots), `SvgSparkline` inside `components/health/strength-trend-card.tsx:19` (path + gradient fill). All share the same `min-0.5/max+0.5/range/step` projection.

- [ ] Create `components/ui/sparkline.tsx`:

```tsx
'use client'

interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  color?: string
  showDots?: boolean   // WeightSparkline/LeanMassSparkline style
  fill?: boolean       // StrengthTrendCard gradient-area style
}

export function Sparkline({
  values, width = 120, height = 40, color = 'var(--color-brand)',
  showDots = false, fill = false,
}: SparklineProps) {
  if (values.length < 2) return null
  const min = Math.min(...values) - 0.5
  const max = Math.max(...values) + 0.5
  const range = max - min || 1
  const step = width / (values.length - 1)
  const pts = values.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / range) * (height * 0.8) - height * 0.1,
  }))
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const gradId = `spark-${color.replace(/[^a-z0-9]/gi, '')}`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {fill && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon
            points={`0,${height} ${line} ${width},${height}`}
            fill={`url(#${gradId})`}
          />
        </>
      )}
      <polyline
        points={line}
        fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round"
      />
      {showDots && pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} />
      ))}
    </svg>
  )
}
```

- [ ] Migrate the four call sites to `<Sparkline>` (map their data to `values: number[]` at the call site: `WeightSparkline`/`LeanMassSparkline` extract the metric series from `BodyMetaRow[]` before passing) and delete `components/home/mini-sparkline.tsx`, `app/health/components/weight-sparkline.tsx`, `app/health/components/lean-mass-sparkline.tsx`, and the inner `SvgSparkline` in `strength-trend-card.tsx`. Leave the two chart.js-based cards (`components/ui/sparkline-chart.tsx`, `components/health/trend-sparkline.tsx`) alone.
- [ ] Visual check on `pnpm dev`: home widgets, Health body tab weight/lean-mass cards, and the strength-trend card all still render their mini-charts.
- [ ] Commit: `Consolidate the four SVG sparkline implementations into one component`

### Task 5.3 — `HealthScoreDetail` dedupe of the 3 detail pages

`app/health/readiness/readiness-content.tsx`, `app/health/sleep/sleep-content.tsx`, `app/health/activity/activity-content.tsx` are structurally identical (~150 lines each: `bandColor` + `ScoreDisplay` ring + `ContributorBars` + cache/local-store seeding effect + `DetailHero` → contributors → extra cards → `TrendSparkline` → `AiInsightCard`).

- [ ] Create `components/health/health-score-detail.tsx` exporting `HealthScoreDetail` with props:

```ts
interface HealthScoreDetailProps {
  theme: 'readiness' | 'sleep' | 'activity'        // DetailHero theme / PAGE_GRADIENTS key
  title: string
  aiSection: 'readiness' | 'sleep' | 'activity'    // AiInsightCard section
  scoreField: string                                // oura_daily field for hero + sparkline
  contributorsField: string
  sparklineColor: string
  contributorsTitle: string
  extraCards?: React.ReactNode                      // temp-deviation / bedtime / stress tiles
}
```

  Move `ScoreDisplay` and `ContributorBars` (with the `title` prop variant) into it, both using `scoreBand()` from 5.1. Keep the data-fetch/seeding effect inside, parametrized by field names.
- [ ] Reduce each of the three pages to a thin wrapper (`<HealthScoreDetail theme="sleep" … extraCards={<BedtimeCard …/>} />`), keeping their page-specific extra cards as locally defined children passed in.
- [ ] Visual check: all three detail pages render identically to before (hero ring, bars, sparkline, AI card), including the local-store offline seed path.
- [ ] Commit: `Dedupe the readiness, sleep and activity detail pages into HealthScoreDetail`

### Task 5.4 — `SET_COLORS` N-hue generation

- [ ] `components/workout/utils.ts` — keep the existing constant for the first three, add a generator:

```ts
export const SET_COLORS = ["#f59e0b", "#22c55e", "#8b5cf6"] as const;

// Color for set index i. First three keep their long-standing identities; beyond
// that, golden-angle hue spacing yields visually distinct colors for any set count
// instead of the old i % 3 repetition.
export function setColor(i: number): string {
  if (i < SET_COLORS.length) return SET_COLORS[i];
  const hue = (i * 137.508) % 360;
  return `oklch(0.72 0.17 ${hue.toFixed(1)})`;
}
```

- [ ] Replace `SET_COLORS[i % SET_COLORS.length]` with `setColor(i)` at: `components/workout/timer-ring.tsx:61,72,222` and `components/workout/pip-view.tsx:58`. Leave the *separate* 6-color `SET_COLORS` in `hr-recovery-chart.tsx:20` alone (different palette, chart-local) — or rename it locally to `TRACE_COLORS` to remove the shadowing confusion (no behaviour change).
- [ ] Manual check: start a workout with a 4–5-set style — sets 4 and 5 get distinct colors on the timer ring instead of repeating amber/green.
- [ ] Commit: `Generate distinct set colors beyond the first three`

### Task 5.5 — Hypnogram: pure transform + stepped stage band (TDD)

`sleep_sessions.sleepPhase5Min` (schema.ts:308, `'1'=deep '2'=light '3'=REM '4'=awake`, one char per 5 min) is synced (`oura/sync/route.ts:222`) and currently rendered as a flat flex color strip in `components/health-metric-sheet.tsx` (`SleepHypnogram`, :106-152). Upgrade it to a true stepped hypnogram driven by a tested pure helper.

- [ ] Test — `lib/health/__tests__/hypnogram.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hypnogramSegments } from '@/lib/health/hypnogram'

describe('hypnogramSegments', () => {
  it('merges consecutive identical stages into timed segments', () => {
    // '4411' = 10 min awake then 10 min deep
    expect(hypnogramSegments('4411')).toEqual([
      { stage: 'awake', startMin: 0, durationMin: 10 },
      { stage: 'deep', startMin: 10, durationMin: 10 },
    ])
  })
  it('handles stage changes every interval and skips unknown codes', () => {
    expect(hypnogramSegments('123x2')).toEqual([
      { stage: 'deep', startMin: 0, durationMin: 5 },
      { stage: 'light', startMin: 5, durationMin: 5 },
      { stage: 'rem', startMin: 10, durationMin: 5 },
      // 'x' skipped but time still advances
      { stage: 'light', startMin: 20, durationMin: 5 },
    ])
  })
  it('returns empty for empty/null-ish input', () => {
    expect(hypnogramSegments('')).toEqual([])
  })
})
```

- [ ] Implement `lib/health/hypnogram.ts`:

```ts
// Transforms Oura's sleep_phase_5_min string ('1'=deep '2'=light '3'=REM '4'=awake,
// one char per 5 minutes) into merged, timed segments for a stepped hypnogram.
export type SleepStage = 'deep' | 'light' | 'rem' | 'awake'
export interface HypnogramSegment { stage: SleepStage; startMin: number; durationMin: number }

const STAGE_BY_CODE: Record<string, SleepStage> = { '1': 'deep', '2': 'light', '3': 'rem', '4': 'awake' }
const INTERVAL_MIN = 5

// Vertical order for the stepped band: awake on top, deep at the bottom.
export const STAGE_LEVEL: Record<SleepStage, number> = { awake: 0, rem: 1, light: 2, deep: 3 }

export function hypnogramSegments(phase5Min: string): HypnogramSegment[] {
  const segments: HypnogramSegment[] = []
  for (let i = 0; i < phase5Min.length; i++) {
    const stage = STAGE_BY_CODE[phase5Min[i]]
    if (!stage) continue
    const startMin = i * INTERVAL_MIN
    const last = segments[segments.length - 1]
    if (last && last.stage === stage && last.startMin + last.durationMin === startMin) {
      last.durationMin += INTERVAL_MIN
    } else {
      segments.push({ stage, startMin, durationMin: INTERVAL_MIN })
    }
  }
  return segments
}
```

- [ ] Rewrite `SleepHypnogram` in `components/health-metric-sheet.tsx` to use the helper: an SVG where each segment is a horizontal bar at `y = STAGE_LEVEL[stage] * rowHeight` (stepped band), x scaled by `startMin/durationMin` over total, colored by the existing `PHASE_COLORS` mapping (keep those hex values), with the existing ~4 time labels and a small stage legend (Deep/Light/REM/Awake). Keep the existing proportion-bar fallback when `sleepPhase5Min` is absent.
- [ ] Manual check: seed a local `sleep_sessions` row with a phase string (`psql … "UPDATE sleep_sessions SET sleep_phase_5_min = '444222211112222333322221111222233332222444' WHERE …"`) and verify the sleep detail sheet shows the stepped band.
- [ ] Commit: `Render a true stepped hypnogram from the 5-minute sleep phases`

### Task 5.6 — MuscleHeatmap weekly-volume tint

`components/muscle-heatmap.tsx` colors by role only (`PRIMARY/SECONDARY/INJURED` at :47-49). Weekly per-muscle set counts already exist at `app/api/weekly-muscle-sets/route.ts` (`MuscleSetsEntry { muscle, sets, target? }`), consumed by `components/health/weekly-muscle-sets-card.tsx`.

- [ ] Add an optional prop to `MuscleHeatmapProps`: `volumes?: Array<{ muscle: string; sets: number; target?: number | null }>`. When provided (and `assignments`/`muscleNames` are not), `buildBodyData` tints each muscle by completion ratio `sets / (target ?? 10)` clamped 0–1, interpolating opacity/lightness of the brand green (e.g. `color-mix`-free: precompute 5 steps `['#14532d','#166534','#16a34a','#22c55e','#4ade80']` indexed by `Math.min(4, Math.floor(ratio * 5))`; 0 sets = untinted). Reuse the existing `MUSCLE_TO_SLUG` normalization — no new muscle-name logic.
- [ ] Wire it into `components/health/weekly-muscle-sets-card.tsx`: render a compact `<MuscleHeatmap volumes={entries} compact />` beside/above the existing per-muscle bars (data is already in the card's state — no new fetch).
- [ ] Manual check: Health > Training tab — heatmap tints muscles trained this week darker with more sets; untrained muscles stay neutral.
- [ ] Commit: `Tint the muscle heatmap by weekly training volume`

### Task 5.7 — 1RM projection + plateau detector (TDD) feeding signals

Series source: `app/api/strength-trend/route.ts` already returns 90-day `history: { date, rm }[]` per exercise.

- [ ] Test — `lib/health/__tests__/strength-projection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { linearFit, projectRm } from '@/lib/health/strength-projection'

describe('linearFit', () => {
  it('fits an exact line', () => {
    const fit = linearFit([{ x: 0, y: 100 }, { x: 7, y: 102 }, { x: 14, y: 104 }])!
    expect(fit.slope).toBeCloseTo(2 / 7, 6)      // kg per day
    expect(fit.intercept).toBeCloseTo(100, 6)
  })
  it('returns null for fewer than 2 points', () => {
    expect(linearFit([{ x: 0, y: 100 }])).toBeNull()
  })
})

describe('projectRm', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 5, 1 + n)).toISOString().slice(0, 10)

  it('projects 30 days ahead from a rising series', () => {
    const out = projectRm([
      { date: day(0), rm: 100 }, { date: day(7), rm: 102 }, { date: day(14), rm: 104 },
    ])!
    // slope 2/7 kg/day → 104 + 30 × 0.285714 = 112.57
    expect(out.projectedRm).toBeCloseTo(112.57, 1)
    expect(out.slopePerWeek).toBeCloseTo(2, 3)
    expect(out.plateau).toBe(false)
  })
  it('flags a plateau on a flat series spanning 3+ weeks with 4+ points', () => {
    const out = projectRm([
      { date: day(0), rm: 100 }, { date: day(7), rm: 100.1 },
      { date: day(14), rm: 99.9 }, { date: day(21), rm: 100 },
    ])!
    // least-squares slope = -0.7/245 kg/day → -0.02 kg/week, well under 0.2%/week of 100 kg
    expect(out.slopePerWeek).toBeCloseTo(-0.02, 2)
    expect(out.plateau).toBe(true)
  })
  it('never flags a plateau on short or sparse series', () => {
    expect(projectRm([{ date: day(0), rm: 100 }, { date: day(7), rm: 100 }])?.plateau ?? false).toBe(false)
  })
})
```

- [ ] Implement `lib/health/strength-projection.ts`:

```ts
// Least-squares 1RM projection + plateau detection over a 90-day history series.
export interface RmPoint { date: string; rm: number }   // date: YYYY-MM-DD
export interface RmProjection {
  projectedRm: number     // 30 days past the last data point
  slopePerWeek: number    // kg/week
  plateau: boolean
}

export function linearFit(points: Array<{ x: number; y: number }>): { slope: number; intercept: number } | null {
  if (points.length < 2) return null
  const n = points.length
  const mx = points.reduce((a, p) => a + p.x, 0) / n
  const my = points.reduce((a, p) => a + p.y, 0) / n
  let cov = 0, varX = 0
  for (const p of points) {
    cov += (p.x - mx) * (p.y - my)
    varX += (p.x - mx) ** 2
  }
  if (varX === 0) return null
  const slope = cov / varX
  return { slope, intercept: my - slope * mx }
}

const MS_PER_DAY = 86_400_000
// Plateau: ≥4 sessions spanning ≥21 days whose fitted trend moves less than
// 0.2% of the current 1RM per week (in either direction).
const PLATEAU_MIN_POINTS = 4
const PLATEAU_MIN_SPAN_DAYS = 21
const PLATEAU_PCT_PER_WEEK = 0.002

export function projectRm(history: RmPoint[], daysAhead = 30): RmProjection | null {
  if (history.length < 2) return null
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  const t0 = Date.parse(sorted[0].date)
  const pts = sorted.map(p => ({ x: (Date.parse(p.date) - t0) / MS_PER_DAY, y: p.rm }))
  const fit = linearFit(pts)
  if (!fit) return null
  const last = pts[pts.length - 1]
  const spanDays = last.x - pts[0].x
  const slopePerWeek = fit.slope * 7
  const plateau =
    pts.length >= PLATEAU_MIN_POINTS &&
    spanDays >= PLATEAU_MIN_SPAN_DAYS &&
    Math.abs(slopePerWeek) < PLATEAU_PCT_PER_WEEK * last.y
  return {
    projectedRm: parseFloat((last.y + fit.slope * daysAhead).toFixed(2)),
    slopePerWeek: parseFloat(slopePerWeek.toFixed(3)),
    plateau,
  }
}
```

- [ ] Surface in `components/health/strength-trend-card.tsx`: per exercise with ≥4 history points, show `projectRm(history)` as a muted "→ ~113 kg in 30d" annotation, and an amber "Plateau" chip when flagged.
- [ ] Feed the stall flag into `lib/ai-periodization/signals.ts`: in the per-exercise loop (:121), build the exercise's `RmPoint[]` from `programSessions` (each session's `exercises` entries carry `estimated1rm` and the session's `startedAt` → `toAestDay`), call `projectRm`, and add `plateau: boolean` to the `exercises` entry type in `PrescriptionSignals`. Add a prompt line in `prompt.ts`'s per-exercise block: `plateau: true` → `" [1RM flat ≥3 weeks — consider a stimulus change]"`. Update signal fixtures in existing tests (`plateau: false`).
- [ ] `pnpm test` green.
- [ ] Commit: `Add 1RM projection and plateau detection to the strength trend and AI signals`

### Task 5.8 — Verify + ship

- [ ] `pnpm lint && pnpm test && pnpm build` green.
- [ ] `pnpm dev` sweep: home widgets, Health body/training/progress tabs, readiness/sleep/activity detail pages, a workout timer ring with >3 sets, sleep detail sheet hypnogram.
- [ ] Update `projectOverview.md` (tick F5 items; note hypnogram was partially pre-shipped and this task completed the stepped band + tested transform), changelog + minor version bump.
- [ ] PR (branch `feat/dataviz-uplift`), CI green, **ask before merging**.

---

## Cross-cutting rules (apply to every phase)

- **Branch/PR per phase**, kebab-case names as given; squash-merge only after the user confirms (or enables auto-merge). No direct pushes to `main`.
- **Commits**: human-sounding, why-focused, no AI attribution, no session URLs. Commit after each green task, not once per phase.
- **Dates**: every constructed date string uses `todayInTz()` / `toAestDay()` / `formatInTimeZone` — the `toISOString().slice(0,10)` pattern is forbidden.
- **No hardcoded session names** anywhere — all F3/F4 logic keys on `workout_sessions.id` / `program_sessions.id` / dates.
- **pnpm only**; if any dependency were needed (none is planned), commit `package.json` + `pnpm-lock.yaml` together.
- **Web sandbox caveat**: `getLocalStore` returns null in the dev browser, so every offline-first path (F1 sheet, F3 RPE tap) is exercised through its API fallback locally; the store + outbox path is verified by code review against the checklists above and authoritatively on the APK. Say so in each PR description.
- **Testing before merge-ask**: run the changed routes/flows on `pnpm dev` against the local Postgres (port 5433) as `test@local.dev` before presenting any phase for merge.

## Self-review notes

- **F1–F5 coverage**: F1 (Tasks 1.1–1.8: constraint verified — no new unique needed; MORNING_SCALES; sheet reusing ScaleSelector; first-open prompt via date-stamped marker; full offline wiring with the exact extension list — adapter save/get/push, zod, local types/backend/pull-mapping/reconcile; Oura prefill; signals + briefing). F2 (2.1–2.4: three typed clients + `tag` scope; `oura_tags` table; BDI stored from the already-fetched spo2 object; timeline card). F3 (3.1–3.4: `session_rpe` column confirmed absent → added in 106; one-tap done-screen prompt with full offline path; tested rest-adherence helper). F4 (4.1–4.4: engine extracted + behaviour-preserving refactor of the sleep route; the five views; one Trends section with dynamic-imported chart.js). F5 (5.1–5.8: tested hypnogram transform + stepped band; HealthScoreDetail; Sparkline + scoreBand fixing 45-vs-50; setColor N-hue; heatmap volume tint; tested projection/plateau feeding signals + prompt).
- **Migration 106 consistency**: defined once in the ledger; referenced (never redefined) by Tasks 1.1, 2.2/2.3 (oura_tags + BDI columns), 3.2/3.3 (session_rpe). It ships in the first Batch F PR.
- **Local schema consistency**: all six local columns listed once in the ledger, delivered reconcile-only (no v13/v14 conflict with Batch A); tasks 1.3 and 3.3 reference the ledger entries.
- **Offline-first checklists**: spelled out explicitly for both new write paths (Task 1.8 for the morning check-in, Task 3.3 for session RPE).
- **Placeholder scan**: no TODO/TBD/`...`-as-code remains; the two "verify while implementing" notes (exact `LocalDayCheckin` field order in 1.5; full-row `select()` in 1.2/3.3) are verification instructions, not unwritten code.

## Deliberate exclusions

- **Training-calendar year heatmap** and **`chartjs-plugin-annotation` for `HrDayChart`** (listed under F5 in `planned_upgrades.md`) — not in this batch's scope per the item list; carry them forward.
- **Workout time-of-day vs performance curve** — the "honourable mention" sixth trend view; the engine supports it, add later as a sixth `view` if wanted.
- **`sleepPhase5Min` in the local SQLite mirror** — the hypnogram renders from the server-backed sleep detail sheet (cachedFetch); making it a local-store column is Batch A's A9 direction, not F5.
- **Rest-mode exclusion from readiness/HRV baselines** — F2 stores rest-mode periods; actually excluding those windows from `signals.ts`/readiness baselines is a training-engine change belonging with Batch C's baseline work.
- **Evening `lateHeavyMeal` as a second series on the meal-timing view** — optional in Task 4.3; skipped if it complicates the response shape.
