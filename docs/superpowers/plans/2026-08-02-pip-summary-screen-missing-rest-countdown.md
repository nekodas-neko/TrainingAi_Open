# PiP — Exercise-Summary Screen Shows No Rest Countdown

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the last set of an exercise, the on-screen "exercise summary" view shows a live
"Resting 99 of 114s" countdown ring (`LastSetRestTimer`). If the user backgrounds the app during
that same rest (entering Android's native Picture-in-Picture), the PiP window instead shows a
static "DONE / <exercise name> / TAP NEXT TO CONTINUE" placeholder with **no timer at all** — the
countdown silently disappears the moment the app is minimized.

**Tech Stack:** Next.js/React client only. No native/Kotlin change, no migration — the PiP window
itself is Android-native, but its *content* is the same WebView shrunk into a floating window, so
this is a pure JS/React fix. No new APK needed.

---

## Root cause

`components/workout-screen.tsx:1696-1705`:

```tsx
if (store.mode === "exercise-summary" && store.summaryData) {
  if (isPip) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-2 select-none">
        <p className="text-white/50 text-xs uppercase tracking-widest font-semibold">Done</p>
        <p className="text-white text-lg font-bold text-center px-6 leading-snug">{store.summaryData.exName}</p>
        <p className="text-white/30 text-[10px] uppercase tracking-widest">Tap Next to continue</p>
      </div>
    )
  }
  return (
    <ExerciseSummaryScreen ... />   // non-PiP path renders LastSetRestTimer, a live countdown ring
  );
}
```

The non-PiP `ExerciseSummaryScreen` renders `LastSetRestTimer` (`components/workout/last-set-rest-
timer.tsx`), which reads `lastSetRestStartMs`/`lastSetRestSec` off the Zustand store and draws a live
`RestRing`. The PiP branch above is a **static placeholder that was never wired to those fields** —
it doesn't reference `lastSetRestStartMs` at all, so the countdown simply isn't there once the app
enters PiP during this screen. This is distinct from the `mode === "active"` PiP case
(`workout-screen.tsx:1746-1758`), which already renders a real countdown ring via `PipView` — that
component takes `restStartMs={store.lastSetRestStartMs}` as a prop and is the reference
implementation for exactly this ring. The summary-screen PiP branch just never got the same
treatment.

---

## Fix

Reuse `PipView` for the exercise-summary PiP case instead of the static placeholder, configured as
an "all sets done, resting" state — same shape `LastSetRestTimer` already uses on the non-PiP
screen:

- `workoutPhase="rest"`
- `currentSet={store.sets}` (so `allSetsDone` is true inside `PipView`, which already renders a
  `"done"` phase label for that case — see `pip-view.tsx:65,112`)
- `sets={store.sets}`
- `currentRestSec={effectiveRestSec(store.lastSetRestSec)}` (same helper `LastSetRestTimer` calls)
- `restStartMs={store.lastSetRestStartMs}`
- `exerciseName={store.summaryData.exName}`

### Task 1: Route the exercise-summary PiP branch through `PipView`

**Files:**
- Modify: `components/workout-screen.tsx`

- [ ] Replace the static `<div>` placeholder at `workout-screen.tsx:1698-1704` with a `<PipView />`
  call using the props above. Import `effectiveRestSec` from `@/lib/stores/workout-store` (already
  imported/used elsewhere in this file — check before re-importing).
- [ ] `PipView` currently has no "tap next" affordance text — check whether that's needed at all in
  PiP (the PiP window's `RemoteAction` buttons, built natively in `MainActivity.buildActions()` for
  `phase: "summary"`, already provide the actual "Next" tap target — the in-window text was purely
  informational). If product wants to keep an explicit "tap Next" hint in the shrunk window, add it
  as an optional line under `PipView`'s existing labels rather than reintroducing a second
  hardcoded placeholder — small, keep it minimal.
- [ ] Confirm `PipView`'s internal 1s tick (`setInterval` in the component) is safe to mount here —
  it already is, since this is the same component/mechanism used for the `"active"` mode case
  immediately below it in the same file; no new render-cost concern.

### Task 2: Verification

- [ ] `pnpm dev` — can't exercise real PiP in a browser, but confirm `PipView` still renders
  correctly with `currentSet === sets` (the "done" label path) using existing dev tooling /
  temporarily forcing `isPip` true, or by triggering the equivalent state on the `"active"` mode PiP
  case which shares the same code path today.
- [ ] **On-device (S25 APK):** finish an exercise's last set, let the summary screen's own
  "Resting…" ring start, press Home to enter PiP **during** that rest window, confirm the PiP window
  now shows a live counting-down ring (not the old static text) and that it matches the on-screen
  ring's remaining time when returning to the app.
- [ ] Confirm the PiP "Next" `RemoteAction` button (native, unaffected by this change) still
  advances past the exercise correctly.
- [ ] Per CLAUDE.md, don't mark this Known-Issue resolved until the on-device step above actually
  ran.
