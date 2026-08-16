# Run Status-Bar Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a run is active, show live progress toward that run's actual goal — distance-so-far/target for a distance-goal run, time-remaining for a duration-goal run, or plain elapsed time for a freeform run — in the Android status-bar pill (One UI Now Bar chip), the same surface the lifting rest timer already uses.

**Architecture:** Extend the existing native "promoted ongoing notification" chip mechanism (`MainActivity.java`'s `RestChipBridge`/`postRestChip`) with a parallel `RunChipBridge` on its own notification ID/channel. A new pure `lib/running/run-chip-text.ts` module decides which of the three modes applies to a given prescription and formats the distance-mode text; a new thin JS bridge wrapper (`lib/native/run-status-chip.ts`, mirroring `lib/native/rest-timer-chip.ts`) talks to the native side. `RunActiveScreen` starts/updates/stops the chip as the run's `activity-store` state changes. Off-device (web/dev sandbox) every call no-ops, exactly like the rest chip.

**Tech Stack:** Next.js/React/TypeScript (web layer), Java (`MainActivity.java`, native Android — no Kotlin plugin needed, this extends the existing Java activity the same way the rest chip does), `androidx.core` `NotificationCompat` (already used by the rest chip).

---

## Why this shape (context for the implementer)

Two facts from the running-program code, confirmed by reading it directly, drive the whole design:

1. **Only the `density-progression` framework (the "Go further" / Endurance goal) ever sets `Prescription.distanceKm`.** Every other framework — `speed-vo2max` ("Get faster"), `zone2-base` ("Heart health"), `aerobic-recovery` ("Recovery & resilience") — sets `distanceKm: null` and only ever prescribes a `durationMin` + HR-zone target (`lib/running/frameworks/*.ts`, confirmed via `grep -n distanceKm lib/running/frameworks/*.ts`). There is no persisted numeric pace target anywhere in the schema.
2. **`RunActiveScreen` already fetches today's prescription** (`components/activity/run-active-screen.tsx:45-49`, cache key `'running-plan'`) but only uses it for the HR-zone hero — `plan?.prescription?.distanceKm`/`durationMin` are never read.

So "whatever goal you chose shows up in the pill" resolves cleanly to a two-way branch on data that already exists, no new goal-picking UI or DB field needed:

- **Distance goal** (`prescription.distanceKm != null`) → pill shows `"{soFar} / {target} km"` (+ pace), refreshed on GPS fixes.
- **Duration goal** (`prescription.durationMin != null`, `distanceKm == null` — this covers every other framework) → pill reuses the exact chronometer-countdown mechanism the rest chip already has.
- **No prescription** (freeform run, started without a plan) → pill is a plain count-up elapsed clock.

**Why a distance-mode chip re-posting periodically is *not* the same throttling problem the rest chip's chronometer design was built to avoid:** `startGpsWatcher` (`lib/activity/gps-tracking.ts:26-51`) uses `@capacitor-community/background-geolocation`, which runs its own **Android foreground service** (`backgroundMessage`/`backgroundTitle` params) to keep delivering location callbacks with the screen off. That foreground service is what keeps the whole process (including the WebView JS thread that receives the plugin's callbacks) alive during a run — unlike a plain backgrounded rest timer, which has no foreground service and is genuinely throttled. So JS-driven `nm.notify()` re-posts on each GPS fix are reliable here in a way they would not be for the rest chip.

