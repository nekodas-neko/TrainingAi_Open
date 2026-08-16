# 2026-08-14 — the check-in's suggested soreness can no longer survive an open (Q-226)

**Branch:** `claude/trainingai-backlog-v0abea`

Owner, two screenshots of "Exercise Readiness — Before Upper" a minute apart: *"I think the excercise
readiness card might be caching the old results as it opened with stuff from last sessjon; then when
I reopened it — it dissapesred."* First open showed five muscles selected (Chest, Shoulders, Triceps,
Quads, Calves) plus a whole-session-deload warning; the reopen showed two, and no warning.

`MoodCheckInSheet` is rendered with `open` as a prop and never remounts, so **all of its state
survives every close**. Two effects then read `suggested` in ways that let the previous open's value
reach the picker.

## Two stale reads, and why fixing either alone does nothing

**The cache seed left `suggested` untouched on a miss.**

```diff
- if (seed) setSuggested(suggestedSoreMuscles(seed.muscles, ALL_SORE_MUSCLES))
+ setSuggested(seed ? suggestedSoreMuscles(seed.muscles, ALL_SORE_MUSCLES) : [])
```

A miss is not "no news" here — it is "this component is holding a value from the last time it was
open". The guard turned the absence of a cache entry into a reason to keep stale state.

**The reset effect seeded `soreMuscles` from a stale closure.** It has no `suggested` dependency, so
it read whatever that state was left at, and `cachedFetch` always awaits a real request before its
`onData` fires — the correct value cannot possibly be present in that pass. It now clears, and the
seeding effect below (which *does* depend on `suggested`, and latches per open so a deselected muscle
is never re-added) is the only thing that seeds.

**Both were needed.** The two effects run in the same flush, so reassigning `suggested` in the first
does not change what the second closes over during that pass. Fixing only the seed leaves the reset
stamping a stale list; fixing only the reset leaves `suggested` itself stale for the seeding effect
to pick up. That is not a guess — it is what the browser run below showed when only one was in place.

## What is proven, and what is not

**Not proven: that this fixes the owner's sequence.** I built a CDP harness — Chromium over node 22's
global WebSocket, no new dependency — that logs in, opens the real sheet on Home, stubs
`/api/muscle-recovery` with a deliberately slow switchable payload, closes, clears the cache mirrors,
and reopens. It never reproduced the fault: **fixed and unfixed code produced identical output**, five
muscles on both opens either way. A harness that cannot tell the two apart proves nothing about
either, and it would have been easy to present the run as verification because it exercised so much
real machinery.

Two things went wrong on the way there, both worth recording:

- The first version dispatched `Escape` on `document` to close the sheet. It returned no error and
  the sheet stayed open, so "reopen" was measuring one continuous open. Clicking the real Close
  button fixed that — and until it was fixed the run appeared to show that one of the fixes was
  insufficient, a conclusion that was wrong and drawn from a broken harness.
- The stub's first payload used `recoveryPct`/`recovery` field names; `suggestedSoreMuscles` reads
  `pct` and `hoursAgo`, so it matched nothing and every read came back empty — which looked like a
  seeding regression rather than a bad fixture.

So what stands behind this change is reading, not observation: both stale reads are plain in the
source, both match the reported symptom, and neither can be defended on its own terms. The guard is a
source-text test because the repo has no React component-testing stack — no `@testing-library`, no
`.tsx` test files — and adding one for a two-line change is a larger commitment than the change.

**Also not exercised:** the S25. This is a client-side ordering fix on a canonical-runtime screen, and
the device is where the owner saw it.

## Verified

Seven cases, **mutation-verified both ways**: restoring the `if (seed)` guard fails the case written
for it, and restoring `setSoreMuscles(suggested)` fails the case written for that. The suite also
pins what must *not* change — the per-open latch, the `prev.length === 0` fill, and an edited log
restoring its own saved muscles.

Full suite green — **464 files, 3,839 tests**. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33.

The browser run is kept out of the repo (it lives in the session scratchpad): it needs a running dev
server and a seeded account, and a harness that does not discriminate is not worth maintaining. The
approach is worth knowing about though — driving the real UI over CDP with no project dependency is
cheap, and the next UI race is worth pointing it at with a fixture that has under-recovered muscles
in the database rather than stubbed at the network.
