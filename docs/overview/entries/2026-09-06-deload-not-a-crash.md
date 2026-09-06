# A deload is not a crash (PS-26)

**Branch:** `fix/ps26-deload-not-a-crash` · **Lane:** A · **Domain:** workouts
**Version:** 1.436.18

A deloaded exercise stores `estimated_1rm = 0` deliberately — deload work is submaximal and must not
read as a max. Q-298 taught `listPrevious1rm` that the 0 is a sentinel rather than a value. Nothing
taught the layer above it: `/api/weights-summary` took `estimated1rm` off the newest log whatever it
was, so an exercise whose last session was a deload published `0` beside a real
`previousEstimated1rm`, and the strength card rendered the difference — an empty bar and a drop equal
to the lifter's entire 1RM, in red. Live on **16 of the owner's 34 exercises**, every one flagged
deload.

Prescription was never affected: `resolveWorkingBasis` already skips deload rows, and the checkpoint
held that control. Nothing lifted was ever wrong; only what was drawn.

## The fix is a definition, not a guard

`listRecent1rm` returns the two most recent estimates that **are** estimates — same `> 0` filter
Q-298 established, `rn <= 2` instead of `rn = 2`. `listPrevious1rm` becomes a thin wrapper over it,
so there is one ranked query rather than two copies of the same CTE, and its two existing callers and
their tests are untouched.

That makes `estimated1rm` mean "the most recent real estimate" rather than "the newest row's value".
For an exercise that was not deloaded those are the same number. For one that was, the card now shows
the last real strength and a delta against the one before it — two comparable numbers — instead of a
sentinel subtracted from a real value.

## One predicate, because guarding half of it leaves the reported half

`strength-progress.ts` carries the same `> 0` check as defence, since the route is not the only thing
that could ever populate the field. The first version guarded `computeTrend` alone, which killed the
delta and left the bar at 0% — the empty bar being exactly what was reported. Both now read one
`currentOneRm(ex)` helper.

## The repository test did not catch the actual fix

Mutating the display guard failed a test. Mutating **the route line that is the fix** — back to
`log?.estimated1rm` — left every test green, because the repository test exercised `listRecent1rm`
directly and nothing asserted the route used it.

That gap is the reason `app/api/__tests__/weights-summary-deload.test.ts` exists: it drives `GET` for
a seeded exercise whose newest log is a deload and asserts the published number. Re-run against the
same mutation, it fails two cases by name — and its non-deload control stays **green**, which is what
distinguishes a control from a duplicate.

The transferable part: a repository test and a route test are not interchangeable, and the way to
find out which one you actually have is to mutate the line you changed rather than the line you
understand.

## Verification

- `tsc --noEmit` clean · **771 passed | 5 skipped (776 files), 6561 tests** · `pnpm check:rules`
  68 of 68 · lint 0 errors
- Four new repository cases: the PS-26 shape, a run of consecutive deloads, one real estimate with no
  previous, and an exercise that has only ever been deloaded (which publishes null, not 0)
- Three new route cases, mutation-verified as above
- `/api/weights-summary` loads and fails closed (401) on `pnpm dev`

**Not exercised:** the rendered card on device. This changes what the route publishes and what
`computeBarMetric` returns; the S25 rendering of the corrected values has not been looked at. No APK
is needed — server and shared code only, so a Railway deploy delivers it. No production data was
read; the 16-of-34 figure is the checkpoint's, not re-measured here.
