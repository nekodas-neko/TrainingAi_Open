# 2026-08-25 — the threshold sweep: one finding, one cleared, and a screen that cannot see its own blind spot

*Tuning · docs-only · branch `tuning/threshold-sweep`*

The owner asked for a sweep of the scoring thresholds on the grounds that there is now enough history
to give a real range. Motivation: every threshold anyone had investigated turned out to have a broken
*input* rather than a wrong constant — Q-506, Q-512, Q-514, TN-6, four for four — and nobody had
checked the rest.

**Scope:** 246 numeric constants across the scoring surface → 42 plausibility/structural guards, 8
maturity gates, 196 candidates → **27 that decide a user-visible branch**. Plus a distribution screen
over 86 stored output columns.

**One new finding, TN-8.** `chronic-stress-assembly.ts:72` feeds `TEMP_DEV_FEVER_LIMIT_C = 1.0` as the
per-night fever baseline, and its comment promises the limit is *"set high enough that a healthy night
is never masked"*. Measured: `temp_dev_c > 1.0` on **6 of 34 nights (17.6%)**, and the owner has not
been sick in 50+ days. Same 0.363 °C baseline offset as TN-6 and BF-13 — which makes this a **fourth**
consumer of that baseline, on top of the three BF-13 counted, and the only one that leaves no trace.
**It is not currently starving the 21-night gate** (3 of 29 in the trailing window, leaving 26), so it
is filed as a plausible contributor to TN-1 and explicitly not as its cause.

**One threshold cleared.** `EARLY_DELOAD_SCORE_MAX = 45` fires on **2 of 41 days (4.9%)** — healthy
for an early-warning trigger, deliberately not filed. That matters beyond the constant: there are two
deload paths, and the other one (`TEMP_ALERT_THRESHOLD_C`, 68% of nights) is the whole of the owner's
complaint. **Confirms BF-13's attribution instead of adding a second cause.**

**Two method rules, both earned by being wrong first.** A distribution screen is **blind to "always
fires"** — run against the two known failures it catches neither, because `temp_dev_c` has a
healthy-looking range and `illness_score` looks merely sparse. And **coverage must be measured on a
recent window**: `oura_daily_derived` holds pre-BLE rows back to 2026-05, so whole-history coverage
reads 29–49% and looks like a live defect when August is 100%.

**What it did not find is also the result.** No new stuck, dead or saturated score — every
DEAD/STUCK column maps to a filed entry (Q-7b, Q-270, Q-525, Q-510, Q-508). The queue is
comprehensive on that class, and the four-for-four record that motivated the sweep held for the
*investigated* thresholds without generalising. One finding from 27 is the honest return; it was
worth running because that one is invisible from every user-facing surface.

Left for a session that can run the pipeline: ~13 thresholds whose inputs are per-sample
intermediates nothing persists (sleep staging, `MET_ACTIVE_THRESHOLD`, `APNEA_THRESHOLD`,
`NIGHT_BAND_*`) — the same shape as TN-3a's discarded stress buckets.

Review: [`docs/reviews/2026-08-25-threshold-sweep.md`](../../reviews/2026-08-25-threshold-sweep.md).

**Not exercised:** no code ran — SQL against production plus source reading. The fever mask was read
from source and its input measured; the model was not executed.
