# BF-155 — the last set of every exercise has been losing its end time since July

**Branch:** `lane-a/bf155-session-duration-fallback` · **Lane A** · two one-line reads, one guard,
two test files.

## What the owner saw

*"my amrap week all has under 5mins workout time."* A 38.3-minute session printing as 3 minutes.

## What the entry got right, and the one thing it got wrong

Right: the mechanism end to end. `logExerciseFromPayload` stamps an exercise as
`lastSetEndMs ?? workoutStartedAt ?? now`; with no `set_end_ms` on any row every exercise fell to the
second rung, so all five carried `logged_at = started_at` identical to the millisecond, and
`day-log`'s `max(loggedAt + timeToComplete)` returned start-plus-the-longest-exercise. Verified line
by line against current `main`.

**Wrong: the dating, and it mattered.** The entry says *"every session since 6 September"*. Measured
in production instead of assumed:

| shape | sessions | range |
|---|---|---|
| all `set_end_ms` missing | 20 | 2026-04-30 → 2026-06-16 |
| **none missing** | 42 | 2026-05-28 → **2026-07-27** |
| **exactly one missing per exercise** | 33 | **2026-07-30** → 2026-09-13 |
| other | 1 | 2026-07-30 (the transition day) |

`count(set_end_ms)` equals `sets − exercises` on all 33 — one missing per exercise, every session,
for six weeks. **The defect is six weeks old; only the symptom is September's.** What changed in
September was one set per exercise: on a two-set exercise losing one of two is invisible, and on a
one-set exercise it is the only one, which is the case that reaches the fallback.

That also disposes of the entry's two candidate triggers — *"whether the single set never reaches
`appendSetEndMs`, or the baseline path submits without it"*. Neither. It is one mechanism, universal,
and the entry read its own best evidence backwards: it cited the 5-of-10 ratio on good sessions as
proof this was *not* "the last set is missing one", when 5 exercises × 2 sets with the last of each
missing is exactly 5 of 10.

## The root cause

`handleLogCurrentSet` appends the set's end time and then calls `handleCompleteSet`
**synchronously in the same tick**. That function snapshotted `store.setEndMsArray` from the
component's reactive pick, which has not re-rendered — so it copied the pre-append value and dropped
the last set every time.

**The file already documents this hazard, nine lines above, for a different field.**
`currentSet` is read through `useWorkoutStore.getState()` with a comment naming the exact cause:
*"handleLogCurrentSet now calls this synchronously in the same tick … this component hasn't
re-rendered."* The timing arrays sat two lines below, still reading reactively. The auto-advance
change that introduced the synchronous call is dated **2026-07-28** in its own comment; the first
broken session is **2026-07-30**.

## What shipped

**(b) the cause** — `snapSetStartTimes`/`snapSetEndTimes` read from `hot` (the live `getState()`)
like every other snapshot in that block. `setStartMsArray` is not currently reachable in the same
tick (its append fires on "Start Set", a separate interaction) but sits on the same line and would
fail identically; fixed together rather than left as the next one. Both dropped from the dependency
array, where listing them implies the reactive read that was the bug.

**(a) the display** — `day-log` prefers `completed_at`, the measured end, over reconstructing one.
Kept as a fallback rather than a replacement: a session still in progress has no `completed_at` and
the reconstruction is all there is. Guarded on `completedMs >= startMs` so a backward clock step
cannot render a negative duration.

**(a) alone would have closed this on the visible half**, as the entry warned — `logged_at` also
orders 1RM history, breaks PR ties and keys per-set HR attribution, and those stay collapsed on the
33 historical sessions whatever the card shows. Those rows cannot be reconstructed; the information
was never written. Their `completed_at` is intact, which is why (a) repairs the display without a
backfill.

## Verification

| mutant | result |
|---|---|
| revert the stale `setEndMsArray` read (the exact defect) | **killed** |
| revert `setStartMsArray` only | **killed** |
| `day-log` ignores `completed_at` again | **killed** |
| drop the `>= startMs` guard | **killed** — *survived the first pass; see below* |
| control — `>= startMs` → `!(completedMs < startMs)` | **survived**, as it should |

**The guard mutant survived the first mutation pass**, which is the pass earning its keep: I had
written a guard and nothing proved it did anything. Production says the case has never occurred
(0 inverted `completed_at` in 110 sessions), but it is not impossible and this codebase already
clamps for a backward clock step in `handleLogCurrentSet`. Kept and tested rather than deleted.

**Driven over HTTP against `pnpm dev`**, signed in as the seeded user, with the production shape
seeded — five exercises sharing one `logged_at`, `completed_at` 38 minutes out:

| code | printed |
|---|---|
| before | **3 min** (`10:00pm → 10:03pm`) |
| after | **38 min** (`10:00pm → 10:38pm`) |

Same row, same request — the owner's symptom reproduced and then fixed, rather than inferred. Probe
rows deleted afterwards (`DELETE 1`, 0 remaining).

An existing test moved with the fix: `day-log-duration-session-identity.test.ts` seeds
`completed_at` at start + 45 min while logging its one exercise at + 40, so it asserted the
41-minute reconstruction and now asserts 45. The fixture was never written for this — it just
happens to carry a real end four minutes past its last exercise, which is what a real session looks
like. Nothing it guards changed.

Gate: `pnpm check:rules` 74 of 74 · full suite by real exit code · lint 0 errors · `tsc --noEmit`
clean.

**Not exercised:** no device or APK run. The `workout-screen.tsx` half is the one that matters on
device and it cannot be driven here — vitest is node-only with no JSX transform, so its guard is a
source assertion plus store-level tests of the same-tick semantics the fix relies on. **The owner's
check is the real one:** log a single-set session on the S25 and confirm the printed duration matches
the wall clock and that the exercise rows carry distinct `logged_at` values. Until then, (b) is
verified by mechanism and not by observation.
