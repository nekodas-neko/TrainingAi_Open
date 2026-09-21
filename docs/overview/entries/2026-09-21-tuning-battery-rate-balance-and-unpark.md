# 2026-09-21 — the tuning queue had nothing reachable in it, and the battery fix I recommended was wrong

**Branch:** `tuning/battery-rate-balance-and-unpark` · **Agent:** Tuning · **Docs-only.**

A review of the tuning front, asked for by the owner. Two findings, one structural and one
substantive, plus four owner decisions.

## Structural: 52 tuning entries, zero reachable

`node scripts/next-item.js` put **none** of the 52 `TN-` entries in READY. The breakdown was 19
parked on a prose `⛔` marker, 12 on `Needs:`, 3 on `Gate:`, 13 under `KEEP`, 5 under `REFERENCE`.

The 19 are the interesting ones. `next-item.js` parks any entry containing `⛔` when no structured
field explains it, and the marker is doing two different jobs across the file: *"this entry cannot
start"* and *"do not implement it this way"*. Reading all 25 marker lines in those entries, **17 of
19 were the second kind** — "do not fix this by lowering the zone boundaries", "do not widen the mean
by counting part-logged days". Design guidance, parked as if it were a blocker. One (TN-3b) said in
its own text that the parking rationale no longer applied.

Converted those 25 lines to `⚠`, which the parser does not treat as a block. **READY went 6 → 21
overall, and Lane A's list went to 14 topped by tuning work.** Two entries stay parked because their
markers are real: TN-2 (the fit cannot run in the sandbox) and TN-33, which now carries a proper
`Gate: owner` instead of prose.

This is the same defect as yesterday's TN-51/TN-54 filing, one layer up — a queue tool nobody reads
the output of. The lesson is in the baton: run the tool after filing, read the bucket.

## Substantive: I recommended a Body Battery fix that measurement overturned

The owner approved *"replace the fixed charge threshold with a rolling 28-day p10 of waking HR"* on
my framing that the threshold sitting below his quietest waking hour was **the whole of** "it's
pretty much useless". Then I measured it, and it is not.

Time-weighted, binned in `Australia/Brisbane`, against production:

| date | mins below charge ceiling | of which awake | charge stored |
|---|---:|---:|---:|
| 2026-09-18 | 220 | 104 | **0** |
| 2026-09-19 | 255 | 55 | 5 |

**220 minutes below the ceiling produced zero charge.** Widening the ceiling to the quantile moves it
60.1 → 61 bpm and buys 2.8% → 3.7% of the day. It is not the lever, and TN-2 and TN-52 both frame the
problem as if it were.

Three multiplicative losses, measured rather than reasoned:
1. **Sleep is excluded** — `walkBodyBattery()` filters to `tsMs >= wakeTime`, so the longest low-HR
   stretch cannot charge. Whole-day vs waking-only, same formula: 12.7 → 6.1 on 2026-09-18.
2. **The charge ramp zeroes at the ceiling** — full rate only at or below resting HR, and the owner
   logs ~0 minutes below his own resting HR, which is near-tautological. Mean multiplier 0.30–0.50.
3. **`DRAIN_RATE` is 3× `CHARGE_RATE`**, on top of both.

Over 84 days: **mean charge 14.3/day, mean drain 44.1, net −29.8.** Ends at exactly zero on 24 days
and charges nothing at all on 17. That is a countdown, not a battery, and it is what the owner has
reported twice.

Filed as **TN-55** at the top of the queue: calibrate so a median day nets ≈ 0, fitting the three
levers jointly. Pass test is distributional — median net within ±5 of zero, days-at-zero under ~10%,
**and the day-to-day spread preserved**, because a fix that flattens every day to 50 has destroyed
the signal rather than calibrated it. TN-2 is marked superseded in its central claim; TN-52's
quantile is demoted from "the fix" to "worth having anyway" (it stops the ceiling drifting with
resting HR, which it did — 57.8 → 60.1 across the window).

## Also filed

**TN-56 — the replay endpoint.** TN-52 already called it *"the highest-leverage single item on the
tuning front"*, and it sat as a paragraph inside a `Reference:` entry, which prints under *read, do
not build*. Extracted as its own buildable entry: run a named scoring function across a parameter
bracket server-side, return the distribution, **write nothing**. It unblocks the 25 thresholds the
August sweep could not measure at all — 19 of them sleep-staging constants feeding readiness's
heaviest contributor.

## Owner decisions, 2026-09-21

- **Body Battery** — approved the direction; the mechanism is replaced by TN-55 per the above.
- **Baseline rebuild** — he will fire it. Clears TN-6's −16 pt penalty on 89% of days.
- **Titration** — *"dose will not change; but ideally it has a calibration period. Do what's best."*
  My call, written into the backlog protocol as the **calibration-period rule**: fit only on data
  from 21 days after the last dose change, require ≥28 days, and state the window's start date in the
  proposal. Self-referencing thresholds are exempt, which is the argument for preferring them.
- **Owner actions** — he took the `0x73` capture retrieval and declined the admin sitting and the
  three-week recovery log. The declines are recorded on their entries with the consequence stated:
  the stress branch (TN-16, TN-34, TN-21) stays blocked behind TN-33's unvalidated sign.

## Not exercised

Nothing runs — documentation and queue ordering only. `pnpm check:rules` **Ran 75 of 75**, all
passed. The production measurements are read-only queries through `/api/admin/db-query` and are
**row-scoped to the owner**, which is the right scope here since every claim is about his own data.
TN-55's proposal is **not** validated against a re-run of the model — the pass test names what a
correct fix looks like, and only an implementer with the replay path (TN-56) can confirm it.
