# 2026-09-24 — RV-189: five entries removed, four rerouted, and a park with no field to hold it

**Branch:** `chore/rv-189-queue-re-read` · **Lane:** O (Orchestrator) · docs-only

Review sweep 59 re-read 59 READY entries in Lanes A and B against the code and filed `RV-189`
listing what should leave the queue. This is the Orchestrator acting on it.

## Every removal was re-verified, not taken from the sweep

Scans of this file have overstated reality five times in this session, so each of the five
"already shipped" claims was checked against the code or the merge before the entry was cut:

- **LB-123** — `shouldCache?: (data: T) => boolean` exists at `lib/sqlite/cache.ts:279`, guards the
  `setCached` at `:386`, is threaded at `:443`/`:449`, and `done-screen.tsx:125` passes it. Shipped.
- **LB-114** — `batteryConfidence` now reads `sufficient: sampleCount > 0 && (…)`
  (`packages/shared/src/health/body-battery-inputs.ts`), which closes both the 00:00–01:00 and
  07:00–08:00 windows. Shipped.
- **Q-272** — #1521 landed the rebalance; its stated residue is `LA-134`, which exists as its own
  entry, so nothing is lost by removing the parent.
- **Q-3b** — both halves closed inside the entry: (a) tried and rejected, superseded by the awake-time
  fragmentation cap; (b) re-investigated and does not reproduce.
- **Q-112** — umbrella, children a–e all merged, and `/health/day` exists. Its `Needs: Q-112e` pointed
  at an entry already gone.

## The one that changed something else

Removing `LB-123` cleared `RV-79`'s `Needs:`, and `RV-79`'s body said in two places that no
`shouldCache` option exists. Left alone, the queue would have offered a buildable entry whose text
argues against building it. Both passages are corrected in place and the measurement under them is
kept — it is what justifies passing the predicate.

## Three entries whose own verdict is "don't build" became `Reference:`

`RV-77`, `Q-28` and `OR-137` each concluded, in their own bodies, that the change should not be made,
and each kept printing as work. `Reference:` is the field for an entry that exists to be read; the
reasoning is worth more than the queue slot it was occupying. `OR-137` says explicitly to revisit the
moment `feedback_submissions` is non-empty — the first real report is both the reason to build it and
the fixture to test it with.

## A scoring question that was invisible because it sat inside another entry

`TN-9` carries two halves under one owner sign-off. The check-in half has a chosen mechanism; the
`activityBalance` half offers two options and picks neither, which makes it a scoring change with no
proposal. Split out as **`OR-155`** with `Needs: OR-150`, per the rule that a decision buried in
another entry's body does not get routed. `TN-11` joins it on the same test, taking `OR-150` from
thirteen to fifteen.

## What could not be expressed, and was not faked

`RV-189` asked for `LA-134` to be parked. It cannot be. `next-item.js` parks on exactly three things
— an unmet `Needs:` naming another entry, a `Gate:` of `owner` or `device`, and the legacy prose
marker — and `LA-134`'s blocker is the **calendar**: its fit needs days that do not exist until
2026-10-04. Borrowing a field that names the wrong blocker would have made the queue read correctly
and mean something false, so the entry stays READY with the date stated at the top of its body, and
the gap is filed as **`OR-157`** (an `Until: YYYY-MM-DD` field that clears itself with no edit).

`OR-157` is deliberately not built here. It has exactly one live case, which is the honest argument
for waiting; the entry says to build it on the second case, or sooner if `LA-134` is picked up and
dropped once.

## Also

- **`TN-37`** was printing READY while its own step 3 says *"do not start without its own plan"* and
  no plan exists. Filed **`OR-156`** for the plan and pointed `TN-37`'s `Needs:` at it. The plan entry
  records the trap the sweep caught: skimming step 2 as "drop the reads" disables wear filtering on
  the HRV and RHR baselines.
- **`TN-53`** re-laned B → A. What is left is a diagnosis whose evidence points engine-side, and
  handing a surface lane an undiagnosed defect produces a guess at the render layer.
- **`Q-48`** re-laned A → O. Its migration halves shipped; what is left is planning.

## A trap hit while writing this

`OR-157` had to quote the legacy park marker to explain the gap, and quoting it **parked `OR-157`** —
the detector matches the glyph followed by the word within 40 characters. Same shape as the duplicate
`Lane:` field TN-63 caught twice. The entry now describes the marker instead of printing it.

## Verification

`pnpm check:rules` — **Ran 78 of 78**, all passed. `check-backlog-pointers` — OK, 485 entries, no
duplicates, no cycles, all `Needs:` targets known. Queue is **−127 lines** net despite three new
entries.

Nothing here touches product code, so no runtime surface was exercised and none needed to be.
