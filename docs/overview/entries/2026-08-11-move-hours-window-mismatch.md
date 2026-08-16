# 2026-08-11 — move-hours counted a 24-hour day against a 15-hour goal (Q-188)

**Branch:** `fix/move-hours-window-mismatch` · **Domain:** `activity`, `readiness` · **v1.285.0**

`computeMovedHours` counted any hour in **0–23** with movement. `moveHoursGoal()` divides by
`sleepHour − wakeHour` — **waking hours**, 15 by default. Numerator and denominator measured
different windows, so the ratio was structurally ≥ 1 and the contributor (weight **12**) pinned at
**100 regardless of what the goal was set to**.

## Why this was nearly mis-fixed

Q-137 recorded it as *"move-hours goal **15** against 19–24 actual"* and proposed **raising the
goal**. That reading is what makes the bug invisible: 19–24 is not a number anyone can score against
a 15-hour denominator, and no goal value would have fixed it. Raising the goal would have moved the
saturation without removing it.

Same shape as Q-183's `zoneMinutes` structural zero, inverted — one scored a structural 0 as a
failure, this scored a structural ≥100 as a success. Neither was about the user's behaviour.

## The fix, and how small it was

`wakeHour` and `sleepHour` were **already declared on `HourlyMovementInput`** and simply never read:
`computeMovedHours` destructured `{ hrRows, maxHr, restingHr, tz, dateIso }` and stopped there. The
interface had anticipated the window; the implementation ignored it.

Now it destructures them with the same defaults `moveHoursGoal()` uses and skips any hour outside
`[wakeHour, sleepHour)` — the identical half-open window, so numerator and denominator agree **by
construction for any wake/sleep pair**, not just the defaults.

Both production callers (`readiness-payload.ts:310`, `build-day-audit.ts:138`) pass no window and
call `moveHoursGoal()` with no args, so both sides take the same defaults. Checked rather than
assumed.

## Tests

Four new, all verified by mutation — removing the window filter fails every one:

- **the invariant that was violated**: `movedHours ≤ moveHoursGoal(wake, sleep)` across five
  wake/sleep pairs including the degenerate `[22, 23)`. This is the property that would have caught
  the original bug, and it holds for any pair rather than for one hardcoded case.
- movement at 3am and 5am no longer counts toward a daytime goal.
- boundaries match the goal's: wake inclusive, sleep exclusive.
- a fully active waking day reads **15 of 15** — 100%, where it previously read 24 against 15.

**One existing test was weakened by this change and was repaired, not left.** *"does not count a
purely resting hour"* used a 3am fixture; with the waking-hour filter it would return 0 for the
*wrong reason* and would still pass with the rest threshold broken. Moved to 11am so it tests what
it claims to.

## Verified

- `tsc --noEmit` clean · **3632 tests** green · all custom-rule scripts pass.
- Against `pnpm dev`: `/api/readiness-score` **200**, `/`, `/health`, `/activity` all 200, no errors
  in the dev log.

## Not exercised

- **A live move-hours value.** The seeded local user has **no intraday HR rows**, so
  `movedHoursToday` is null and the route returns `moveHoursGoal: null`. The runtime pass proves the
  callers still work; the behaviour proof is the unit tests above. Same limitation as Q-137/A.
- **The APK.** Shared code read server-side, no device-specific path — but the Activity card
  rendering the changed contributor was not observed on device.

## Expect the score to move again

This contributor was contributing a constant 100 at weight 12. It will now reflect actual waking-hour
movement, so it can fall below 100. Third change to this score today (Q-183 **+5**, Q-137/A lower,
this one lower) — **compare against a fresh baseline rather than any figure quoted earlier today.**

## Still open on this thread

**Q-190** — the volume lane is anchored to the user's own median session tonnage, the treadmill this
model claims to have removed. Decided (absolute per-session tonnage, ~5,200) and not yet
implemented. Then direction B, still gated.
