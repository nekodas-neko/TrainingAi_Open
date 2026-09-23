# 2026-09-23 — OR-135: the DV lane has work in it for the first time

**Branch:** `chore/or-135-assign-every-entry` · **Lane:** O · queue state + one rule

The owner asked for everything to be assigned to an agent, with device work reaching the DV agent.
`node scripts/next-item.js --lane DV` now prints **9 READY**. It printed 0 before.

## The rule, in his words

> *"Only device testing that can be done by DV goes to DV; if its device testing based on
> looks/design that should stay in orchestrator waiting for user input."*

So a lane names who acts **next**, and for the device that means what the phone can **answer** —
a measurement or reproduction with an objective pass/fail — rather than everything the phone is
involved in. A judgement about looks or layout goes to the Orchestrator and waits for him, even
though the phone is where he will look at it. `DV-6`'s status-bar scrim was correctly his call.

## What actually moved, and it is smaller than the first plan

**16 entries carried no lane at all** — every one a `DEVICE PROBE`. They split:

- **9 outstanding → `DV`.** Each states it has no build half and names its own method. The
  measurement is the deliverable.
- **7 already run on the S25 → `O`.** Their results are recorded in the entry; the device is no
  longer what they need, their findings need filing. **Re-running a probe that has answered is the
  device agent's time spent on a question nobody is asking.**

`Q-253` (a paid real-hardware device farm) is **struck** — owner: *"Drop it — the real S25 is
better."* It was filed before the DV agent existed; breadth across devices he does not own loses to
the one device he does.

`PS-8`, `PS-9`, `PS-12`, `PS-15`, `PS-16` stay queued, marked **waiting on hardware, not on the
device agent**. They name the Colmi R09, not the S25, and the owner confirms it is coming back.

## Three traps, each of which mis-assigned real entries

**(a) "The agent can run the check" is not "the entry belongs to DV".** `RV-143` — Review's
independent filing of this same finding, hours earlier — listed ~13 entries as runnable by the
agent. **Three of three I sampled should not go to DV:** `Q-418`'s remaining work is Kotlin and an
APK, `LA-36`'s is a local-store read mapper, and `BF-49` was already reproduced on device pass A2,
so its next act is Lane B's fix. Bulk-applying that list would have mis-assigned about a dozen
entries — and RV-143's own text says to read each against its entry rather than trust the split.
It was right.

**(b) A probe that has already run is no longer DV's.** Seven of sixteen, which nothing in the
queue distinguished.

**(c) The `Verify:` field was doing the opposite of its job on these entries.** It means SHIPPED,
so the 9 outstanding probes filed under *"done; a look is owed, nothing is blocked"* — which is
exactly why the DV lane read 0 while holding its entire queue. The field is replaced with plain
prose naming the measurement as the deliverable. **This is the mirror of RV-143's warning** (never
convert a gate into a verify to gain visibility) and rests on the same reasoning: that field is a
claim that work has shipped, and applying it to unbuilt work hides the work.

## One mistake worth recording

The first pass at this corrupted seven entries: I built a list of regex matches and then mutated
the string inside the loop, so every insertion after the first landed at a stale offset — one
spliced into the middle of the word MEASURED. Reverted and redone iterating in reverse. **It was
caught by reading the result rather than by any check**, which is the argument for looking at what
a bulk edit actually produced.

## The DV lane gaining entries broke a test, and the test was the wrong one

`next-item-visible-silence.test.ts` — written this morning for TN-61 — asserted that `--lane DV`
output *"does not contain `showing`"*, using DV as its everything-fits case **because DV was empty
at the time**. The moment it held 9 entries the assertion failed, on this: `RV-128` is titled
*"does the tab switch drop a frame **showing** neither panel?"*

A substring assertion over a report that prints **user-written titles** is a false positive waiting
for someone to write the word. It now matches the truncation line's actual shape and checks the
READY count is genuinely under the cap, so it tests the behaviour rather than a word.

Worth noting against the entry it came from: TN-61 was about a tool whose silence could not be
distinguished from absence. Its test then made the mirror error — asserting on a token that could
appear for an unrelated reason.

## Not done

- **The remaining ~107 device checks still sit on their building lanes.** That is correct for most
  of them by trap (a) — the next act is a fix, not the phone — but each needs its own read, and
  that is real work rather than a sweep.
- **`RV-143` is not struck.** Its tooling half shipped in OR-134; its triage stays as reference,
  now with the caveat that its axis is not the lane axis.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 76 of 76** Custom Rules steps. Full log kept, not tailed.
