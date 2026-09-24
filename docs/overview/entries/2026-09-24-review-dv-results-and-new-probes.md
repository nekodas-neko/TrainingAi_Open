# 2026-09-24 — Review reads the device agent's three sweeps: nine probes answered, three findings unfiled, five probes parked in the wrong lane

**Branch:** `review/dv-results-and-new-probes` · **Agent:** Review · **Docs only.**

The owner asked whether the device agent's results had come back and whether more device sweeps were
worth running. Sweeps 1–3 ran on 2026-09-23/24. This PR files what they found that had no entry,
moves five of Review's probes out of the lane where DV could not see them, and files six new probes.

## What came back

Nine of the seventeen Review probes are answered and closed: RV-128, RV-129, RV-133 and
RV-137…RV-142. Headline numbers: cold-start FCP 1020 ms; 90 warm visits with no first-mount outlier
(so Q-51 should be re-placed); every tab tap is one 68–118 ms long task (DV-12); tab paint slows
from 61–103 ms to 126–449 ms after about 2 h of use (BF-22); every tab switch shows 60–110 ms with
neither panel painted (RV-113); and Nutrition paints a skeleton on every visit (DV-17).

## Findings that had no entry

- **RV-145:** RV-139 failed its own pass line (Home requests `/api/workout-data` twice per visit)
  and was closed with the failure recorded only in the journal. The source does not name the second
  caller, so this goes to DV with the `initiator.stack` method.
- **RV-146:** RV-130's font-preload warnings. `Archivo` and `Instrument_Serif` serve one printer
  and are preloaded on every cold start. Lane B.
- **RV-147:** sweep 1's note that `upsertBodyMetric` merges, which makes a line in
  `data-layer-rules.md` stale. Lane O.
- **RV-148 was drafted and withdrawn before this PR opened.** It would have flagged that a
  weigh-in check leaves the day's weight `manual`, which outranks the scale, while two journals
  file it under "all undone". The owner had already accepted exactly that on 2026-09-23
  (`device-sweep-1-plan.md`, answer 1). Re-filing it would re-open a settled decision, so the
  number is left unused.

## Five probes that were in Lane O and belonged in DV

OR-135 moved RV-124, RV-126, RV-130, RV-131 and RV-132 to `O` with one note, *"already RUN on the
S25 … what it needs now is its findings filed"*. That was true of RV-126 alone. RV-124 has five of
seven rows unchecked. RV-130's resume half was never run. RV-131's remaining half needs real
airplane mode. **RV-132 was never run at all.** Because `O` is invisible to `--lane DV`, all four
stopped moving. They are now `Lane: DV` with what is owed stated on each. **RV-126 is removed**,
because every result it produced has a home: DV-5 (fixed and verified), DV-10 (fixed, #1463) and
RV-108.

## New probes — Part C of the checklist (P17–P22)

These are RV-149…RV-154. All are read-only except the midnight probe, which needs an overnight
sitting:
- a timezone census of every screen (`Emulation.setTimezoneOverride`)
- fault injection on one read endpoint at a time (`Fetch.enable`)
- how long the phone runs old code after a deploy
- an accessibility-tree and broken-image census
- which `localStorage` keys a tab tap writes (the suspect is `lib/sqlite/cache.ts:82`, feeding
  DV-12)
- the app left open across midnight

## Worth the owner knowing

- **Sweep 1 ran on gesture navigation; sweeps 2 and 3 ran on three-button navigation.** The group
  held back for "sweep 4" (RV-37, RV-127's clearance half, Q-168) needs only the phone switched back
  to gestures.
- **DV-15's fix (#1485, v1.465.23) deployed after sweep 3 ran on v1.465.17**, so the three
  reproductions predate it. The fix has not been checked on the phone; the device check is on the
  entry.

## Not done

No product code and no device run. Q-51's re-placement and the DV lane's ordering are the
Orchestrator's.