**Pause handling:** `activity-store.ts`'s `resume()` (`lib/stores/activity-store.ts:125-128`) bumps `accumulatedPauseMs` by the paused duration. The duration-mode chip's countdown target must be anchored at `startMs + accumulatedPauseMs + durationMin*60_000` (i.e. real wall-clock finish time, which pushes out every time the run is paused) — recomputed and re-posted on every `resume()`, and the chip is cancelled entirely while paused (simpler and less misleading than a frozen or wrongly-ticking display). Same idea for elapsed mode: anchored at `startMs + accumulatedPauseMs`, count-up, recomputed on resume.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/running/run-chip-text.ts` (new) | Pure functions: decide chip mode from a `RunPrescription`, format the distance-mode text. Fully unit-testable, no native/DOM dependency. |
| `lib/native/run-status-chip.ts` (new) | Thin bridge wrapper mirroring `lib/native/rest-timer-chip.ts` — talks to `window.AndroidRunChip`, no-ops off-device, listens for the native tap-open event and routes to `/activity`. |
| `android/app/src/main/java/com/trainingai/app/MainActivity.java` (modify) | New `RunChipBridge` inner class + `postRunClockChip`/`postRunTextChip` notification builders + tap-routing extension, parallel to the existing `RestChipBridge`. |
| `components/activity/run-active-screen.tsx` (modify) | Starts/updates/stops the chip based on `activity-store` state (`isPaused`, `distanceKm`, `startMs`, `accumulatedPauseMs`) and the fetched prescription. |
| `components/more/profile-tab.tsx` (modify) | New "Run in Status Bar" preference toggle, mirroring the existing "Rest Timer in Status Bar" one. |

---

## Task 1: Pure chip-mode + text helpers

**Files:**
- Create: `lib/running/run-chip-text.ts`
- Test: `lib/running/__tests__/run-chip-text.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/running/__tests__/run-chip-text.test.ts
import { describe, it, expect } from 'vitest'
import { chooseRunChipMode, formatDistanceChipText } from '../run-chip-text'
import type { RunPrescription } from '@/components/running/prescribed-run-card'

const basePrescription: RunPrescription = {
  type: 'easy',
  durationMin: 30,
  distanceKm: null,
  targets: { zoneIds: [2], hrLowBpm: 120, hrHighBpm: 140 },
  rationale: '',
}

describe('chooseRunChipMode', () => {
  it('returns "distance" when the prescription has a distance target', () => {
    expect(chooseRunChipMode({ ...basePrescription, distanceKm: 5 })).toBe('distance')
  })

  it('returns "duration" when only a duration target is set', () => {
    expect(chooseRunChipMode(basePrescription)).toBe('duration')
  })

  it('returns "elapsed" when there is no prescription at all', () => {
    expect(chooseRunChipMode(null)).toBe('elapsed')
  })

  it('returns "elapsed" when the prescription has neither target', () => {
    expect(chooseRunChipMode({ ...basePrescription, durationMin: null, distanceKm: null })).toBe('elapsed')
  })
})

