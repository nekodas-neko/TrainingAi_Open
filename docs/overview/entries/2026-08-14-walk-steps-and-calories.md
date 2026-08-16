# 2026-08-14 — a walk now records the steps and calories it always could have (Q-230)

**Branch:** `claude/trainingai-backlog-v0abea`

Owner, on a Guided Walk summary showing per-interval SPM: *"we [have] spm we should be able to get
steps count right? as well as a burned calorie number to add to our logs."*

Right on both counts. Neither number was missing because it could not be computed — both were
written as literal `null` at save time while the inputs sat right there.

## Steps: integrate the cadence series the walk already saves

`summarizeCadence` now also returns `stepsEstimate`, integrating each populated 10-second bin's
median spm over the bin's duration. Non-locomotor stretches are absent from the bins rather than
zeroed — the same convention that stops a pause dragging the average down — so a walk with rests
counts only the moving parts.

**Strap readings only, gated per reading rather than per activity.** Today that is every reading:
`pickLiveCadence` returns null on the ring branch while `RING_CADENCE_VALIDATED` is false, so
`source === 'strap'` would be an equally exact gate right now. It stops being exact the day ring
calibration ships — a single walk could then mix strap (while fresh) with ring (during strap gaps),
at which point `source` means only "contributed the most readings" and a per-activity gate would
quietly start counting ring data into a step total. Filtering per reading costs nothing today and
removes that day's surprise. There is a test that fails if the filter is dropped, using a walk where
ring readings outnumber strap ones.

It is an **estimate** and the detail sheet now says so (`steps (est.)`). A bin with one reading still
counts a full ten seconds, which is the honest reading of "this was the cadence while moving" but
does round sparse data up. A true gap-free count needs the windowed raw-frame reader that does not
exist — a different, larger job, and the backlog's Phase G note is about that one, not this.

## Calories: derived server-side, and the build is what proved that was necessary

`saveActivityLog` now fills a missing `caloriesBurned` from duration, activity type and the profile,
using the same `estWorkoutKcal` at the same `'moderate'` intensity `computeActiveEnergy` already used
to fold this activity into the Body tab's Burned total. **A test asserts the two agree exactly**,
because a row and the day's total disagreeing about one walk would be worse than the empty column.

**The first attempt did this in the client components and failed CI's Build check.** `estWorkoutKcal`
reads its MET table through `lib/oura-models/constants`, which resolves files with `node:path`, so
importing it into a client component drags `node:path` into the browser bundle. That is not a config
nit — it is the Q-221 boundary holding: that constants tree was deliberately moved to runtime loading
to keep vendor data out of client bundles, and the build refused to let it back in.

Server-side is the better shape anyway, and not only because it compiles. `saveActivityLog` is the
one function the web route and the outbox's `pushMutations` branch both already call, so one change
covers every writer instead of four — the sibling-drift rule satisfied by construction rather than by
a sweep. It also means the client never needs to hold age and weight to save a walk.

**My local gate did not catch this: I was running tsc, lint, custom rules and the suite, but not
`pnpm build`.** It is in the pre-push gate now.

## The comment that hid it, in three files

`done-activity-screen.tsx` said *"caloriesBurned is computed server-side; it hydrates on the next
sync/fetch."* `exercise-review-sheet.tsx` said *"Computed server-side; hydrates on the next
sync/fetch."* **Nothing computes it** — not the route, not the repository, not the `pushMutations`
branch; grepped all three. The column stayed empty forever, and the comment is why nobody looked.

The sibling sweep the entry asked for found **four** `activity_logs` writers, not two:
`walk-summary`, `done-activity-screen`, `exercise-review-sheet` and the guided-walk web fallback.
All four now write both fields. Non-treadmill activities also pick up the cadence step estimate,
which is the only step source a GPS walk or run ever had.

## The near-miss the client attempt produced, kept because the lesson outlives it

While the estimate still lived client-side it read `profile` off the cached `body-metadata` payload —
and **that route did not expose it**. `profile` existed only as an argument to `computeActiveEnergy`
inside the handler. The helper compiled, ran, and would have returned null forever: the exact empty
column it was written to fill, now with more code behind it.

No test would have caught that. What caught it was hitting the live route on the dev server and
seeing `profile: None` come back. The guard then written to pin the coupling **passed with the field
deleted**, because it sliced from the handler's `Unauthorized` early return and matched the
`computeActiveEnergy` argument instead of the response.

Both the helper and that coupling are gone with the move to `saveActivityLog`, which resolves the
profile from the database directly. The `body-metadata` response is back to what it was.

## Verified

Six new cadence cases, seven for the estimator. **Mutation-verified four ways:** dropping the strap-only
cadence filter fails 2 cases; summing instead of taking the per-bin median fails the
harmonic-mis-lock case; removing the derivation fails 3 calorie cases; making it overwrite a
caller-supplied value fails the case written for that.

A fifth mutation did **not** discriminate and is worth recording rather than hiding: removing the
`ageYears`/`weightKg` null guard from the derivation changes nothing, because `estWorkoutKcal`
already refuses those itself. The guard is redundant defence, not the load-bearing part, and the
null-profile behaviour is correct through the estimator either way.

**Observed on the dev server:** `POST /api/activity-logs` with `steps: 5400, caloriesBurned: 210`
returns 201 and reads both back. `pnpm build` passes, which is the check that caught the client-side
attempt.

Full suite green — **467 files, 3,876 tests**. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33.

**Not exercised: the S25, and a real walk.** The step estimate's inputs come from a live strap over
BLE, which this sandbox has none of, so what is proven is the arithmetic and the wiring — not that a
real 5,000-step walk reports something a phone pedometer would recognise. That comparison is the
device check worth doing, and the first walk after this ships is the one to look at.
