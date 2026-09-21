# LA-124 — the stress chart's clock formatter is hoisted out of its per-bucket map

**Branch:** `perf/la124-stress-day-formatter` · **Lane B** · no version bump (see below)

## What shipped

`components/body-battery/stress-day.ts` built a fresh `Intl.DateTimeFormat` on every
`minutesIntoDay` call, and `toSegments` called it once per bucket inside a `.map`. Constructing the
formatter is the expensive part, and it was loop-invariant the whole time — `tz` is a parameter and
every other option is a literal.

The formatter now comes from a `clockFormat(tz)` helper that `toSegments` calls **once**, with a
private `minutesFrom(fmt, t)` doing the read. `minutesIntoDay(t, tz)` keeps its exported signature
and its per-call semantics exactly — it is not in a loop, and it is directly tested.

**Measured here, not carried over from the entry:** a full day's 48 buckets went **3.02 ms → 0.18
ms, 16.7×**. The entry's own figure was 3.19 → 0.16 ms; same order, and the difference is machine
noise. This is the last raw `Intl.DateTimeFormat` construction in `lib/`, `packages/`, `app/` or
`components/` — RV-80 took the other one, and the sweep is now complete.

## The test, and why the existing ones were not enough

`stress-day.test.ts` covers the behaviour — the timezone, midnight-as-0, gap splitting, coverage —
and passes unchanged, which is what says the hoist is behaviour-preserving. What it does not cover
is the hazard the hoist *introduces*: a formatter cached one level too far out, at module scope,
binds the first caller's zone for the life of the process.

The entry predicted the existing `Etc/GMT+5` case would catch that. **Measured: it catches the broad
version and misses the narrow one.**

- Mutating `clockFormat` itself to a module-scope singleton → 4 tests fail across three files,
  including the existing `Etc/GMT+5` case. The entry is right about this one.
- Mutating **only `toSegments`** to hold a module-scope formatter, leaving `minutesIntoDay`
  untouched → **27 of 28 pass**. Every pre-existing test is blind to it, because no existing test
  calls `toSegments` in two zones.

`la124-hoisted-formatter.test.ts` is the control for that second mutation, in RV-80's shape: two
`toSegments` calls in two zones in one process, plus a re-ask of the first zone so ordering cannot
hide it.

## Not exercised

No device pass, and none is owed — the entry says so explicitly (*"do not batch this with a
device-gated item; it needs no APK and no owner check"*). The saving is ~3 ms per chart render,
which is real but not felt.

## No version bump, deliberately

The rule bumps the version for **user-visible** changes. Three milliseconds off a chart render is
not perceivable, and a changelog line claiming otherwise would be the kind of number-as-fact the AI
guards exist to stop. Nothing about what the chart shows has changed.
