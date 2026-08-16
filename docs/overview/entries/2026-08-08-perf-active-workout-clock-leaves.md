## 2026-08-08 — the active workout screen stops re-rendering itself once a second (Q-121)

**Branch:** `perf/active-workout-clock-leaves` · **Domain:** `workouts`

### What was wrong

`components/workout/active-workout-screen.tsx` called `useElapsedSec` **twice at the top of the
screen** — two independent, unsynchronised `setInterval(…, 1000)` state hooks driving roughly 700
lines of JSX for the whole length of a session. This is the placement CLAUDE.md's render-discipline
section names outright: *"call `useCountUp`/`useElapsedSec` in the leaf that displays the number,
never at the top of a screen."*

The file already knew. Two comments in it describe mitigations — a `useMemo` on the heatmap's
assignments *"so the memoized MuscleHeatmap doesn't re-render on every 1Hz session-clock tick"*, and
another noting a value is *"re-computed every render since sessionElapsedSec ticks."* Those protect
the **children**; the screen's own JSX kept reconciling once or twice a second for 45–90 minutes, on
the screen the user looks at longest.

### What shipped

A new `components/workout/workout-clocks.tsx` holding five leaves, each owning its own tick and
re-rendering only the nodes that change:

| Leaf | Replaces |
|---|---|
| `SessionRing` | the header's 48 px progress ring + elapsed time |
| `SessionPill` | the ready screen's session-time pill |
| `ExerciseClock` | the ` · MM:SS` in the header subtitle |
| `WarmupRampProgress` | the warm-up ramp segments and their `M:SS / M:SS` readout |
| `RestTimer` | the rest label, countdown ring, and tap-to-start hint |

`RestTimer` also absorbs the rest arithmetic the screen recomputed from `Date.now()` on **every
render** — correct only because the session clock happened to be re-rendering it every second, which
is exactly the coupling being removed. It takes `onStartSet` optionally: with it the ring is a
tap-to-skip button, without it the ring is inert, which is the all-sets-done state.

The ready-screen baseline (`readyElapsedBaselineSec`) was read off a ref fed by the same screen-level
tick; it now derives from `workoutStartMs` directly, so the ref is gone.

`workout-screen.tsx:796`'s 1 Hz interval is **untouched** — the backlog entry flags it explicitly and
it writes only to a module singleton, never React state.

Net: the screen file drops from 745 to 627 lines and no longer imports `useElapsedSec` at all.

### Verification

- `tsc --noEmit` clean · `pnpm lint` 0 errors (one pre-existing `lapStartMs` unused-prop warning,
  present before this change).
- **Driven end-to-end on `pnpm dev` through a real session** at the S25 viewport — workout select →
  pre-workout → warm-up → active screen → set phase → logged set → rest phase. Every clock was
  sampled twice, six seconds apart, and all four advanced:
  - ready screen: session pill `0:03` → `0:09`, warm-up ramp `0:03 / 4:00` → `0:09 / 4:00`
  - set phase: header exercise clock `· 0:03` → `· 0:09`, session ring `0:13` → `0:19`
  - rest phase: ring `87 of 90s` → `81 of 90s` (counting down), session ring `0:23` → `0:29`
- Screenshots confirm the rest ring's arc, glow and "Tap to start early" hint render as before.
  Zero page errors and zero console errors across the run.

### Not exercised

No device run — this is React structure, no native, safe-area, gesture or notification path.

**The improvement itself is structural, not measured.** No profile was captured, so there is no
before/after frame-time or render-count number here — the claim is only that the two screen-level
1 Hz state hooks are gone (the file no longer imports `useElapsedSec`) and the same values still
tick. Q-51 already records that real render-cost numbers need an on-device Performance profile the
owner has to capture.

Also not exercised: the **overtime** branch of `RestTimer` (its red styling and `Xs overtime — tap
to start` label) — reaching it means idling past a 90 s rest, which the scripted run did not do. Its
markup is a verbatim move, but the state was not seen rendered. Superset handoff and the
all-sets-done inert ring were likewise not reached.
