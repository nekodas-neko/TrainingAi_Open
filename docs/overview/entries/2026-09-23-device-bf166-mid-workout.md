# 2026-09-23 — BF-166 verified in full on the S25, and the leave-workout prompt's *Leave* does not leave

**Branch:** `device/bf166-mid-workout` · **Agent:** Device Verification · **Docs only.**

Second sitting of the day, after #1417. The owner switched the phone to gesture navigation and OK'd
starting a workout on his account for BF-166's last check, on condition it was deleted afterwards.

**What I was on:** S25 Ultra, Android 16, APK 1.460.4, web v1.465.4, portrait, **gesture navigation**
(`navigation_mode` 2 — `probe.js` now reads a **15px** bottom inset, against 48px under three-button),
system back via `adb shell input keyevent 4`, route from `location.pathname`.

## BF-166 — ✅ VERIFIED ON THE S25, and it leaves the queue

Workout → *Start Workout* → session screen → *Start Workout* → countdown → store `mode: "warmup"`:

| step | result |
|---|---|
| back | *"Leave workout?"* raised, route unchanged |
| back again, prompt open | prompt **stays** — the ordering the listener's comment requires |
| *Stay* | prompt closes, still `warmup` |
| back, then *Leave* | store resets to `pre` — and see DV-2 |

With the first sitting's sheet checks (#1417) that is every part of the entry's `Keep:`. Its
Known-Issues row moved to `known-issues-resolved.md`.

## DV-2 — ❌ *Leave* keeps you on the abandoned session's screen

`onLeave` resets the store and calls `history.back()`, but the dialog pushed its own surface entry
when it opened and only **one** pop happens, so the back meant to leave the screen is spent on that
entry. Traced twice with `history` instrumented. BF-165's mechanism in a dialog instead of a sheet,
so it is batched with BF-165 (`back-gesture-sitting`, Lane B). The walk and activity leave dialogs
carry the same `onLeave` and were not device-checked.

## Production data — nothing to delete

Starting a workout is a store-only action; the server hears about a workout only when a set is
logged (`workout_log`) or it completes (`complete_workout`). A `fetch` wrapper logged every non-GET
for the whole test: the only one was `POST /api/ai-periodization/session/<id>/prescribe`, which
opening any session screen sends. `GET /api/workout-sessions/day?date=2026-09-23` returned
`sessions: []` afterwards. Side effect worth knowing: *Start* also calls `cancelWorkoutReminder()`
three times over this test; `reconcileWorkoutReminder` re-arms today's reminder on its next pass.

## Also

- **Node upgraded on the device machine** to 22.23.2 (winget `OpenJS.NodeJS.22`), at the owner's
  instruction; `pnpm exec vitest run` now starts. DV-1's Node half is done here.
- **My first attempt pressed back during the start countdown**, before anything was active — back
  then correctly left the screen. Recorded in the baton so it is not mistaken for a failure again.
- PR #1411 is left for the Orchestrator to close, per the owner.

## Not exercised

The walk and activity leave dialogs, the `active` phase (only `warmup`), any set logging, landscape,
light theme, and every safe-area check (valid now, not yet run).
