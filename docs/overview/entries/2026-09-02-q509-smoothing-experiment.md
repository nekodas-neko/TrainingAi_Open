## 2026-09-02 — Q-509's pre-registered experiment was run, and it failed its own pass test (Q-509, plus six gates the queue could not see)

**Branch:** `claude/la-q289` · **Lane:** A · **No version bump** — a measurement and queue fields;
no runtime code and no scoring constant changed.

### Getting to the work item took a triage nobody should have to repeat

Lane A's READY head was **Q-289**, whose own Lane bullet reads *"it is a SCORING change, so the route
is Tuning proposes → owner signs off → Lane A implements — **not an implementer's to take at all**."*

Checking the rest of the head of the queue: **all nine top entries carried neither a `Gate:` nor a
`Needs:` field**, and six of them state a real block in prose. This is the class LA-55 fixed for
Q-388 that morning; the fix was one entry, the class was not.

Fields added, each from the entry's own words — **not a blanket park**, which is the failure mode
BF-90 measured (a third of the parked queue was work nobody was blocked on):

| entry | field | why |
|---|---|---|
| Q-289 | `Gate: owner` + `Needs: Q-290` | scoring change; "Depends on Q-290" was prose |
| Q-290 | `Gate: owner` | scoring question, Tuning proposes |
| Q-275 | `Gate: owner` | adding a readiness input re-scores every day |
| Q-272 | `Gate: owner` | Body Battery model change re-scores every day |
| Q-505 | `Needs: Q-523` | "Depends on Q-523 landing first" was prose |
| Q-508 | `Gate: owner` | first action needs a decision "this repo cannot settle" |

**Q-509, Q-510 and Q-511 were deliberately left alone** — Q-509 says outright it is *"a `devices`
finding by the readiness code's own pre-registered rule, **not** a scoring change"*, and the other
two are instrumentation. Lane A's head is now Q-509, which is genuinely startable.

**The duplicate-id trap bit again**, exactly as it did on BF-94 in LA-55: writing `- **Needs:** Q-523
— was prose ("Depends on Q-523…")` makes the parser read the id twice, because it takes every id on
a `Needs:` line. The id goes on the field line; the explanation goes on its own bullet.

### The experiment

Q-509 pre-registered a pass test: *smooth the BLE series to Cloud-like noise before the argmin and
re-measure the ratio — if it goes to ~1.0 the estimator is fine and the input needed conditioning.*

**It reaches 0.875.** Smoothing recovers **0.487 h of the 0.933 h gap (52%)** at its best width
(median window 21), then plateaus and reverses. Full measurement:
[`docs/reviews/2026-09-02-recovery-index-ble-smoothing-experiment.md`](../../reviews/2026-09-02-recovery-index-ble-smoothing-experiment.md).

So the hypothesis is **half right**: the input did need conditioning, and conditioning it cannot
carry the whole level shift. **Do not ship a wider `MEDIAN_WINDOW` as the fix** — it fails the
entry's own test, and window 21 over 5-minute bins is a 105-minute median that would flatten real
overnight structure to buy back half a defect. `RECOVERY_INDEX_OPTIMAL_HOURS` still must not move.

**The mean shift is 4× the median (0.487 vs 0.167).** That is the signature of a minority of nights
where a spurious late dip beat the true early minimum — it supports the proposed mechanism while
showing it is not the whole story.

**Re-confirmed on the way in:** n is now **57** nights at mean **2.653 h** against the entry's 2.657
at n=42 — fifteen more nights moved it by 0.004 h — and median |Δbpm| reproduces at exactly **2.00**.

### Two things I got wrong, and how they were caught

**The first reconstruction mixed in the chest strap.** `oura_heartrate` holds **66,189
`chest_strap` rows against 16,640 `ble`** in the BLE era, and the first pull took both — Polar H10
workout HR inside overnight series. Filtering to `source = 'ble'` moved the mean only 4.36 → 4.27 h,
so it was not the cause of anything, but an unfiltered read of that table is a live trap.
**Checked, and no production code has it**: the comparison harness filters explicitly, `hr-day`
returns `source` per row, and the unfiltered `getOuraHeartrate` has no caller outside its own test.
No finding filed, because there is nothing there.

**The reconstruction still does not reproduce the shipped absolute level** — 4.27 h against the
stored 2.653 h, because the rollup bins decoded `hr_bpm` inside its own detected night window while
this bins `oura_heartrate` inside `sleep_sessions`. Rather than publish a ratio off a baseline that
does not match, the result is reported as the **absolute shift in settle time**, which a constant
wake-time offset cancels out of. The caveat is stated in the review rather than buried.

### What is still owed

Roughly half the level shift is unexplained. The review names the three candidates it could not
separate: era-dependent night-window detection, bin occupancy (a bin with one beat is averaged like
a bin with forty), and a genuine behavioural change across the six weeks between the two fits —
which Q-509's own caveat already declines to exclude.