describe('formatDistanceChipText', () => {
  it('formats distance-so-far / target with pace', () => {
    expect(formatDistanceChipText(3.256, 5, '5:42 /km')).toBe('3.26 / 5.00 km · 5:42 /km')
  })

  it('omits the pace segment when pace is null', () => {
    expect(formatDistanceChipText(1.2, 5, null)).toBe('1.20 / 5.00 km')
  })

  it('appends a paused marker when paused', () => {
    expect(formatDistanceChipText(1.2, 5, null, true)).toBe('1.20 / 5.00 km (paused)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/running/__tests__/run-chip-text.test.ts`
Expected: FAIL — `Cannot find module '../run-chip-text'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/running/run-chip-text.ts
import type { RunPrescription } from '@/components/running/prescribed-run-card'

export type RunChipMode = 'distance' | 'duration' | 'elapsed'

/** Which live metric the run status-bar chip should track, derived from today's
 *  prescription (or the lack of one for a freeform run). Mirrors the actual data
 *  model: only the density-progression ("Go further") framework ever sets
 *  distanceKm — every other framework only ever sets durationMin. */
export function chooseRunChipMode(prescription: RunPrescription | null): RunChipMode {
  if (prescription?.distanceKm != null) return 'distance'
  if (prescription?.durationMin != null) return 'duration'
  return 'elapsed'
}

/** "3.26 / 5.00 km · 5:42 /km" — the distance-mode chip's static text, re-posted
 *  on each GPS fix. `paceLabel` is the already-formatted "M:SS /km" string (or
 *  null before the first pace reading exists). */
export function formatDistanceChipText(
  distanceKm: number,
  targetKm: number,
  paceLabel: string | null,
  paused = false,
): string {
  const base = `${distanceKm.toFixed(2)} / ${targetKm.toFixed(2)} km`
  const withPace = paceLabel ? `${base} · ${paceLabel}` : base
  return paused ? `${withPace} (paused)` : withPace
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/running/__tests__/run-chip-text.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/running/run-chip-text.ts lib/running/__tests__/run-chip-text.test.ts
git commit -m "feat: add pure run-chip mode/text helpers"
```

---

## Task 2: JS native bridge wrapper

**Files:**
- Create: `lib/native/run-status-chip.ts`

- [ ] **Step 1: Write the implementation**

Mirrors `lib/native/rest-timer-chip.ts` exactly in shape (bridge lookup, preference gate, no-op off-device), but with three start variants instead of one and its own preference key/tap-event name so it can be toggled independently of the rest chip.

```typescript
// lib/native/run-status-chip.ts
// Thin wrapper over the native run status-bar chip exposed by MainActivity as
// `window.AndroidRunChip` — the same "promoted ongoing notification" mechanism
// the lifting rest-timer chip uses (see lib/native/rest-timer-chip.ts), on its
// own notification slot so a run and a rest timer never fight over the pill.
//
// Off-device (web / dev sandbox) the bridge is absent and every call no-ops.

interface AndroidRunChipBridge {
  startClock: (anchorMs: string, label: string, mode: string) => void
  updateText: (label: string, text: string) => void
  stop: () => void
}

/** "duration" = counts down to a target finish instant, flips to count-up once
 *  past it (mirrors the rest chip's countdown/overtime behaviour). "elapsed" =
 *  counts up from a fixed start instant, no target, no overtime flip. */
export type RunClockMode = 'duration' | 'elapsed'

function bridge(): AndroidRunChipBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { AndroidRunChip?: AndroidRunChipBridge }).AndroidRunChip
}

// Default on — the user can disable it from the Preferences section in Profile.
const PREF_KEY = 'ta_pref_run_chip'

function chipEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(PREF_KEY) !== 'false'
}

/** Duration/elapsed clock chip. `anchorMs` is the count-down finish instant for
 *  "duration" mode, or the count-up base instant for "elapsed" mode. */
export function startRunClockChip(anchorMs: number, label: string, mode: RunClockMode): void {
  const b = bridge()
  if (!b || !chipEnabled()) return
  try {
    b.startClock(String(Math.round(anchorMs)), label, mode)
  } catch {
    /* bridge shape mismatch — ignore */
  }
}

/** Distance-mode static-text chip — re-post on each GPS fix / distance update. */
export function updateRunTextChip(label: string, text: string): void {
  const b = bridge()
  if (!b || !chipEnabled()) return
  try {
    b.updateText(label, text)
  } catch {
    /* ignore */
  }
}

/** Clear the chip (run finished, left, or paused). Always attempts, regardless
 *  of the preference, so a lingering chip is cleared even if the user just
 *  toggled the feature off mid-run. */
export function stopRunChip(): void {
  const b = bridge()
  if (!b) return
  try {
    b.stop()
  } catch {
    /* ignore */
  }
}

// The native tap PendingIntent brings the app to the front and dispatches this
// event. Registered once at module load; a no-op on web where it never fires.
if (typeof window !== 'undefined') {
  window.addEventListener('runChipOpen', () => {
    if (!window.location.pathname.startsWith('/activity')) {
      window.location.assign('/activity')
    }
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/native/run-status-chip.ts
git commit -m "feat: add the run status-chip JS bridge wrapper"
```

(No automated test here — this file is pure DOM/bridge glue with everything
meaningful already covered by Task 1's pure helpers; it no-ops in the vitest/jsdom
environment the same way `rest-timer-chip.ts` does, which has no test file either.)

---

## Task 3: Native Android chip

**Files:**
- Modify: `android/app/src/main/java/com/trainingai/app/MainActivity.java`

This task is **native Kotlin/Java, compile-gated only in this sandbox** (no Android SDK here) and **requires an owner APK rebuild** to actually run on-device — per `CLAUDE.md`'s Oura-BLE-operations native-change rule, flag this explicitly in the PR and in `projectOverview.md`'s Known Issues, same as every other native-only change this session.

- [ ] **Step 1: Add constants next to the existing rest-chip ones**

Insert immediately after the existing `WARMUP_COLOR` constant (around line 187 — search for `private static final int WARMUP_COLOR`):

```java
    // Run status chip — its own notification ID/channel so a live run and a
    // lifting rest timer (a different screen, but could theoretically overlap
    // if the user leaves a workout mid-rest and starts a run) never collide.
    private static final int RUN_CHIP_ID = 4200;
    private static final String RUN_CHANNEL_ID = "run-status";
    // Same zombie-safety rationale as REST_CHIP_SAFETY_MS.
    private static final long RUN_CHIP_SAFETY_MS = 4L * 60L * 60L * 1000L;

    // Run-chip live state — mirrors the rest-chip fields above.
    private volatile boolean runChipActive = false;
    private volatile String runChipLabel = "Run";
    private volatile long runChipFinishAt = 0L;
    private volatile boolean runChipCountDown = false;
    private final Handler runHandler = new Handler(Looper.getMainLooper());
    // Fires at a duration-mode chip's target instant to flip it to a count-up
    // "over target" state, mirroring restOvertimeRunnable.
    private final Runnable runOvertimeRunnable = () -> {
        if (runChipActive && runChipCountDown) postRunClockNotification(true);
    };
```

- [ ] **Step 2: Add the `RunChipBridge` inner class, immediately after `RestChipBridge`'s closing brace (around line 231)**

```java
    private class RunChipBridge {
        // mode: "duration" = counts down to anchorMs, flips to count-up once past it;
        // "elapsed" = counts up from anchorMs (a fixed past instant), no target, no flip.
        @JavascriptInterface
        public void startClock(String anchorMs, String label, String mode) {
            final long anchor;
            try {
                anchor = Long.parseLong(anchorMs);
            } catch (NumberFormatException e) {
                return;
            }
            runHandler.removeCallbacks(runOvertimeRunnable);
            runChipLabel = (label == null || label.isEmpty()) ? "Run" : label;
            runChipFinishAt = anchor;
            runChipCountDown = "duration".equals(mode);
            runChipActive = true;

            if (runChipCountDown) {
                long remainingMs = anchor - System.currentTimeMillis();
                if (remainingMs > 0) {
                    postRunClockNotification(false);
                    runHandler.postDelayed(runOvertimeRunnable, remainingMs);
                } else {
                    postRunClockNotification(true);
                }
            } else {
                postRunClockNotification(false);
            }
        }

        // Distance-mode static-text chip — re-posted by JS on each GPS fix.
        @JavascriptInterface
        public void updateText(String label, String text) {
            runHandler.removeCallbacks(runOvertimeRunnable);
            runChipCountDown = false;
            runChipActive = true;
            postRunTextNotification(
                (label == null || label.isEmpty()) ? "Run" : label,
                text == null ? "" : text);
        }

        @JavascriptInterface
        public void stop() {
            runChipActive = false;
            runHandler.removeCallbacks(runOvertimeRunnable);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(RUN_CHIP_ID);
        }
    }
```

- [ ] **Step 3: Add the two notification builders, immediately after `postRestNotification` (around line 329)**

```java
    private NotificationChannel runChannel(NotificationManager nm) {
        NotificationChannel channel =
            new NotificationChannel(RUN_CHANNEL_ID, "Run status", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
        return channel;
    }

    private PendingIntent runTapIntent() {
        Intent tap = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .putExtra("open", "activity")
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return PendingIntent.getActivity(
            this, 43, tap, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // Duration/elapsed clock chip — counts down to runChipFinishAt (duration mode,
    // then flips to count up once past it) or counts up from runChipFinishAt
    // (elapsed mode, no target). Same chronometer mechanism as the rest chip.
    private void postRunClockNotification(boolean overtime) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        runChannel(nm);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, RUN_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(runChipLabel)
            .setContentText(overtime ? "Past target — still going" : "In progress")
            .setContentIntent(runTapIntent())
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(runChipFinishAt)
            .setUsesChronometer(true)
            .setChronometerCountDown(runChipCountDown && !overtime)
            .setTimeoutAfter(RUN_CHIP_SAFETY_MS)
            .setRequestPromotedOngoing(true);

        if (overtime) builder.setColor(OVERTIME_COLOR);

        nm.notify(RUN_CHIP_ID, builder.build());
    }

    // Distance-mode chip — arbitrary static text (no chronometer), re-posted by
    // JS whenever distanceKm/pace change meaningfully.
    private void postRunTextNotification(String label, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        runChannel(nm);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, RUN_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(label)
            .setContentText(text)
            .setContentIntent(runTapIntent())
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setTimeoutAfter(RUN_CHIP_SAFETY_MS)
            .setRequestPromotedOngoing(true);

        nm.notify(RUN_CHIP_ID, builder.build());
    }
```

- [ ] **Step 4: Register the bridge in `onCreate`, immediately after the existing `AndroidRestChip` registration (around line 357)**

```java
        getBridge().getWebView().addJavascriptInterface(new RunChipBridge(), "AndroidRunChip");
```

- [ ] **Step 5: Extend `handleOpenIntent` to route a run-chip tap to `/activity`**

Find `handleOpenIntent` (around line 333-339). Replace it:

```java
    private void handleOpenIntent(Intent intent) {
        if (intent == null) return;
        String open = intent.getStringExtra("open");
        if ("workout".equals(open)) {
            getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('restChipOpen'))", null)
            );
        } else if ("activity".equals(open)) {
            getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('runChipOpen'))", null)
            );
        }
    }
```

- [ ] **Step 6: Compile-check (sandbox can only check this, not run it)**

Run: `cd android && ./gradlew compileDebugJavaWithJavac 2>&1 | tail -40` if a JDK/Gradle is available in-session; if Gradle download is proxy-blocked (expected per `CLAUDE.md`), do a careful manual read-through instead — brace matching, that every `@JavascriptInterface` method signature matches what Task 2's JS calls, and that no existing rest-chip code was disturbed. State plainly in the PR which of these two you did.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/trainingai/app/MainActivity.java
git commit -m "feat: add the native run status-chip (RunChipBridge)"
```

---

## Task 4: Wire the chip into `RunActiveScreen`

**Files:**
- Modify: `components/activity/run-active-screen.tsx`

- [ ] **Step 1: Add the imports**

At the top of `components/activity/run-active-screen.tsx`, alongside the existing imports:

```typescript
import { chooseRunChipMode, formatDistanceChipText } from '@/lib/running/run-chip-text'
import { startRunClockChip, updateRunTextChip, stopRunChip } from '@/lib/native/run-status-chip'
```

- [ ] **Step 2: Add the chip-lifecycle effect**

Insert this new block **after `paceLabel` is computed** (after the `const paceLabel = ... : '--:-- /km'` statement, around line 84 — NOT right after the GPS-watcher effect, since these effects reference `paceLabel` by closure and it must already be declared earlier in the component body). It reads `plan?.prescription`, `isPaused`, `startMs`, `accumulatedPauseMs`, `distanceKm`, `paceLabel` — all already destructured/computed above in the component — and drives the three chip modes:

```typescript
  const prescription = plan?.prescription ?? null
  const chipMode = useMemo(() => chooseRunChipMode(prescription), [prescription])

  // Duration/elapsed clock chip — (re)anchored whenever the run pauses/resumes,
  // since accumulatedPauseMs shifts the target finish instant forward.
  useEffect(() => {
    if (chipMode === 'distance') return
    if (isPaused || startMs == null) {
      stopRunChip()
      return
    }
    if (chipMode === 'duration' && prescription?.durationMin != null) {
      const anchorMs = startMs + accumulatedPauseMs + prescription.durationMin * 60_000
      startRunClockChip(anchorMs, title || 'Run', 'duration')
    } else {
      const anchorMs = startMs + accumulatedPauseMs
      startRunClockChip(anchorMs, title || 'Run', 'elapsed')
    }
    return () => stopRunChip()
  }, [chipMode, isPaused, startMs, accumulatedPauseMs, prescription?.durationMin, title])

  // Distance-mode text chip — re-posted whenever distance/pace/pause state changes.
  useEffect(() => {
    if (chipMode !== 'distance' || prescription?.distanceKm == null) return
    const text = formatDistanceChipText(distanceKm, prescription.distanceKm, currentPaceSecPerKm ? paceLabel : null, isPaused)
    updateRunTextChip(title || 'Run', text)
  }, [chipMode, prescription?.distanceKm, distanceKm, currentPaceSecPerKm, paceLabel, isPaused, title])

  // Always clear the chip when the screen unmounts (run finished or navigated away).
  useEffect(() => () => stopRunChip(), [])
```

- [ ] **Step 3: Add the `useMemo` import if not already present**

`useMemo` is already imported at the top of this file (line 3) — no change needed. Confirm before moving on.

- [ ] **Step 4: Type-check and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean (no new errors)

- [ ] **Step 5: Manual verification (web sandbox — the chip itself no-ops here, but confirm nothing crashes)**

Run `pnpm dev`, sign in, start a run from `/activity` (or via the cardio hub), confirm the screen still renders/updates normally with no console errors from the new effects, pause/resume, finish. This does **not** verify the actual chip (native-only) — say so explicitly in the PR, per `CLAUDE.md`'s reporting rule.

- [ ] **Step 6: Commit**

```bash
git add components/activity/run-active-screen.tsx
git commit -m "feat: drive the run status-chip from the live run screen"
```

---

## Task 5: Preferences toggle

**Files:**
- Modify: `components/more/profile-tab.tsx`

- [ ] **Step 1: Add `Route` to the lucide-react import list**

Find the import block (around line 17-21):

```typescript
import {
  Activity, Bell, Calendar, Camera, Check, ChevronDown, ChevronRight, CloudDownload, Copy, Download,
  FileDown, Loader2, LogOut,
  Palette, RefreshCw, Route, Settings, Shield, Sparkles, Timer,
} from 'lucide-react'
```

- [ ] **Step 2: Add state + load/save, mirroring `restChipEnabled` exactly**

Around line 126, right after `const [restChipEnabled, setRestChipEnabled] = useState(true)`:

```typescript
  const [runChipEnabled, setRunChipEnabled] = useState(true)
```

Around line 134-135, inside the same load effect as the rest-chip read:

```typescript
    const runChip = localStorage.getItem('ta_pref_run_chip')
    if (runChip !== null) setRunChipEnabled(runChip !== 'false')
```

Around line 165-168, right after `toggleRestChip`:

```typescript
  const toggleRunChip = (val: boolean) => {
    setRunChipEnabled(val)
    localStorage.setItem('ta_pref_run_chip', String(val))
  }
```

- [ ] **Step 3: Add the toggle row, immediately after the "Rest Timer in Status Bar" row (around line 620-631)**

```tsx
                <div className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
                      <Route className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Run in Status Bar</p>
                      <p className="text-[10px] text-muted-foreground">Live distance/time progress in the status-bar pill during a run</p>
                    </div>
                  </div>
                  <Switch checked={runChipEnabled} onCheckedChange={toggleRunChip} />
                </div>
```

- [ ] **Step 4: Type-check and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean

- [ ] **Step 5: Manual verification**

`pnpm dev`, sign in, open Profile → Preferences, confirm the new "Run in Status Bar" row renders under "Rest Timer in Status Bar", toggles, and persists across a reload (localStorage `ta_pref_run_chip`).

- [ ] **Step 6: Commit**

```bash
git add components/more/profile-tab.tsx
git commit -m "feat: add a Run in Status Bar preference toggle"
```

---

## Task 6: Full gate, version bump, session bookkeeping

- [ ] **Step 1: Full local gate**

```bash
pnpm ci:local
```

Expected: lint clean, `check-reconcile.js`/`check-push-mutations.js` OK (this feature touches neither local-SQLite reconciliation nor `pushMutations` — no offline-sync surface, the chip is pure runtime UI), `tsc --noEmit` clean, full `vitest run` green including the new `run-chip-text.test.ts`.

- [ ] **Step 2: Isolated production build**

```bash
rm -rf .next && npm run build
```

Expected: compiles successfully, no new warnings.

- [ ] **Step 3: Version bump**

Bump `package.json`'s `"version"` — patch bump (this is additive UI, not a breaking change) — and add a `lib/changelog.ts` entry:

```typescript
{
  version: "<next patch version>",
  date: "<today, YYYY-MM-DD>",
  changes: [
    "Live runs now show their progress in the Android status-bar pill — distance-so-far/target for a distance-goal run, time-remaining for a duration-goal run, or a plain elapsed clock for a freeform run. Toggle it from Profile → Preferences → Run in Status Bar.",
  ],
},
```

- [ ] **Step 4: Journal entry**

Create `docs/overview/entries/<date>-cardio-run-status-chip.md` documenting what shipped, and explicitly flag under "Not verified": **this entire feature is native-only and cannot be exercised in the web/dev sandbox** — the chip mechanism itself (`RunChipBridge`, both notification builders, tap-routing) needs an owner APK rebuild and on-device smoke test (per `CLAUDE.md`'s Canonical Runtime rule) before it can be marked device-verified. Only the JS-side wiring (screen doesn't crash, prefs toggle persists) was exercised in-sandbox.

- [ ] **Step 5: `projectOverview.md` update**

Add a Known Issues row: "### Run status-bar chip (v<version>, <date>) — native chip NOT verified on device (requires owner APK rebuild)."

- [ ] **Step 6: Backlog update**

In `docs/implementation-backlog.md`, remove this plan's queue entry (added by the docs-only PR that lands this plan) and update the "Cardiovascular system redesign" batch's item-3 blockquote to record the shipped chip (mirroring the existing pattern for prior shipped items in that batch), noting explicitly that native on-device verification is still outstanding.

- [ ] **Step 7: Commit**

```bash
git add package.json lib/changelog.ts docs/overview/entries/<date>-cardio-run-status-chip.md projectOverview.md docs/implementation-backlog.md
git commit -m "chore: version bump, journal entry and backlog update for the run status chip"
```

---

## Explicit non-goals (out of scope for this plan)

- **No new goal-picking UI.** `PlanSetupSheet` already asks for a goal (Speed/Endurance/Heart health/Recovery) and a session-length baseline (fixed vs. growing minutes) — this plan only makes the pill reflect what's already chosen there. Do not add a "pick pace vs distance vs time" control; it would duplicate the existing goal picker.
- **No pace-target concept.** No framework persists a numeric pace target today (confirmed by reading every file in `lib/running/frameworks/`) — "speed" work is duration + HR-zone effort, not a pace number. Do not invent a pace-target field to satisfy this plan; the duration-mode chip already covers every non-distance goal correctly.
- **Guided walk's own chip (`docs/implementation-backlog.md`'s Phase D, `feat/guided-walk-android-chip`) is a separate, already-queued item** for interval phase/countdown display — this plan does not touch it, though a future session could consider sharing the `RunChipBridge` pattern once both exist.
