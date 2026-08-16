# Workout Screen — Confirm Before Skipping an Exercise

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The skip/next button (`SkipForwardIcon`) on the active workout screen jumps straight to
the next exercise (or ends the workout, if it's the last one) with **no confirmation** in a normal
program workout — one mistap loses the rest of the current exercise's progress. Add a confirm step,
matching the "leave workout" pattern already used elsewhere on this screen.

**Tech Stack:** Next.js 15 / React 19 / TypeScript. No DB/migration/API involved — pure client
component change.

---

## Evidence

`components/workout/active-workout-screen.tsx` has the skip button wired in two places:

- **Pre-set ("Load the bar to…") screen**, line 518-520: `onClick={onSkip}` — fires immediately,
  no confirmation, in **both** solo and normal mode. This is the exact screen in the bug report
  screenshot (the "▶|" button next to "Start Set 1").
- **Active set/rest bar**, line 699-701: `onClick={() => (soloMode ? withConfirm(onSkip) : onSkip())}`
  — only confirms in **solo mode**; in a normal program workout it also fires immediately.

`onSkip` is wired to `advance()` in `components/workout-screen.tsx:1783/896` — it discards any
in-progress set/rest state for the current exercise and moves to `currentIdx + 1` (or ends the
workout on the last exercise).

The screen already has the machinery for this: `withConfirm()` (line 152-159) opens the existing
`ConfirmDialog` (line 731-743, title "Leave this exercise?", body "Sets in progress won't be saved
if you leave now.") via `confirmCloseOpen`/`confirmActionRef`. It's currently used only for the
back-button (`onClick={() => withConfirm(onBack)}`, line 217) and, partially, for solo-mode skip.
`withConfirm` itself also gates on `timerStarted && (workoutPhase === "set" || lapTimes.length > 0)`
— on the pre-set screen `timerStarted` is false, so even routing that button through `withConfirm`
unchanged would still skip it silently.

**Root cause:** the skip button was never routed through `withConfirm` for the normal (non-solo)
flow, and the pre-set screen's skip button isn't routed through it at all.

---

## Fix

Route both skip buttons through `withConfirm(onSkip)` unconditionally (drop the `soloMode` branch),
and drop `withConfirm`'s `timerStarted` gate for the **skip** call site specifically — skipping
always discards the current exercise's set/rest progress and the current position in the workout,
which is worth confirming regardless of whether a timer has started. (The gate can stay as-is for
the back-button use, which is a separate call site — this plan only touches skip.)

Simplest shape: add a small `confirmSkip` wrapper (or a `force` param on `withConfirm`) that always
opens the dialog, and use it at both skip call sites instead of the current conditional.

### Task 1: Always confirm before skipping

**Files:**
- Modify: `components/workout/active-workout-screen.tsx`

- [ ] **Step 1:** Add a `confirmSkip = () => { confirmActionRef.current = onSkip; setConfirmCloseOpen(true); }`
  next to `withConfirm` (or extend `withConfirm` with an optional `force` arg defaulting to false,
  used only here) — it must **not** depend on `timerStarted`/`workoutPhase`/`lapTimes`, since a skip
  is worth confirming even before any set has started.
- [ ] **Step 2:** Replace line 518 `onClick={onSkip}` with `onClick={confirmSkip}`.
- [ ] **Step 3:** Replace line 699 `onClick={() => (soloMode ? withConfirm(onSkip) : onSkip())}` with
  `onClick={confirmSkip}`.
- [ ] **Step 4:** The shared `ConfirmDialog` copy ("Leave this exercise?" / "Sets in progress won't
  be saved if you leave now.") already fits the skip case as-is — no copy change needed unless it
  reads oddly once it also fires with zero sets logged (worth a quick look during manual test; if it
  does, a minor copy tweak is in scope for this same task, not a separate one).

### Task 2: Manual verification (`pnpm dev`)

- [ ] Start a normal (non-solo) program workout, open an exercise before pressing "Start Set 1", tap
  the skip icon — confirm the dialog appears; "Stay" keeps you on the exercise, "Leave" advances.
- [ ] Same check after starting Set 1 and mid-rest.
- [ ] Same check in solo-log mode (`ListIcon` variant of the button) — behaviour should be unchanged
  from today (it already confirmed once a timer had started; now it always confirms).
- [ ] Confirm skipping the **last** exercise still ends the workout correctly after confirming.

No offline-sync, cache-invalidation, or migration surface is touched — this is local UI state only.
No device-only path involved (no safe-area/gesture/native change), so no APK/on-device verification
gate applies beyond the standard `pnpm dev` pass.
