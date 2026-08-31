# 2026-08-31 — LA-44 was built by someone else while it sat in the queue, so the work became verifying the seam

**Branch:** `feat/dexa-correction-consumers` · **Lane A** · no code changed; docs plus an end-to-end
verification run.

LA-44 was taken off the queue to be built. Merging `main` first turned up **#681 — BF-71: the DEXA
and RMR routes shipped without a way in, so both tables were empty**, landed hours earlier by another
agent. It is the same finding and the same fix.

## Checked before striking, not assumed

BF-71 ships `app/more/clinical/` with `dexa-scan-form.tsx` and `measured-rmr-form.tsx`, reachable
from `profile-tab.tsx`, plus an e2e spec and a reachability test. Against what LA-44 specified:

| LA-44 asked for | BF-71 |
|---|---|
| the load-bearing DEXA fields (`scanned_on`, `pct_fat`, `weight_kg`, `fat_g`, `lean_plus_bmc_g`) | all of them, plus `leanG` and `totalBmcG` |
| the RMR fields `personalRmr` needs | `rmrKcal`, `ffmKgAtTest`, `measuredOn` |
| **no `bytea`** — do not start storing the source document | no file input anywhere in the flow |

Superseded, so the entry is removed with a note rather than reimplemented, per the rule that a plan
which no longer matches reality gets reconciled instead of forced through.

## The work that was actually left, and nobody had done it

BF-71 and BF-2 landed as separate, independently-green PRs. **Nothing verified the combination** —
which is the exact gap `main`'s own LB-31 entry describes: `ci.yml` has no `push: [main]` trigger, so
after several green PRs land together there is no signal that the whole is sound.

So the seam was run by hand: seed a scale reading, POST the payload BF-71's form builds, and read the
consumers with no other action.

| | before | after one scan | after a second |
|---|---|---|---|
| `energy-balance` → `restingBaseKcal` | 1832 | **1773** | — |
| `nutrition-goals/recommend` → calories | 1961 | **1889** | — |
| `body-metadata` → `bodyFatCorrected` | 25.3 | **28.5** | **27.9** |
| `bodyFatCalibration.offsetPct` | null | **3.2** (`pairCount` 1) | **2.6** (`pairCount` 2) |
| `body_metrics.body_fat_pct` | 25.3 | **25.3** | **25.3** |

**The second scan is the interesting row.** It re-derived the calibration with no entry step for the
pair — offset 3.2 → 2.6 as the mean of (28.5−25.3) and (27.0−25.0). That is the owner's own
refinement working: *"This value needs to be able to accept more (i.e another dexa scan later on) so
it can work together to build a correct filter."* It is also the property that justified deriving
pairs from `dexa_scans` × `body_metrics` rather than storing them — a stored pair would have needed
its own write, and nothing was going to make that write happen.

And the raw column is unchanged after all of it, which is the invariant the whole design rests on.

## What this does not settle

**No screen shows any of it (LA-45).** The Health card renders `bodyFat` — the raw 25.3 — while the
calorie goal is computed from 28.5. Everything above is true of the data and invisible in the app.

**Nothing here ran on the device.** BF-71's forms are a Lane B surface on the canonical runtime and
carry their own device-verification row; this session exercised the routes behind them, not the
screens.

**One pair is still one pair.** `pairCount: 2` above is a fixture, not the owner's history — they
have one real scan, so an offset and a ratio remain the same number until a second real DEXA exists.
