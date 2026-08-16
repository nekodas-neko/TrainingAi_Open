# On-Device Anomaly Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proactively alert the user, via **on-device local notifications**, when the app's own health-anomaly signals go off — the illness radar reads `elevated`/`fever`, daytime stress has run high for the day, or readiness is Low — so a bad-recovery day surfaces as a native OS notification instead of only living on a screen the user has to open. One new `reconcileHealthAlerts`/`computeHealthAlertActions` helper, called from `sync-provider.tsx` on app-open and resume, exactly like the meal/workout/supplement reminders already do.

**Architecture:** This is **read paths only** over signals that already compute and are already fetched client-side. The reconcile reads the two aggregate responses the home screen already warms — `/api/readiness-score` (carries `illnessFlag`/`illnessScore`/`illnessAdvisory`/`illnessSuppression` **and** the readiness `score`/`label`, verified `app/api/readiness-score/route.ts:63-69,354-393`) and `/api/body-battery` (carries `stress.highMinutes`/`stress.current` once the parallel daytime-stress-wiring plan lands) — decides per anomaly type whether to fire, dedups to **once per day per type**, and schedules an immediate Capacitor `LocalNotifications` alert. No new anomaly math, no new endpoint, no new DB read, no server scheduler. The pure `computeHealthAlertActions` decides fire/skip; the thin `reconcileHealthAlerts` wrapper is the Capacitor boundary — the identical split every existing reminder uses (`lib/meal-reminders.ts`, `lib/workout-reminders.ts`, `lib/supplement-reminders.ts`).

**Tech Stack:** TypeScript, Capacitor `@capacitor/local-notifications` (already a dependency — the reminders use it), `lib/date-utils` (`todayInTz`), `localStorage` dedup map (mirrors `supplement-reminders.ts`), vitest. Client/JS only — **no Kotlin, no APK-native code, no migration, no server route.**

---

## The design decision this plan encodes (do NOT re-litigate)

**On-device local notifications, NOT a server cron / web-push.** The owner explicitly chose the offline-compatible design: client-clock-driven local notifications reconciled on app-open/resume, delivered by the native OS. This is deliberately **not** the long-parked **E6 server cron/proactive-push layer** (`docs/implementation-backlog.md` §"E6 — cron/proactive layer", lines ~1688-1693), and this plan must not introduce a server scheduler, a job queue, or a `pull_request`/webhook-driven fire path. `docs/module-map.md` §0 is explicit that the app has **no cron layer by design** — recurring work is client-clock-driven, and this feature stays inside that contract.

**What this consciously does NOT cover — parked, state it in the PR:** true "fire while the app has been closed all day and never synced" delivery needs a server that reaches the device without the WebView opening. That is the FCM-native-push endgame (the E6 gap + the unscoped "bundle the shell into the APK + native FCM push" project noted in `docs/implementation-backlog.md` and the CLAUDE.md Canonical Runtime section). This plan delivers the **offline-first 90%**: the anomaly fires the next time the app is opened or resumed that day — which, for a daily-worn-ring single user who opens the app most days, is the overwhelmingly common case. Closed-all-day-unsynced push stays deferred to that endgame.

**Branch:** `feat/on-device-anomaly-notifications` (start from freshly-fetched `main`: `git fetch origin main && git remote prune origin && git checkout -B feat/on-device-anomaly-notifications origin/main`).

## Design decisions (made in the planning session — encode, don't re-litigate)

