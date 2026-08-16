# 2026-08-13 — the HRV/HR baselines stop averaging away your own progress (Q-72, partial)

**Branch:** `fix/sleep-score-ceiling-contributors`

## What Q-72 asked for, and what measuring it actually found

Q-72 recorded that four Sleep Score contributors sit at their ceiling and dilute the six that
discriminate, and the owner chose to **re-tune those four**. Measuring it first changed the
diagnosis on two counts.

**It is three, not four.** Re-measured over 60 production nights: `latency` never reaches 100 on a
single night (0 of 48). Its range is 61–99 with sd 7.4 — compressed, but not pinned. The genuinely
stuck contributors are `hrv` (**40 of 44** nights at exactly 100) and `hr` (**36 of 44**), with
`schedule` third (26 of 52).

**The curves were never the problem — the baseline was.** `sleepScoreBaselines` computed `hrv` and
`hr` as a plain **mean over every prior night**, an expanding all-time window. Against the owner's
real history that is structurally unable to work:

| | first 10 nights | last 10 nights | all-time mean |
|---|---|---|---|
| overnight HRV | 24.8 ms | **62.7 ms** | 47.2 ms |
| average HR | 74.0 bpm | **60.2 bpm** | 66.1 bpm |

That is a large, genuine multi-month improvement. Measured against the all-time mean, every recent
night scored **1.3–1.8×** better than baseline — far past `HRV_RATIO`'s 1.1 ceiling — so it pinned
at 100. The harder someone improves, the more completely an all-time baseline pins. Re-tuning the
curves would have compressed them to manufacture spread around a baseline that is simply wrong.

## The fix

`hrv` and `hr` baselines now use a **14-night trailing median** (`SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS`).
A recent window is also what the comparable products use — Oura's HRV balance, Whoop's and Garmin's
baselines — none of them average your whole history. Median rather than mean so one illness or
travel night moves the norm slightly instead of resetting it.

Window size was chosen by measurement, not taste:

| window | `hrv` sd | `hrv` pinned | `hr` sd | `hr` pinned |
|---|---|---|---|---|
| all-time mean (before) | 5.2 | 40/44 | 6.9 | 36/44 |
| 28-night mean | 6.8 | 35/44 | 8.4 | 31/44 |
| 21-night median | 10.3 | 31/44 | 11.0 | 28/44 |
| **14-night median** | **12.9** | **25/44** | **14.3** | **24/44** |
| 10-night median | 14.5 | 22/44 | 14.6 | 15/44 |

14 nights doubles the spread while keeping two full weeks of evidence behind the norm; 10 buys
little more at the cost of a noisier baseline.

`hrv` and `hr` move from the two *least* discriminating contributors to among the most. The owner's
worst-rated night of the record drops **78 → 71**, further clear of the pack.

## What this does NOT do, stated plainly

**It does not make the score agree with how the owner felt** — which is what Q-72 set out to fix.
Correlation with their own morning rating moved **−0.220 → −0.226**. That is noise, not progress.
Overall score sd is unchanged at 10.1.

**And the correlation target is not trustworthy as an acceptance criterion.** Of 39 rated nights,
**33 are a "2" or a "3"** — only 6 sit at the extremes (two 1s, three 4s, one 5). Correlation
against a target with that little variance cannot move much regardless of the model. Q-72 treats
r = −0.354 (measured on 32 nights) as its headline; on 60 nights it reads −0.220 before any change.
Whatever closes Q-72 needs a better yardstick than this.

So Q-72 **stays open**, with the diagnosis corrected and this measurement recorded. The owner chose
to ship the baseline fix on its own merits after seeing exactly these numbers.

## The test suite could not see this change at all

Reverting the baseline to an all-time mean broke **zero** tests. Every existing baseline test used
identical nights (all HRV 50, HR 60), where a mean and a rolling median are the same number. Four
new cases drift the input, which is the only shape that separates them, and each was verified by
mutation:

| mutation | failing tests |
|---|---|
| revert to the all-time expanding window | 3 |
| revert median → mean | 1 — *"one bad night moves the norm barely at all"* |
| widen the window to 60 nights | 2 |

One of those tests failed on its first draft **for the right reason**: it asserted a night at HRV 74
should not pin, when 74 against a recent median of 63 genuinely *is* an above-norm night that should
score 100. Corrected to use a night at the norm, and the test now also asserts that the same night
pinned under the old baseline — the regression stated rather than described.

## Not exercised

- **Not verified on device.** Nothing native or safe-area changed; the Sleep Score is server-computed
  and rendered from the payload.
- **Only the owner's own history was measured.** Every figure here comes from the `claude_ro` views,
  which are row-scoped to one account — these are not system-wide claims, and a user whose HRV is
  flat rather than improving would see almost no change from this.
- **`schedule` was left alone** despite also pinning (26 of 52). Its baseline is a circular mean of
  habitual bed/wake times, where a long-run window is more defensible than it is for autonomic state.
  Whether it needs the same treatment is visible in the numbers above and belongs to whatever closes
  Q-72.
- **Production was intermittently returning 502s** while this data was pulled (the same DB
  connection-timeout pattern visible in `error_events`). The dataset was fetched on a retry that
  succeeded; nothing here depends on production being healthy.
