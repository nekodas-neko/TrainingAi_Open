## 2026-07-29 — Q-24 §7 `log-exercise`: an impossible 1RM could become a permanent record

**Branch:** `fix/q24-one-rm-plausibility` · Q-24 §7 (one of seven items; the rest remain)

### The failure

Every field in a set log is individually legal — 500 kg is a legal weight, 100 is a legal rep count.
Nothing in the payload is out of range, so no field validator fires. But the *derived* 1RM is not
bounded anywhere, and `personal_records` uses an `IfBetter` upsert: once a bad estimate lands it is
the maximum forever, and no subsequent real lift can displace it.

Measured, not assumed: the backlog claimed 500 kg × 100 reps yields "~2,166 kg". The actual values
are **1612.75 kg** via `calc1RM` and **1322.5 kg** via `calcAmrap1RM`. The backlog line is corrected
in the same commit; the bug is the same either way.

### Where the guard goes, and why not elsewhere

`oneRmImplausible()` gates `shouldCountTowardPr` in `lib/workout/log-exercise.ts` — **not** the
payload schema.

Rejecting the payload would throw away a real set because one derived number looked odd. The set is
a genuine user action and should always save; it is only the *permanent record* that needs
protecting, because that is the write with no undo. So the log persists, the estimate is still
computed and displayed for that session, and only the PR promotion is declined.

Placing it in `shouldCountTowardPr` also means both write paths inherit it — the web route and the
`pushMutations` branch call the same shared function, per the one-write-function-per-domain rule.

`MAX_PLAUSIBLE_ONE_RM_KG = 600`: the heaviest deadlift ever recorded is ~501 kg, so 600 clears any
human lift with margin while still catching data-entry noise by orders of magnitude.

### Verification

Full suite **2,673 passing** (the 20 failures are the pre-existing `claude_readonly` connection
tests), lint and `check-push-mutations` clean. Four new tests: the ordinary case still promotes, the
500 × 100 case does not, the boundary at exactly 600 still promotes, and a non-finite estimate is
rejected.

### A correction to the Q-21 note

Q-21 recorded an intermittent test (`oura-ble-sleep-window-union`) and theorised shared Postgres
state. This session hit a second intermittent — `lib/__tests__/oura-oauth-state.test.ts > rejects a
tampered or garbage cookie` — which touches no database at all. That disproves the theory, so the
backlog entry no longer asserts it.

### Not exercised

No APK run. The guard is pure and unit-tested, but the offline `pushMutations` path itself is only
reachable on device.
