# 2026-09-14 — a walk's segments count their own steps, and the entry that asked for it was wrong three times (LA-48)

**Branch:** `lane-a/la48-walk-segment-steps` · **Lane A** · no version bump — nothing renders this yet

## What shipped

`WalkSegmentStat.steps`: how many steps a guided walk's fast or slow block actually contained,
stored in the existing `activity_logs.segments` JSONB beside the HR, pace, distance and cadence it
already carried. The owner's ask was *"make sure all these values get stored so we can do data
analysis on it later like steps x distance x time"* — a segment had every one of those except steps.

No migration: `segments` is `jsonb` on the server and `TEXT` locally, so the field is a type change
in five places plus the wire schema, all in one commit.

## The entry said three things that were wrong, and each one changed the work

**1. There are five type places, not four.** The entry listed `WalkSegmentStat`, the `$type<>` in
`schema.ts`, `LocalActivityLog` and `WalkSegmentStatSchema`. It missed
`packages/shared/src/types/body.ts`, which keeps its own structural copy of the segment shape and is
what `ActivityLog` is assembled against. `tsc` found it; reading the entry would not have. This is
BF-70's fifth layer again — when a shape is declared in five places, a count written in a backlog
entry is not the authority on how many.

**2. `steps` was not "a clean derivation from `cadenceSeries` that depends on nothing".** The
obvious derivation — mean spm × duration — is wrong, and not subtly. `avgCadenceSpm` is cadence
*while moving* by construction: a stop contributes no readings, so it cannot pull the mean down.
Multiply that by the segment's wall duration and every pause gets counted at the walking rate. A
segment holding 30 s of walking at 120 spm inside a 180 s window is **60 steps** by integration and
**360** by multiplication. That comparison is now a test, written as the assertion rather than the
prose, so the wrong derivation cannot come back quietly.

It was also a second answer to a question the app already answers. `estimateSteps` in
`packages/shared/src/health/cadence.ts` integrates cadence bins for the walk's own saved `steps`
(Q-230), and its own comment warns against a second integration. Both now go through
`stepsFromCadenceSeries`, so a walk's total and the sum of its segments cannot drift apart.

**One divergence is real and is written down rather than smoothed over.** `estimateSteps` filters to
**strap** readings before binning; the persisted series carries no source, so a caller slicing it
cannot apply that filter. Today the two agree exactly — `pickLiveCadence` returns null on the ring
branch while `RING_CADENCE_VALIDATED` is false, so every reading in the series is a strap reading.
The day ring calibration ships, a mixed-source walk would have segment steps counting ring data the
total excludes. The comment on `stepsFromCadenceSeries` says so and says where to start.

**3. The correction the entry already carried was itself wrong, and this is the one that matters.**
On 2026-09-01 the entry was corrected to say the adherence roll-up "needs no Lane B producer",
because every `readPacer` input is reconstructible after the fact. Two of the three are. **Cadence is
not.** The live bar bands `snap?.liveSpm` (`walk-pacer-bar.tsx:34`) — the tracker's instantaneous
~1 Hz reading — while the only cadence a saved walk carries is `summarizeCadence`'s series, binned to
10 s and holding each bin's **median**. A ten-second median and an instantaneous value fall on
different sides of a target, which is precisely where adherence is decided.

So a post-hoc reconstruction would store a plausible number that is **not** the number the walker
was shown — the BF-59 class the entry invokes against itself two paragraphs earlier. The remaining
two thirds of LA-48 are therefore a design decision (accumulate live on the walk screen, or
reconstruct and label it an approximation) rather than the build the entry described. Both shapes are
written into the entry, along with a second obstacle the reconstruction route has to solve: the HR
and speed target pairs are not present at the save site at all.

## Why this half shipped alone

The entry sanctioned the split itself — *"Ship `steps` first if this is split; it is a clean
derivation."* Half of that sentence was wrong and the other half was right: it is independent of the
adherence design, it needed no producer, and holding it behind an unresolved design question would
have kept a field the owner asked for out of the archive for no gain.

## Verification

Eleven tests across `lib/walk/__tests__/segment-stats.test.ts` and
`packages/shared/src/health/__tests__/cadence.test.ts`: integration versus multiplication on a
segment with a stop, each bin landing in exactly one segment across a boundary, null rather than zero
with no cadence source, the walk total unchanged by the refactor, and — the trap the entry named —
that `steps` **survives** the wire schema rather than merely being accepted by it. Zod strips unknown
keys silently, so an acceptance test passes while the field is being dropped on both write paths.

Mutation pass, exit codes captured directly:

| Mutation | Caught |
|---|---|
| `steps` = mean spm × duration (the entry's derivation) | ✅ |
| `steps` removed from the wire schema (the Zod-strip trap) | ✅ |
| empty series returns 0 instead of null | ✅ |
| **control** — the same sum written as a `reduce` (equivalent) | correctly passed |

**Not exercised: a real walk.** Cadence needs a Polar H10 over BLE and no harness here has one, so
every segment written in the sandbox has `steps: null` — which is the correct value for a GPS-only
walk and tells you nothing about a strap-paired one. The first strap walk after this deploys is what
confirms a real number lands. Recorded as a Known Issue.
