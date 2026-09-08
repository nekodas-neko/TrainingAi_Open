## 2026-09-08 — The vial and the dose calculator (OR-102b ①②)

**Branch:** `feat/or-102b-reta-tracker` · **Lane B** · PR #1007

### What shipped

A syringe control on any milligram-dosed supplement row opens a sheet holding both halves the owner
asked for: **the vial** (peptide mg, bac water mL, marks per mL) and **the dose** (mg in, units out).

Both show their working rather than only the answer — `10 mg ÷ 3 mL = 3.33 mg/mL`, then
`0.5 mg ÷ 3.33 mg/mL = 0.15 mL → 15 units`. A concentration cannot be checked from its result, and
these are the figures OR-102b verified against the owner's own third-party calculator. Also free from
the same numbers: how many doses of that size the vial holds, and a warning when one needs more than
the barrel can draw.

**The mg↔units arithmetic is not new here.** `@trainingai/shared/health/vial-dose` shipped with the
storage in OR-102a; this adds only the two questions it does not answer, and imports the rest.

### Two things the entry got wrong about its own code, found by looking

**"No data, no migration" was true of storage and not of the client.** OR-102a shipped the table, the
repository methods and the API routes, and no read path to the browser — no cache group, no
local-store getter. That nearly made this Lane A's. It resolved because `invalidateCache` deletes on
a **prefix** (`WHERE key LIKE 'prefix%'`) and the existing `invalidateSupplements()` clears the bare
prefix `supplements`, so a key named `supplements-vials:<id>` is already evicted by every supplement
write with no new group. That is written into the file, because renaming the key silently removes it.

**"A toast with Undo is the established pattern" was the same shape of claim in BF-132, and also
wrong.** Worth stating once: an entry's description of the code is a lead, not a fact.

### What is deliberately not built, and why each

**③ the dose on the day timeline** — its *write* already ships: the tick stamps `taken_at`
(`adapter.ts:6557`). What is missing is an event type in `app/api/day-timeline/route.ts`, which is an
`app/api/**` path this lane may not touch.

**④ the weight-response chip — blocked on the formula, not on data.** The series is reachable from
here: `store.getBodyMetrics(cutoff)` returns every local row with `weightKg`, which is the local-first
read this should use anyway. The estimator was written and tested — trailing 7-day means, a standard
error, the verdict withheld unless the whole 95% interval clears the band — and then **removed from
this PR**, because shipping it would have made a third kg/week estimator sitting beside two that
disagree. Its design is on OR-102b so it is not re-derived.

### The finding that came out of that: LB-67

`computeWeightRateKgPerWeek` fits against the **array index** and multiplies by 7 as if readings were
daily. Rows exist only on days with a metric, and the owner weighs in about three days in four:

| readings in a 14-day window | reported | true | overstated |
|---|---|---|---|
| 14 of 14 | −0.70 kg/wk | −0.70 | 1.00× |
| **10 of 14** (the owner's rate) | **−1.04 kg/wk** | −0.70 | **1.48×** |
| 6 of 14 | −1.76 kg/wk | −0.70 | 2.51× |

It is live, and it changes the sentence rather than the digits: past 1.0 kg/wk,
`evaluateWeightRateVsGoalBand` renders **"Faster than ideal pace"** on Health → Body for an ordinary
−0.70. **The fix already exists one directory away** — `adaptive-tdee.ts` fits against the day index
and its comment describes this exact failure — so the app carries two weekly-rate figures that
disagree by about 1.5×, on two screens. Lane A's, filed as LB-67.

### And LB-68, which cost two sessions before it was written down

`page.click()` and `touchscreen.tap()` do not reach the Nutrition day-tools buttons: no sheet through
**~18 retried taps over 90 s**, button focused, no page or console error. `el.click()` opens it in
50 ms. So the app is fine and Playwright's synthetic event is not arriving.

A session earlier the same day saw this on `End of Day`, found the same `el.click()` asymmetry, and
attributed it to a hand-rolled Playwright context. **It reproduces in the project's own harness**, so
that was wrong and the finding was dropped instead of filed. It is filed now, with the negative
results — `serviceWorkers: 'block'` and `storageState` both ruled out by direct comparison, and
`My Foods` on the same screen opening normally under synthetic input.

### Verification

`e2e/vial-dose-calculator.spec.ts` drives the real screen at 412 dp: create a milligram supplement,
the syringe control appears on its row, the sheet opens, both divisions render, 15 units renders, and
a 4 mg dose says it will not fit a 100-unit barrel. 12 unit tests pin the arithmetic and its refusals
— a vial with no water returns null rather than Infinity, a zero dose has no dose count.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green
· the new e2e green.

**Not exercised:** the S25, Samsung WebView, and — because the spec clicks through the DOM per LB-68
— **whether the syringe control is reachable by a finger**. That hit test is owed on the device, and
it is the one thing this spec deliberately cannot prove.

Minor bump — a new feature.
