# The workout list says which day its numbers are from, and a shipped fallback turns out to reach nobody

Implementation Lane B, 2026-09-27. `RV-202 ③`, plus `LB-165` found while building it.

## What shipped

The pre-workout heading carries an amber pill naming where its numbers came from when that is not
today's server answer: **`From 26 Sept`** for a cached payload built on an earlier day,
**`Base program`** for the on-device program mirror. Today's payload is deliberately unlabelled —
a permanent note beside "Recommended workout" is furniture, and the lifter would stop reading it on
the day it meant something.

It reads against the header's own `Sunday 27 September`, which is the whole value, so the e2e guard
asserts the pill does not **wrap** below the heading at 412 px rather than merely that it exists.

## Three paint sources, not two

The entry named "the last cached or base numbers". There are three, and each answers separately:
this screen's own `workout-data:<id>` cache, Home's `workout-card:` prefetch, and the local-store
mirror when neither cache has anything. The two cache branches were byte-identical but for the
variable, so they now share one `paintSeed` body — three replacement sites covering four sources,
with the unit test pinning `setExercises`-replacements == `setNumbersSource` calls so a fourth
cannot be added silently.

`isWorkoutDataToday` was already there for the `loggedTodayInSession` strip and is the comparison
used. Its one unsuitable edge: a payload with **no** `dataDate` counts as not-today, which is right
for stripping a flag and wrong as a label trigger, because there is no day to name.
`cachedNumbersSource` returns null there rather than guessing.

## `workout-screen.tsx` is a size-ratcheted hotspot, and the rule was right

The first version added 19 lines to a file already at its 1833-line baseline, and
`check-component-size` refused it with "extract, do not append". The extraction that paid for it is
the one that should have happened anyway: `WorkoutDataSeed` and `freshExercises` moved to
`components/workout/workout-data-seed.ts` beside the new `seedNumbersSource`, because all three ask
the same question of the same payload. Net growth on the hotspot: **zero**.

## LB-165 — RV-202 ①'s rules plan reaches no screen

Item ③ needed to know whether a rules plan is ever on screen, so it could label one. Tracing it
established that **it never is**, in five code-certain links: the plan is deliberately not
persisted; `/prescribe` returns it in a body both client callers ignore; `workout-data` reads the
*stored* state and never consults the background generation it fires; and `isAiPrescriptionPending`
keys on a status the rules path never flips. So the ~30 s "Preparing your AI workout…" wait that
item ① was written to remove is **still there**.

The entry's own measurement — HTTP 200 where there had been a 502 — was real. It was a measurement
of the route, and the conclusion drawn from it was about a layer it did not test. The retraction is
written onto the entry beside it rather than replacing it, and the work is filed as `LB-165`.

## Not exercised

**Not verified on device.** This is a WebView-delivered change, so it reaches the S25 on a normal
Railway deploy with no APK — but nobody has looked at the amber pill on the phone. The harness
proves it renders and does not wrap at 412 px dark; it cannot speak for the Samsung WebView's
rendering of the amber against the card gradient. A Known-Issues row records that.

The `Base program` branch is **rendered from source reasoning only** — reaching it means an empty
cache *and* a local-store mirror, and `getLocalStore` returns null in the web sandbox, so the
harness cannot reach that path at all. The `From {date}` branch is the one that was rendered.