1. **The reconcile reads the two aggregate responses the app already fetches, never the repo.** `computeHealthAlertActions` is pure and takes a plain input object; `reconcileHealthAlerts` reads `/api/readiness-score` and `/api/body-battery` via `cachedFetchToday` (both are today-envelope keys — `readiness-score` is already in `CACHE_TASKS` with `today: true`, `body-battery` is read with `cachedFetchToday` at `session-select-content.tsx`). No new fetch, no new cache key, no repo call from the client.
2. **`watch` is advisory-only — never fires.** Only `elevated`/`fever` raise an illness alert, mirroring `READINESS_SUPPRESSION.watch === 0` and the illness-signal-wiring plan's own choice. `learning`/`normal` never fire.
3. **Once per day, per anomaly type.** Dedup exactly like `supplement-reminders.ts`: a `localStorage` map keyed `alertType → 'YYYY-MM-DD'` (`todayInTz()`). A type that already fired today returns `skip`; the date key makes it re-armable tomorrow with zero cleanup. A cleared condition simply stops firing — nothing to cancel because these fire immediately, not scheduled ahead.
4. **Alerts fire immediately (`at: now + 2s`), not scheduled ahead.** These are "this already happened today" nudges, not time-of-day reminders — copy the meal reminder's `immediate` branch, not its `scheduled` branch.
5. **Precedence to avoid stacking three notifications for one bad day.** Illness (`elevated`/`fever`) is the most specific "you may be sick" signal and its advisory already says *readiness lowered*; a high-stress day is the next most specific. So: **readiness-low is suppressed when an illness OR stress alert fires the same reconcile**, and it only fires as the standalone "nothing more specific, but readiness is Low" signal. Illness and stress can both fire (different causes, different advice) — that ceiling of two is acceptable and rare. Encode the precedence inside `computeHealthAlertActions` so it's unit-tested, not in the wrapper.
6. **Thresholds come from the existing One-Formula constants, never re-declared.** The stress trigger imports `STRESS_HIGH_DAY_THRESHOLD_MIN` from `lib/health/daytime-stress.ts` (the same ~120-min threshold the deload override uses) — the notification and the deload agree by construction. Readiness "Low" comes from the response's own `label` field (which is `scoreBand(score).label`), never a re-derived threshold.
7. **User-gated by a settings toggle, defaulting ON.** A new `ta_pref_health_alerts` localStorage flag, gated in `sync-provider.tsx` as `localStorage.getItem('ta_pref_health_alerts') !== 'false'` (same idiom as `ta_pref_meal_reminders` / `ta_pref_day_review_reminders`), with a Switch row in the Preferences section of `components/more/profile-tab.tsx`. No existing toggle covers anomaly alerts, so a new one is added.

## Dependency seam — the daytime-stress-wiring plan

The stress trigger's cleanest input is `/api/body-battery`'s `stress.highMinutes` (minutes at/under the high-stress level today), which is **added by the parallel plan `docs/superpowers/plans/2026-07-16-daytime-stress-wiring.md`** (its Task 2 adds `stress.series` + `stress.highMinutes` to `BodyBatteryResponse`). To keep this plan **implementable regardless of merge order**, the trigger is written defensively:

