# Body Battery already passes the owner's acceptance test — recording it so nobody re-measures

**Date:** 2026-08-18 · **Branch:** `tuning/battery-range-clean` · **Agent:** Tuning 🎶
**Type:** docs-only — a clean result, no findings filed

The owner's acceptance test for a score is a **distribution**: *"days getting close to full and some
days being low"*. Sleep needed a recalibration to reach it and readiness was measured and found not to
need one. Body Battery had never been checked against it — the 2026-08-17 review was deliberately
partial after its replay failed validation, and it stopped at charge/drain rates.

Checked now, over 50 days of `claude_ro.body_battery_daily`:

| | value |
|---|---|
| mean end-of-day | 51.5 |
| sd | **29.2** |
| range | 0 – 100 |

| band | days | share |
|---|---|---|
| Charged (≥ 75) | 14 | 28% |
| Good (50–74) | 13 | 26% |
| Low (25–49) | 13 | 26% |
| Drained (< 25) | 10 | 20% |

**All four bands roughly evenly populated across the full range.** This is the one score in the app
that already looked like what the owner asked every score to look like, and the 75/50/25 thresholds
sit where they should for this distribution. No constant needs moving and nothing is filed.

Worth noting for contrast: this sd of 29.2 is more than double readiness's ~12, which is the pillar
that stayed narrow after Q-504's range calibration was refuted. The two are not comparable as
"recovery" numbers — that is Q-276's open question — but if anyone wonders what a well-spread pillar
looks like in this app, it is this one.

## Also checked, and it changes the earlier picture

The 2026-08-17 Body Battery review recorded a replay predicting 65/63 charge/drain against stored
values of 7/10, and published partial rather than fit a constant on a broken harness. The stored
values now read **mean charged 23.1, mean drained 36.0**, against a mean day span (`day_max − day_min`)
of **32.3** and a mean move from the anchor of **25.3** — i.e. charge and drain are now proportionate
to how far the battery actually travels in a day. Whatever produced the 7/10 figures is not what is
producing today's. **That is not a fix and is not recorded as one** — nobody changed the model in
response to that review, so this is an unexplained change in the data, exactly the shape the standing
rule says to write down as unexplained rather than closed.

## Recorded, not filed

Three of 50 days end at exactly **0** and one at exactly **100**, with four touching the floor
intraday. The level is clamped to 0–100, so a day whose model output goes below zero is
indistinguishable from one that lands exactly on it. The *displayed* answer is right either way
("Drained"), so this is information loss rather than a wrong number, and at 6% of days it is not worth
a queue entry. Noted so the next person measuring the low tail knows the floor is a clamp.

## Not exercised

Nothing on-device and no code changed. This is a distribution check only — **it says nothing about
whether the battery is *correct*** on any given day, only that its output uses the range and its bands
divide it sensibly. The charge/drain change above was not investigated; it is recorded as unexplained.
Every figure is the owner's (`claude_ro` is row-scoped), 50 days, pulled 2026-08-18.
