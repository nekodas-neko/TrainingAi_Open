## 2026-09-01 — the walk pacer reads speed now, not the whole walk (LA-52, v1.427.0)

**Branch:** `fix/la-52-windowed-walk-speed` · **Lane:** B

`appendPoint` set `currentPaceSecPerKm` from **cumulative** distance over **cumulative** elapsed, and
`walk-active.tsx` fed `kmhFromPace(currentPaceSecPerKm)` straight into `readPacer`. So the speed
rung's input was the average speed of the whole walk. Three consequences, all of which LA-52 states
and none of which a passing test could see.

### What shipped

- **`windowedSpeedKmh(points, windowSec = SPEED_WINDOW_SEC)`** in `lib/walk/walk-pacer.ts` — distance
  over elapsed across the last 20 s of `rawPoints`. Null under two points or a zero span, which drops
  the pacer to the heart-rate rung rather than reading zero and announcing "Stopped".
- **`recentSpeedKmh`** on `useGuidedWalkStore`, recomputed on every appended point.
  `currentPaceSecPerKm` is untouched and stays cumulative — the summary derives from `rawPoints`
  directly, so nothing there moved.
- `walk-active.tsx` feeds `recentSpeedKmh` to `readPacer` **and** to the big km/h readout.

### The half the entry did not name

**The on-screen km/h was the average too.** It came off the same `currentPaceSecPerKm`, under a
comment claiming *"Both come off the one pace series — there is no second computation."* So a walker
reading `4.8 km/h` mid-walk was reading their average since starting. That is now live, and the
min/km beside it is labelled **`avg`**. Two numbers side by side with nothing saying which is which
is how the cumulative one came to be trusted as "now" in the first place.

### Decisions

- **20 s.** Shorter and a single wandering GPS fix swings the band; longer and the reading stops
  being *now*. LB-36's device check asks for movement within ~10 s, and a 20 s window has moved most
  of the way there by then.
- **A sparse fix rate reaches back past the window rather than going null** — an absent speed
  silently demotes the whole rung to heart rate, which is the worse failure.
- **It reads the points and nothing else.** A wall clock would decay the figure toward zero while the
  walker stands still producing no fixes — right when they have stopped, wrong in a tunnel — and the
  store only recomputes on a new point anyway. A GPS dropout therefore freezes the reading, exactly
  as it already froze the cumulative one.
- **`BAND_TOLERANCE` untouched**, per the entry: widening it treats an inert signal as a noisy one
  and would make the cadence rung worse in the same move.

### Verification

- `lib/walk/__tests__/windowed-speed.test.ts` — 11 tests. Every movement case walks at one speed and
  then changes it, because a test that never changes effort mid-walk cannot see this defect.
  **Eight mutations kill it:** reverting to the cumulative reading (5 of 11 fail), returning 0 instead
  of null, dropping the sparse-fix reach-back, measuring elapsed from the walk start, widening the
  window to 10 minutes, putting the screen back on `kmhFromPace`, stopping the store recomputing, and
  removing the `avg` label.
- The suite asserts the old reading's behaviour too, computed the same way the store computed it:
  after 20 min at 5 km/h and 30 s at 2, the cumulative figure is still **above 4.9**, and after 30 s
  standing still it is still **above `STOPPED_KMH`**. The finding is asserted, not described.
- **`e2e/walk-pacer-speed-rung.spec.ts` asserted the two readouts were one number in two units**, and
  that claim is now false by design. Updated in the same PR: the `avg` label is the assertion, and
  the unit agreement moved to the fixture, which can hold effort constant. All 3 specs pass.
- `pnpm check:rules` **Ran 67 of 67**; `tsc --noEmit` and lint clean; the 9 walk/store/guided-walk
  suites are 102 green.

### Not exercised

- **The device, which is the whole point.** Slowing deliberately mid-segment and stopping at a
  crossing are LB-36's device checks 2 and 3 — they could not have passed before this and are still
  unverified. LA-52 stays in the queue with a `Keep:` line for exactly that.
- Real GPS: every case here is a synthetic track. Fix jitter, dropout and Android's actual update
  cadence are not reproducible in the sandbox.

### Queue hygiene done alongside, and why it is here

Working the Lane B queue top-down, the two entries above LA-52 could not be started:

- **BF-104** (log a meal at 0.5×/1×/1.5×) needs one argument threaded through `logMealFromSaved` in
  `packages/shared`, called from the web route and the `pushMutations` branch — all Lane A. Split:
  **LB-49** is the engine half, and BF-104 now `Needs:` it.
- **BF-102** ("Calibrated" activity level) needs the measured factor, which comes from the energy
  model and the recommend route. Split: **LB-50** is that half, plus the independent prompt bug it
  names — the route tells the model the TDEE was computed *for* the user's activity level when it is
  `bmr × 1.2` regardless. **That string should be fixed whether or not the picker ever ships.**

Both were `READY` for Lane B before this and are `PARKED` after, which is what makes the queue honest
rather than a list of things that stall on contact.
