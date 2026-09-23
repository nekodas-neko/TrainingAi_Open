# Device sweep 3 — plan

**Agent:** Device Verification · **Written:** 2026-09-23, after sweep 2 (`docs/device-sweep-2-plan.md`,
journal `docs/overview/entries/2026-09-23-device-sweep-2.md`) · **Target:** web v1.465.17, APK 1.460.4.

The phone is on **three-button navigation** (`navigation_mode` 0), so every gesture-bar or
bottom-inset verdict is left out of this pass rather than recorded as a fail. Standing permissions
are the baton's (writes undone straight after; only what a check needs).

## Rules that bind the whole pass

- Prod liveness (`/api/version` every 30 s) runs throughout. **Any response over 5 s stops the sweep.**
- **`/admin/oura-ble` stays closed.** DV-13 is still open. #1473 fixed one of the four hung routes
  (`device-metrics`' per-sample day math); `samples/summary`, `rollup-state` and `samples/pack` have
  no fix recorded. BF-10, Q-316, Q-544 and LB-5 wait for DV-13 to close.
- After any deploy mid-sweep: force-stop and restart the app, then confirm the new code is running
  before re-checking a fix.

## Stations

| # | station | entries | reads / writes | est. |
|---|---|---|---|---|
| **1** | **Shell probes** | **RV-128** tab switch: any frame with neither panel painted (`record.js --tap`, every tab pair). **RV-129** warm visits: any skeleton/pulse on a repeat visit (P6, 3 rounds × 5 tabs). **DV-12** one CPU profile (`Profiler.start` over CDP) around a single tab tap per tab, naming the dominant component. **BF-22** event listeners counted after each tab visit for ~40 visits, to find the tab whose count never falls back | read-only | 45 min |
| **2** | **RV-125 write half** | Repeat the census with **one approved write per tab between rounds**: food log + delete (Nutrition), weigh-in at today's own value (Health), supplement tick + untick. Record which endpoints do **not** refetch after a write that changes them | 3 approved writes, undone | 30 min |
| **3** | **DV-8** | Re-read the pending `set_logs` row and its `exercise_logs.workout_session_id` against local `workout_sessions` and the outbox. No write | read-only | 5 min |
| **4** | **Nutrition** | **BF-95** a swipe started at the left edge of a meal row opens the tray on the first press, and the tab does not change. **BF-61** swipe, then tap Delete **immediately** (<300 ms), from a verified-closed tray. **BF-12** log the saved meal, time log → row visible, tab away and back, and note whether `LocalStoreDeadBanner` shows; then delete. **BF-161** open the meal builder, add from saved meals, read the ingredient rows and the total against the sources, then **cancel without saving**. **BF-49** from a Home timeline row, open the detail, press back once, and check where it lands | 1 food write undone; builder cancelled | 40 min |
| **5** | **Workouts** | **Q-300** the rest-vs-plan card on the device's local path: rows, deltas and the sentence render from `getLocalStore`. **OR-118** the push:pull card at 412 px: the pattern word, the set count and the bar on one row. **Q-305** the volume-landmark band word beside the set count | read-only | 20 min |
| **6** | **Admin Exercises tab** | **BF-147** the two-line row and the sweep sheet (open, read, close; press nothing that saves) | read-only | 10 min |

Total ≈ 2 h 30 min.

## Not in this pass

| entry | why |
|---|---|
| RV-37 and every inset check | three-button navigation; needs the owner to switch back to gesture |
| BF-10, Q-316, Q-544, LB-5 | `/admin/oura-ble`: waits for DV-13 to close |
| DV-6 look, DV-11 TalkBack | owner's eyes and ears (TalkBack is an OS setting) |
| RV-124, RV-130 | now Lane O; the probes ran and what's left is filing |
| TN-25 | needs a month of lived walk data, not a sitting |
| Q-114 | closed "for now" by the owner on 2026-09-14 |
| Q-51 | the premise softened; sweep 1's RV-138 already answered it (re-place, don't build) |
| Q-168 | AI Coach follow-ups: not a device check; ask the Orchestrator about the lane tag |
| PS-7/8/9/12/16, BF-92, Q-388, Q-418, Q-545 | hardware, an APK build, or an owner decision |
