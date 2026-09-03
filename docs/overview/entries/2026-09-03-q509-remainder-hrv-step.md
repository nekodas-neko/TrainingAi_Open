# 2026-09-03 — Q-509's remainder is not a trend, and night HRV doubled at the re-key (LA-57)

**Branch:** `claude/la-q509-remainder` · docs-only, two production measurements.

## Q-509 — candidate 3's natural reading is refuted

After smoothing (0.487 h), bin occupancy (0.000 h) and window geometry (≈0.06 h), ~0.39 h of the
0.933 h gap remained, and the surviving explanation was candidate 3: *a real change over the six
weeks*. If that were it, the series would be moving. Over **58 BLE-era nights** it is flat — OLS
slope **−0.0055 h/night**, Pearson **r = −0.060** (r² = 0.004), halves 2.803 → 2.612 against a
per-night sd of ~1.59.

**This needed no reconstruction harness**, which is the transferable part: the previous two rounds
built one because they were asking about individual nights. A question about a *series* is answered
by two aggregate queries.

**Stated honestly: this does not refute candidate 3 outright.** A change that happened **at** the
re-key and then held would read flat too. What is excluded is a *gradual* six-week change, which is
what the phrase most naturally means.

## LA-57 — the inputs stepped, and only their presence was ever checked

Testing the step reading directly, `body_metrics` either side of 2026-07-07:

| era | n | mean RHR | mean HRV |
|---|---|---|---|
| Cloud | 14 | 65.7 bpm | **26.9 ms** |
| BLE | 59 | 53.8 bpm | **55.9 ms** |

Per night, pre-boundary HRV runs **20–39** and post-boundary **40–56**, with no return. A doubling
within days is a measurement-definition change, not physiology — and `CLAUDE.md` already names this
exact class (*"HRV used `Sdnn` instead of `Rmssd`"*).

**The RHR half is deliberately not claimed.** It was already falling through late June (70 → 61), so
some of that decline is plausibly real. Only the HRV step is sharp and coincident with the device
change.

**How it survived six weeks of looking at this area:** the 2026-08-18 BLE input-drift review checked
`hrv_avg_ms` for **presence** — 18/18 rows — and never for **scale**. A column populated on every
night looks healthy. That is the reusable lesson, and it is why LA-57 exists rather than a note.

**Why it matters past Q-509:** `hrv_avg_ms` feeds the readiness composite's `hrvBalance` and the
rolling personal baseline. A level shift is absorbed eventually, but for the weeks it took, a
Cloud-scaled baseline was compared against BLE-scaled inputs — systematically high HRV z-scores.
Whether that happened, and over how many nights, is the first thing LA-57 asks.

**And the fix is gated, deliberately.** Do not rescale BLE HRV to match Cloud without first deciding
which statistic is correct: RMSSD and SDNN are both legitimate, the defect is two scales behind one
column and one baseline. A rescale is also a rewrite of stored history.

## Effect on Q-509

Both standing prohibitions are **strengthened**: do not widen `MEDIAN_WINDOW`, do not move
`RECOVERY_INDEX_OPTIMAL_HOURS`. The entry's own title — *the input moved, not the physiology* — now
rests on a second independent measurement rather than the anchor-ratio argument alone.

## Limits

`claude_ro` is row-scoped to the owner, so this is one user. The Cloud arm is **14 nights** against
59, which is thin. The mechanism of the HRV step is **not** identified — this shows the step exists
and is coincident with the re-key, not which field or filter changed. Nothing was run on a device,
and no code changed.
