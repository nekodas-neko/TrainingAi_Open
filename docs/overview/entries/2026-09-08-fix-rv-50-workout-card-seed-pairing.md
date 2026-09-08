# 2026-09-08 — RV-50 was not a seed-only bug, and the invariant it rests on is now guarded

**Branch:** `fix/rv-50-workout-card-seed-pairing` · **Lane B** · no user-visible change.

## What the entry said

> three raw seed-only `workout-card` reads never revalidate … an evicted key goes blank until
> something else refills it; a missed eviction serves the snapshot for the full TTL. Convert to
> `useCachedValue`.

## What is actually there

`useCachedValue` could not have been the fix in any case: all three sites are **synchronous helpers
called per row during render** — `lastSessionDay(sessionId, dayKey)` and
`getLastTrainedLabel(session, tz)` — and a hook cannot be called from a function invoked inside a
`map`.

More to the point, they are not seed-only. Both screens fetch **`workout-data:all`** on mount and
seed every `workout-card:<id>` from its `onData`, then bump an epoch counter — `dataEpoch`,
`workoutCardEpoch` — that is threaded into the reading `useMemo`s so the synchronous reads re-run
once the batch lands. Those counters are the fixes for **Q-89 and Q-106**, which are the bug RV-50
describes, and both carry comments saying so.

A scan keyed on *"is the key this component reads also fetched here"* cannot see that pairing,
because the key fetched is a different one. That is why the entry's own filter — "after discarding
fallback-paired seeds" — did not discard these.

## The real residue, and it is narrow

The pairing rests on an invariant nothing enforced: **`workout-data:all` is fetched with
`freshWithinTtl: true` at `TTL_LONG`**, so a group that evicted `workout-card:` while leaving the
batch key fresh would mean no refetch, nothing to re-seed the card, and those reads blank for up to
six hours. After RV-49 made the eviction actually fire, that is a worse outcome than the staleness
it replaced.

Checked all six groups that touch the card key — `invalidateWorkoutSummaries`,
`invalidateExerciseLogged`, `invalidateProgramStructure`, `invalidateInjuryWrites`,
`invalidatePrescriptionChanged`, `invalidateCheckinAffectsPrescription` — and every one already
evicts `workout-data` alongside it. The two groups that evict `workout-data` without the card key
are harmless in that direction.

So: **no defect, and the guard is the deliverable.** `lib/__tests__/cache-groups.test.ts` gains a
behavioural invariant — run each group, and if it evicted a `workout-card` key, assert the same call
evicted `workout-data` — plus a source check that those six are still all of them, since a seventh
group would slip past the cases. Verified by deleting one group's `workout-data` line: exactly one
test goes red.

Behavioural rather than a source grep on purpose. It runs the real functions through the same mock
the file already uses, so it cannot be fooled by a group that spells the eviction differently, and
it does not read prose — which is the false positive three grep guards hit earlier in this session.

## Filed rather than fixed

- **LB-56** gains the 2026-09-08 E2E sighting with both halves: `preferences-survive-reinstall`
  died at 23 minutes on #941 (`net::ERR_ABORTED`, `browser has been closed`) and **passed on #943**
  against a tree containing #941 — one unreproduced sighting, not attributable to that PR.
- **LB-52** gains two measurements. #943 needed **four** base re-merges in ninety minutes, every
  conflict on `docs/doc-size/docs/implementation-backlog.md.size` and never on the diff — structural,
  because every merged PR changes that file's length. And its six-required-checks list is wrong
  about E2E: four PRs merged tonight with that job still running, so it is advisory.

## Not verified

Nothing to see on device: this changes one test file and removes a queue entry.