- **Preferred:** if `stress.highMinutes != null`, fire when `stress.highMinutes >= STRESS_HIGH_DAY_THRESHOLD_MIN`.
- **Fallback (works against today's response):** else if `stress.current != null`, fire when `stress.current <= STRESS_HIGH_LEVEL` (the latest 30-min bucket is at/under the high-stress level — `stress.current` exists on `main` today, post-#575).

Both constants live in `lib/health/daytime-stress.ts` (`STRESS_HIGH_DAY_THRESHOLD_MIN` is added by the daytime-stress plan; `STRESS_HIGH_LEVEL` too). **If daytime-stress-wiring has NOT merged when this is implemented,** either implement it first (it's queued adjacent) or, as a scoped fallback, inline the two constants' values with a `TODO` referencing that plan and a one-line note in the PR — but prefer landing daytime-stress-wiring first so the import is real. Re-check both constants exist (`grep -n "STRESS_HIGH_DAY_THRESHOLD_MIN\|STRESS_HIGH_LEVEL" lib/health/daytime-stress.ts`) at implementation time.

## Shared-file seam — `sync-provider.tsx`

`components/sync-provider.tsx` is touched by several concurrent items (Oura BLE, reminders, cache warming). This plan adds **one new self-contained `useEffect`** modelled byte-for-byte on the existing supplement-reminder effect (`sync-provider.tsx:298-324`) — mount + `App` `resume` listener, native-only, its own try/catch. It does not modify any existing effect, `CACHE_TASKS`, or the pull/push flow, so the merge surface is additive and conflict-light. If a parallel PR has moved the reminder effects, re-anchor by the `reconcileSupplementReminders` effect's shape, not by line number.

## Verified current state (2026-07-16)

- **Reminder pattern to copy:** `lib/supplement-reminders.ts` is the closest shape (per-item dedup map keyed to `todayInTz()`, `immediate` = `new Date(Date.now()+2000)`, native-only guard). `lib/meal-reminders.ts:105-119` shows the `immediate` schedule + notified-map write. `lib/notifications.ts:26-43` shows a minimal `LocalNotifications.schedule` with `channelId`.
- **Notification-id ranges already claimed:** rest-complete `9001`, workout `8000`, EOD meal `9100`, meal-reminder base `9200` (+0..799), supplement base `8500` (+0..199), day-review (evening/weekly) — see `lib/day-review-reminders.ts`. Pick a fresh, non-overlapping small block for the three fixed anomaly ids (this plan uses `9300`/`9301`/`9302`).
- **Channels:** each reminder file declares its own `*_CHANNEL` string constant; there's no central channel registry — declaring `HEALTH_ALERTS_CHANNEL = 'health-alerts'` in the new file matches the convention. (Android auto-creates the channel on first schedule; the reminders rely on this — no explicit `createChannel` call exists in those files.)
- **Readiness response:** `ReadinessScoreResponse` (`app/api/readiness-score/route.ts:17-69`) — export is a named `interface`, importable client-side; carries `score`, `label: 'High'|'Moderate'|'Low'`, `readinessDisplayScore: number|null`, `hasSufficientData`, `illnessFlag`, `illnessAdvisory`, `illnessSuppression`. Warmed in `CACHE_TASKS` as `{ key: 'readiness-score', ... today: true }` (`sync-provider.tsx:47`).
- **Body-battery response:** `BodyBatteryResponse` exported from `app/api/body-battery/route.ts`; read client-side via `cachedFetchToday('body-battery', '/api/body-battery', TTL_SHORT, …)` (`session-select-content.tsx`). `stress` is `{ current, draining, extraDrained, … } | null`; `series`/`highMinutes` added by the daytime-stress-wiring plan.
- **Settings toggles:** `components/more/profile-tab.tsx` Preferences `CollapsibleContent` (`:508-573`) holds the Switch rows; `ta_pref_day_review_reminders` (`:128,149-152`) is the toggle idiom to copy. `Switch`, `Bell` (lucide) already imported.
- **Sync-provider gating idiom:** `localStorage.getItem('ta_pref_meal_reminders') !== 'false'` (`sync-provider.tsx:229`), `ta_pref_day_review_reminders` (`:249`).
- **`illnessAdvisory(flag)`** (`lib/health/illness-radar.ts:165-176`) returns the exact human copy for `fever`/`elevated`/`watch`; the response's `illnessAdvisory` field already carries it — the notification body can reuse it rather than re-authoring illness copy.

## File structure

**Create:**
- `lib/health-alerts.ts` — `computeHealthAlertActions` (pure) + `reconcileHealthAlerts` (Capacitor) + id/channel/route constants + `HealthAlertType`/`HealthAlertInput`/`HealthAlertAction` types.
- `lib/__tests__/health-alerts.test.ts` — fire/skip/dedup/precedence unit tests.

**Modify:**
- `components/sync-provider.tsx` — one new native-only `useEffect` (mount + resume), gated by `ta_pref_health_alerts`.
- `components/more/profile-tab.tsx` — `healthAlertsEnabled` state + `ta_pref_health_alerts` toggle Switch row in Preferences.
- `lib/changelog.ts` + `package.json` version, journal + `projectOverview.md` index (final task).
- `docs/implementation-backlog.md` — remove this plan's own queue entry (final task).

---

### Task 1: `computeHealthAlertActions` + `reconcileHealthAlerts` — the anomaly notification helper

**Files:**
- Create: `lib/health-alerts.ts`
- Test: `lib/__tests__/health-alerts.test.ts`

The pure decision function is the whole risk surface (fire/skip/dedup/precedence); it gets full unit coverage. The Capacitor wrapper is a mechanical copy of `reconcileSupplementReminders`.

- [ ] **Step 1: Write the failing tests** (`lib/__tests__/health-alerts.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { computeHealthAlertActions, type HealthAlertInput } from '@/lib/health-alerts'

// Neutral baseline — no anomaly on any axis.
const base: HealthAlertInput = {
  illnessFlag: 'normal',
  illnessAdvisory: null,
  readinessLabel: 'High',
  readinessHasData: true,
  stressHighMinutes: 0,
  stressCurrent: 0,
}
// Helper: pull the action for one type out of the returned array.
const forType = (input: Partial<HealthAlertInput>, notified = new Set<string>()) => {
  const acts = computeHealthAlertActions({ ...base, ...input }, notified)
  return (t: string) => acts.find(a => a.alertType === t)!
}

describe('computeHealthAlertActions', () => {
  it('fires an illness alert on fever, with fever-specific copy', () => {
    const a = forType({ illnessFlag: 'fever', illnessAdvisory: 'Skin temperature is well above your baseline — possible fever. Readiness lowered; rest and hydrate.' })('illness')
    expect(a.type).toBe('fire')
    expect(a.title).toMatch(/fever/i)
    expect(a.body).toContain('baseline')
  })

  it('fires an illness alert on elevated', () => {
    expect(forType({ illnessFlag: 'elevated', illnessAdvisory: 'x' })('illness').type).toBe('fire')
  })

  it('never fires illness on watch / normal / learning (advisory-only or no signal)', () => {
    for (const flag of ['watch', 'normal', 'learning'] as const) {
      expect(forType({ illnessFlag: flag })('illness').type).toBe('skip')
    }
  })

  it('skips an anomaly type already notified today (dedup)', () => {
    const a = forType({ illnessFlag: 'fever', illnessAdvisory: 'x' }, new Set(['illness']))('illness')
    expect(a.type).toBe('skip')
  })

  it('fires a stress alert when highMinutes crosses the shared deload threshold', () => {
    expect(forType({ stressHighMinutes: 150 })('stress').type).toBe('fire')
    expect(forType({ stressHighMinutes: 60 })('stress').type).toBe('skip')
  })

  it('falls back to stressCurrent when highMinutes is null (pre-daytime-stress-wiring response)', () => {
    expect(forType({ stressHighMinutes: null, stressCurrent: -0.8 })('stress').type).toBe('fire')
    expect(forType({ stressHighMinutes: null, stressCurrent: -0.1 })('stress').type).toBe('skip')
    // null/null → no stress signal at all → skip
    expect(forType({ stressHighMinutes: null, stressCurrent: null })('stress').type).toBe('skip')
  })

  it('fires a standalone readiness-low alert when Low and nothing more specific fired', () => {
    expect(forType({ readinessLabel: 'Low' })('readiness').type).toBe('fire')
  })

  it('suppresses readiness-low when an illness alert fires the same reconcile (precedence)', () => {
    const get = forType({ readinessLabel: 'Low', illnessFlag: 'fever', illnessAdvisory: 'x' })
    expect(get('illness').type).toBe('fire')
    expect(get('readiness').type).toBe('skip')
  })

  it('suppresses readiness-low when a stress alert fires the same reconcile (precedence)', () => {
    const get = forType({ readinessLabel: 'Low', stressHighMinutes: 150 })
    expect(get('stress').type).toBe('fire')
    expect(get('readiness').type).toBe('skip')
  })

  it('never fires readiness-low without sufficient data (chip would be hidden)', () => {
    expect(forType({ readinessLabel: 'Low', readinessHasData: false })('readiness').type).toBe('skip')
  })

  it('an all-clear day returns skip for every type', () => {
    const acts = computeHealthAlertActions(base, new Set())
    expect(acts.every(a => a.type === 'skip')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/health-alerts.test.ts`
Expected: FAIL — `@/lib/health-alerts` does not exist.

- [ ] **Step 3: Implement** (`lib/health-alerts.ts`)

```typescript
import { Capacitor } from '@capacitor/core'
import { todayInTz } from './date-utils'
import { STRESS_HIGH_DAY_THRESHOLD_MIN, STRESS_HIGH_LEVEL } from './health/daytime-stress'
import type { IllnessFlag } from './health/illness-radar'

export const HEALTH_ALERTS_CHANNEL = 'health-alerts'
export const HEALTH_ALERT_ROUTE = '/health/readiness'
const NOTIFIED_TODAY_KEY = 'ta_health_alert_notified_today'

// Fixed ids — one per anomaly type (fresh block, clear of the reminders' ranges).
export const HEALTH_ALERT_IDS = { illness: 9300, stress: 9301, readiness: 9302 } as const

export type HealthAlertType = 'illness' | 'stress' | 'readiness'

/** Plain inputs, read from /api/readiness-score + /api/body-battery. No repo, no Capacitor here. */
export interface HealthAlertInput {
  illnessFlag: IllnessFlag | null
  illnessAdvisory: string | null       // reuse the radar's own copy for the body
  readinessLabel: 'High' | 'Moderate' | 'Low' | null
  readinessHasData: boolean            // false → the chip hides itself; don't alert on it
  stressHighMinutes: number | null     // preferred (daytime-stress-wiring); null pre-merge
  stressCurrent: number | null         // fallback: latest bucket level, [-1,+1], neg = stressed
}

export type HealthAlertAction =
  | { alertType: HealthAlertType; type: 'skip' }
  | { alertType: HealthAlertType; type: 'fire'; title: string; body: string }

function illnessCopy(flag: IllnessFlag, advisory: string | null): { title: string; body: string } {
  if (flag === 'fever') {
    return { title: 'Possible fever', body: advisory ?? 'Your skin temperature is well above your baseline. Readiness is lowered — rest and hydrate today.' }
  }
  return { title: 'Recovery signals are off', body: advisory ?? 'Temperature, resting HR and HRV are drifting together against your baseline — your body may be fighting something. Take it easy today.' }
}

/**
 * Decide, per anomaly type, whether to fire a local notification. Pure. `notifiedToday` is the set
 * of types already fired today (dedup). Precedence: readiness-low is suppressed when a more specific
 * illness or stress alert fires the same pass (design decision 5).
 */
export function computeHealthAlertActions(
  input: HealthAlertInput,
  notifiedToday: Set<HealthAlertType> = new Set(),
): HealthAlertAction[] {
  const skip = (alertType: HealthAlertType): HealthAlertAction => ({ alertType, type: 'skip' })
  const fire = (alertType: HealthAlertType, title: string, body: string): HealthAlertAction =>
    notifiedToday.has(alertType) ? skip(alertType) : { alertType, type: 'fire', title, body }

  // ── Illness: elevated/fever only (watch is advisory-only) ──
  const illnessTriggered = input.illnessFlag === 'elevated' || input.illnessFlag === 'fever'
  const illness = illnessTriggered
    ? (() => { const c = illnessCopy(input.illnessFlag as IllnessFlag, input.illnessAdvisory); return fire('illness', c.title, c.body) })()
    : skip('illness')

  // ── Stress: prefer highMinutes vs the shared deload threshold, else fall back to current level ──
  const stressTriggered = input.stressHighMinutes != null
    ? input.stressHighMinutes >= STRESS_HIGH_DAY_THRESHOLD_MIN
    : input.stressCurrent != null
      ? input.stressCurrent <= STRESS_HIGH_LEVEL
      : false
  const stress = stressTriggered
    ? fire('stress', 'High stress day', 'Daytime stress has run high today. A lighter session or some recovery time may help.')
    : skip('stress')

  // ── Readiness-low: standalone only — suppressed if illness or stress fired this pass ──
  const moreSpecificFired = illness.type === 'fire' || stress.type === 'fire'
  const readinessTriggered = input.readinessHasData && input.readinessLabel === 'Low' && !moreSpecificFired
  const readiness = readinessTriggered
    ? fire('readiness', 'Readiness is low', 'Your readiness is Low today. Consider a lighter session, a deload, or a rest day.')
    : skip('readiness')

  return [illness, stress, readiness]
}

function readNotifiedToday(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_TODAY_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeNotifiedToday(map: Record<string, string>): void {
  try {
    localStorage.setItem(NOTIFIED_TODAY_KEY, JSON.stringify(map))
  } catch {}
}

/** Native-only. Reads the dedup map, computes actions, fires immediate notifications, records fires. */
export async function reconcileHealthAlerts(input: HealthAlertInput): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const today = todayInTz()
    const notifiedMap = readNotifiedToday()
    const notifiedToday = new Set(
      Object.entries(notifiedMap).filter(([, date]) => date === today).map(([type]) => type as HealthAlertType),
    )
    const actions = computeHealthAlertActions(input, notifiedToday)

    for (const action of actions) {
      if (action.type === 'skip') continue
      await LocalNotifications.schedule({
        notifications: [{
          id: HEALTH_ALERT_IDS[action.alertType],
          title: action.title,
          body: action.body,
          schedule: { at: new Date(Date.now() + 2000) },
          channelId: HEALTH_ALERTS_CHANNEL,
          extra: { route: HEALTH_ALERT_ROUTE },
        }],
      })
      notifiedMap[action.alertType] = today
    }
    writeNotifiedToday(notifiedMap)
  } catch {}
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/__tests__/health-alerts.test.ts`
Expected: PASS (11 cases). If the two `daytime-stress` constants aren't yet on `main`, see the Dependency-seam section — land that plan first or inline the values with a TODO.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "health-alerts" || echo clean`
Expected: `clean`

```bash
git add lib/health-alerts.ts lib/__tests__/health-alerts.test.ts
git commit -m "Add health-alert computation + reconcile for on-device anomaly notifications"
```

---

### Task 2: Wire the reconcile into `sync-provider.tsx`

**Files:**
- Modify: `components/sync-provider.tsx`

Add one self-contained native-only `useEffect` modelled on the supplement-reminder effect (`:298-324`) — mount + `App` `resume`, gated by the new preference. Reads the two today-envelope responses the app already warms; passes them into `reconcileHealthAlerts`. Do **not** modify any existing effect or `CACHE_TASKS`.

- [ ] **Step 1: Add the imports** (top of file, next to the other reminder imports)

```typescript
import { reconcileHealthAlerts } from '@/lib/health-alerts';
import type { ReadinessScoreResponse } from '@/app/api/readiness-score/route';
import type { BodyBatteryResponse } from '@/app/api/body-battery/route';
```

`TTL_SHORT` may need adding to the `cache-ttl` import if not already present (body-battery is read with `TTL_SHORT` elsewhere — reuse the same key/TTL). Verify the existing `cache-ttl` import line and extend it rather than duplicating.

- [ ] **Step 2: Add the effect** (after the supplement-reminder `useEffect`, before the step-counting effect)

```typescript
  // Reconcile health-anomaly alerts on app open and on resume. Reads the two aggregate
  // responses the home screen already warms (readiness-score, body-battery — both today
  // envelopes) and fires an on-device notification for illness/stress/low-readiness, once
  // per day per type. Gated by the anomaly-alerts preference (default on). Native-only:
  // LocalNotifications no-ops in the web sandbox, so this whole path is APK-verified only.
  useEffect(() => {
    let handle: { remove: () => void } | undefined;

    async function reconcile() {
      if (localStorage.getItem('ta_pref_health_alerts') === 'false') return;
      try {
        const box: { readiness: ReadinessScoreResponse | null; battery: BodyBatteryResponse | null } = {
          readiness: null, battery: null,
        };
        await Promise.all([
          cachedFetchToday<ReadinessScoreResponse>('readiness-score', '/api/readiness-score', READINESS_SCORE_TTL, d => { box.readiness = d; }),
          cachedFetchToday<BodyBatteryResponse>('body-battery', '/api/body-battery', TTL_SHORT, d => { box.battery = d; }),
        ]);
        if (!box.readiness) return; // no readiness data yet — nothing to alert on
        const stress = box.battery?.stress ?? null;
        await reconcileHealthAlerts({
          illnessFlag: box.readiness.illnessFlag,
          illnessAdvisory: box.readiness.illnessAdvisory,
          readinessLabel: box.readiness.readinessDisplayScore != null ? box.readiness.label : null,
          readinessHasData: box.readiness.hasSufficientData,
          // `highMinutes` exists once daytime-stress-wiring lands; optional-chained so a
          // pre-deploy cached seed (or that plan not yet merged) degrades to the current fallback.
          stressHighMinutes: (stress as { highMinutes?: number | null } | null)?.highMinutes ?? null,
          stressCurrent: stress?.current ?? null,
        });
      } catch {
        // Network/cache unavailable — skip, will retry on next open/resume
      }
    }

    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      reconcile();
      const { App } = await import('@capacitor/app');
      handle = await App.addListener('resume', reconcile);
    })();

    return () => { handle?.remove(); };
  }, []);
```

Note: `readinessLabel` is passed `null` when `readinessDisplayScore` is null (the chip hides itself in that state — don't alert on a score the user can't see), which combined with `readinessHasData` double-guards the readiness alert.

- [ ] **Step 3: Typecheck + lint + commit**

Run: `npx tsc --noEmit 2>&1 | grep "sync-provider" || echo clean` and `npx eslint components/sync-provider.tsx`
Expected: `clean` / no errors.

```bash
git add components/sync-provider.tsx
git commit -m "Reconcile health-anomaly alerts on app open and resume"
```

---

### Task 3: Settings toggle — anomaly alerts on/off

**Files:**
- Modify: `components/more/profile-tab.tsx`

A new `ta_pref_health_alerts` toggle in the Preferences section, defaulting on, identical in shape to the Day & Week Review Reminders row (`:549-560`).

- [ ] **Step 1: State + load** — beside `dayReviewRemindersEnabled` (`:122`):

```typescript
  const [healthAlertsEnabled, setHealthAlertsEnabled] = useState(true)
```

In the same `useEffect` that reads `ta_pref_day_review_reminders` (`:127-132`), add:

```typescript
    const alerts = localStorage.getItem('ta_pref_health_alerts')
    if (alerts !== null) setHealthAlertsEnabled(alerts !== 'false')
```

- [ ] **Step 2: Toggle handler** — beside `toggleDayReviewReminders` (`:149-152`):

```typescript
  const toggleHealthAlerts = (val: boolean) => {
    setHealthAlertsEnabled(val)
    localStorage.setItem('ta_pref_health_alerts', String(val))
  }
```

- [ ] **Step 3: Switch row** — inside the Preferences `CollapsibleContent`, after the Day & Week Review Reminders row (`:560`), copy that row's markup with:
  - icon: `Bell` (already imported; or `HeartPulse`/`Activity` if you prefer a distinct glyph — check it's imported before using; `Bell` is the safe reuse)
  - title: `Health Alerts`
  - subtitle: `Notify me when illness, stress, or low readiness is detected`
  - `<Switch checked={healthAlertsEnabled} onCheckedChange={toggleHealthAlerts} />`

```tsx
                <div className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
                      <Bell className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Health Alerts</p>
                      <p className="text-[10px] text-muted-foreground">Notify me when illness, stress, or low readiness is detected</p>
                    </div>
                  </div>
                  <Switch checked={healthAlertsEnabled} onCheckedChange={toggleHealthAlerts} />
                </div>
```

- [ ] **Step 4: Lint + typecheck + commit**

Run: `npx eslint components/more/profile-tab.tsx && npx tsc --noEmit 2>&1 | head -5`
Expected: clean.

```bash
git add components/more/profile-tab.tsx
git commit -m "Add Health Alerts settings toggle"
```

---

### Task Final: Gate + dev-server smoke + version/docs

- [ ] **Step 1: Full gate**

Run: `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`
Expected: all green (the new `health-alerts.test.ts` runs with the suite).

- [ ] **Step 2: Dev-server smoke against the local DB** (`pnpm dev`, log in as `test@local.dev` / `testpass123`)

**The notification delivery itself is NOT verifiable in the sandbox** — `Capacitor.isNativePlatform()` is false in the browser, so `reconcileHealthAlerts` returns immediately. What the dev server *can* verify:

1. **The two source responses carry the fields the reconcile reads.** Seed a fever night (reuse the illness-signal-wiring plan's `oura_daily_summary` +4σ seed — two rows so the prior is the baseline) and confirm `GET /api/readiness-score` returns `illnessFlag: "fever"`, `illnessAdvisory` non-null, `hasSufficientData: true`, and a `label`/`readinessDisplayScore`. Confirm `GET /api/body-battery` returns `stress` (or `null` when there's no daytime signal — the fallback path handles both).
2. **The pure decision function** is covered by the Task-1 unit tests (fire/skip/dedup/precedence/fallback) — the real logic gate.
3. **The settings toggle** persists: flip Health Alerts in More → Preferences, reload, confirm the Switch state survives (localStorage `ta_pref_health_alerts`), and that setting it off makes `reconcile()` early-return (add a temporary `console.log` if you want to observe, then remove).

Because the native path can't run in the sandbox, **the on-device smoke is the real gate** — this change is offline-first/native/notification behaviour, so per the Canonical Runtime rule it needs the S25 APK smoke run OR a Known-Issues row marking it not-yet-device-verified.

- [ ] **Step 3: On-device verification (S25 APK) or Known-Issues row**

Run `docs/device-smoke-checklist.md`'s notification path on the S25:
- With a real fever/elevated illness flag (or temporarily seed one and sync), open the app → a "Possible fever"/"Recovery signals are off" notification appears within ~2s, tapping it opens `/health/readiness`.
- Re-open/resume the app the same day → **no** duplicate notification (dedup).
- Toggle Health Alerts off → open the app → no notification fires.
- Roll to the next day (or clear `ta_health_alert_notified_today`) → the alert can fire again.

If no device is available in-session, add a Known-Issues row to `projectOverview.md`: *"On-device anomaly notifications (illness/stress/low-readiness local notifications) shipped but NOT yet device-verified — Capacitor LocalNotifications no-ops in the web sandbox; logic is unit-tested, native delivery/dedup unconfirmed on the S25."*

- [ ] **Step 4: Version + changelog + journal + index**

Bump `package.json` **minor** (user-visible: new notifications + settings toggle). `lib/changelog.ts` entry: *"Your phone now nudges you when the app spots a bad-recovery day: if the illness radar flags a possible fever or elevated signals, if daytime stress has run high, or if your readiness is Low, you get an on-device notification (once per day, and only for the most relevant signal). Toggle it under More → Preferences → Health Alerts."* Append the session note to the current `docs/overview/history-*.md`, update `projectOverview.md` (current status + the not-yet-device-verified Known-Issues row if the APK smoke was skipped), and **remove this plan's entry from `docs/implementation-backlog.md`** — all on this branch before merge.

- [ ] **Step 5: Push + PR**

```bash
git push -u origin feat/on-device-anomaly-notifications
```

Standard change (no migration, no auth/security, no data-dropping anything, no secret surface) — merge on green per the CI/CD workflow. State in the PR body which surfaces were **not** exercised: native LocalNotifications delivery + dedup + tap-routing (web sandbox no-ops the plugin), Samsung WebView, and the daytime-stress `highMinutes` field if that plan hadn't merged yet (fallback path used).

---

## Verification summary

- **Automated (sandbox):** `computeHealthAlertActions` fire/skip/dedup/precedence/fallback (11 cases); full existing suites still green; full gate (`lint`/`tsc`/`test`/`build`).
- **Dev-server (sandbox):** the two source responses carry the read fields against a seeded fever night; the settings toggle persists and gates the reconcile early-return.
- **Deferred to on-device (S25 APK):** actual notification delivery, the once-per-day dedup across resumes, tap-through routing, and the Health Alerts toggle suppressing delivery — none run in the web sandbox because `LocalNotifications` no-ops off-native. Gate = the device smoke run or a Known-Issues row.
- **Deferred to the FCM endgame (parked):** true closed-app-while-unsynced push — out of scope by design (this is the on-device, offline-compatible choice).

## Notes for the implementer

- **Do NOT add a server scheduler, cron, job queue, or webhook fire path.** The whole point of this design is that it stays inside the app's no-cron, client-clock-driven contract (`docs/module-map.md` §0). Server-side proactive push is the parked E6/FCM project.
- **Never re-derive anomaly math.** The reconcile reads `illnessFlag`/`label`/`stress.highMinutes` off already-computed responses. If you find yourself importing `computeIllnessRadar`, `computeReadinessComposite`, or `summarizeStressDay` into the client, stop — those belong to the routes.
- **Thresholds import from `lib/health/daytime-stress.ts`** (`STRESS_HIGH_DAY_THRESHOLD_MIN`, `STRESS_HIGH_LEVEL`) and the readiness band from the response's own `label` — never re-declare a 120 / −0.5 / 70 / 50 literal locally.
- **Keep the reconcile effect self-contained** — its own `useEffect`, native-only, own try/catch, no edits to existing effects or `CACHE_TASKS`. `sync-provider.tsx` is a hot merge file; additive is conflict-light.
- **The dedup map is date-keyed** — no cleanup logic needed, day rollover re-arms every type automatically (copy `supplement-reminders.ts`, don't invent a TTL).
- If line numbers here have drifted (the repo moves fast), re-anchor by symbol name — the `reconcileSupplementReminders` effect for the wiring, the `toggleDayReviewReminders` row for the toggle.
</content>
</invoke>
