# What "good" is, for every score component

**2026-10-05**, for #2331 (adaptive scoring, #2321). The owner asked that each component's 0–100
value be built from *"a lowest→highest value and an average scale of what's normal; then base that
against research of what's actually good"*. This sheet gives, for every component of Sleep,
Readiness and Activity:

- **Range**: what the measurement can plausibly be.
- **Research**: what an outcome-linked reference says is good, with its source.
- **Personal**: whether "good" can only mean "good for you".
- **Today's curve**: what `sleep-score.ts`, `readiness-composite.ts` and `activity-score.ts` do now
  (quoted in [`scoring-structure.md`](scoring-structure.md)).
- **Verdict**: keep, adjust, or demote.

## The rule this sheet arrives at

**Research decides where "good" is only where an outcome-linked threshold exists.** That holds for
sleep duration, sleep continuity, sleep regularity, steps, aerobic minutes and strength days.
**Everywhere else the honest reference is the person's own baseline**, because the measurement varies
too much between people for a population number to mean anything for one of them. Resting heart rate
is the clearest case: normal values span roughly 70 bpm between people, while one person's is stable.

So each component gets one of two kinds of curve:

| Kind | Anchors come from | Personal data's role |
|---|---|---|
| **Research-anchored** | the published threshold ("meets" ≈ 70, "excellent" ≈ 95–100) | none in the value; the baseline is still shown beside it |
| **Personal** | the person's own percentile in the baseline windows (§B of [`adaptive-scoring.md`](adaptive-scoring.md)) | it *is* the value |

Every verdict below that would change a score is a **tuning proposal, not a change**. Each must
report how many past days it moves before it ships, and the multiplier/value split (adaptive scoring)
is where it lands.

---

## Sleep

| Component (multiplier today) | Range | Research | Kind | Today's curve | Verdict |
|---|---|---|---|---|---|
| **Total sleep** (24) | 0–12 h | Adults: **7 h or more** regularly; no upper limit set, and over 9 h may be appropriate for some people [1] | Research | 7 h → 62, 8 h → 77, 9 h → 92, 10 h → 100 | **Adjust.** The curve keeps climbing to 10 h, which the research does not support. **7 h → ~70 (meets), plateau ~95–100 from 7.5–9 h, no penalty above 9 h.** |
| **Efficiency** (9) | 50–100 % | **At least 85 %** of time in bed asleep [2] | Research | 85 % → 50, 90 % → 68 | **Adjust.** 85 % is the "good" line, but today it scores 50. **85 % → ~70, 95 % → ~100.** |
| **Latency** (6) | 0–120 min | **30 min or less** is good [2]; the paper's table reportedly puts **15 min or less** in its clearest "good" band [2b] | Research | A U-curve: 14 min → 90, and falling asleep fast is penalised | **Adjust.** Score under 30 min as good, falling off past it. The fast-onset penalty has no support in the sleep-quality consensus [2]; demote it to a "notably fast for you" note rather than a score cut. |
| **Restfulness / awake** (9) | 0–50 % awake | **No more than one awakening** and **20 min or less awake** after first falling asleep [2] | Research + personal | Efficiency minus an awake-fraction penalty | **Keep**, plus the fragmentation cap, which already uses the personal baseline. |
| **REM** (10) | 0–3 h | **Little or no consensus** that REM amount marks good sleep [2]; ring staging also carries error | Personal | 2 h → 82, 3 h → 100 | **Demote.** Cut the multiplier and score against the personal baseline only. 10 points today rest on the weakest evidence in the model. |
| **Deep** (10) | 0–2.5 h | Same as REM [2] | Personal | 1.1 h → 77, 2 h → 100 | **Demote**, as REM. The shadow readiness model (version 2) takes this as written: deep + REM share is scored steady around the person's own 30-day normal, with no fixed range (issue 2635, 2026-10-07). |
| **Schedule / regularity** (8) | 0–4 h off | **Regularity predicts mortality more strongly than duration** in 60,977 UK Biobank adults [3] | Research | The worse of a late bedtime or an early wake vs habit | **Raise.** It is the best-evidenced sleep axis after duration. Consider the Sleep Regularity Index [3] as the measure. |
| **Timing** (6) | midpoint 0–24 h | No outcome-linked ideal clock time; chronotype varies | Personal | Midpoint vs a fixed 03:00 | **Demote or fold into regularity.** A fixed 03:00 ideal is one sleeper's chronotype. |
| **Overnight HRV** (14) | ~10–150 ms | Population short-term rMSSD spans roughly **19–75 ms** [4], too wide to say what is good for one person | Personal | Ratio to the 14-night median | **Keep as personal.** No research anchor exists. |
| **Overnight HR** (14) | 35–100 bpm | Normal resting HR differs by **up to 70 bpm** between people and is stable within one [5] | Personal | Ratio to the 14-night median | **Keep as personal.** |

**Net effect on Sleep:** weight moves away from the axes with no evidence (REM, deep, fixed timing)
and toward the ones with it (duration, continuity, regularity). The duration and efficiency curves
also stop being harsher than the research.

## Readiness

| Component (multiplier) | Research | Kind | Verdict |
|---|---|---|---|
| **Resting HR** (0.15) | Between-person spread is too wide for a population norm; within-person deviations carry the signal [5] | Personal | **Keep.** It is already a z-score against your baseline. |
| **HRV balance** (0.15) | As overnight HRV [4] | Personal | **Keep.** |
| **Temperature** (0.10) | Deviation from your own baseline; no population anchor gathered here | Personal | **Keep.** Already personal, and scored as closer-is-better. |
| **Previous night** (0.16) | Inherits Sleep's evidence | n/a | Follows the Sleep changes above. |
| **Sleep balance** (0.10) | Duration debt against the ≥ 7 h reference [1] | Research + personal | **Adjust.** Measure the debt against max(7 h, your norm), not your norm alone, so a habitually short sleeper is not told they are in balance. |
| **Recovery index** (0.09) | **No published norm found.** The 5-hour anchor is an unvalidated vendor-style constant, and a refit on BLE data lands at 3.31 h (#2260) | Personal | **Make personal.** Use your percentile, not a fixed 5 h. |
| **Check-in** (0.10) | Subjective; no norm applies | Personal | **Keep.** Also change missing-input handling (below). |
| **Activity terms** (0.09 + 0.06) | Inherit Activity's evidence | n/a | Follow Activity. |

**The missing-data rule matters more here than any curve.** Readiness turns a missing input into a
neutral 50, so a day without a check-in can never score above about 95
([`scoring-structure.md`](scoring-structure.md)). Store the score together with its coverage instead
(#2067).

## Activity

| Component (multiplier) | Research | Kind | Verdict |
|---|---|---|---|
| **Steps** (18) | All-cause mortality risk falls with steps and **levels off around 6,000–8,000 a day for adults 60 and over, and 8,000–10,000 for younger adults** [6] | Research | **Anchor the default goal there**: 8,000 → ~80, 10,000 → 100 under 60; a plateau past it, so more steps never read as needed. |
| **Zone minutes** (10) | **150–300 min moderate or 75–150 min vigorous a week**, or a combination [7], so a vigorous minute counts as two | Research | **Keep the weekly frame**: 150 equivalent minutes meets, 300 is excellent. This also settles part of #2198 (c). WHO counts vigorous double; the open question is only which HR zone is "vigorous". |
| **Strength sessions** (25) | Muscle strengthening **on 2 or more days a week** [7] | Research + goal | **Adjust.** 2 a week → ~70 (meets the guideline); your program's own weekly goal → 100. |
| **Strength volume** (20) | No guideline for tonnage | Personal goal | **Keep.** It is goal-anchored by design. |
| **Active energy** (15) | No guideline as such; overlaps steps and zone minutes | Personal goal | **Consider demoting.** It double-counts movement already scored twice. |
| **Move hours** (12) | Guidelines advise limiting sedentary time but set no hourly target [7] | Personal goal | **Keep**, as a sedentary-time proxy. |

---

## What this changes, and what it does not

- **Nothing changes yet.** Each "Adjust", "Raise" or "Demote" is a tuning proposal that lands
  through adaptive scoring step 3 (#2324): ported first, proven identical to today, then changed one
  multiplier or curve at a time with a days-moved report.
- **The biggest single finding:** about **20 of Sleep's 110 points (REM + deep)** rest on the axis
  the sleep-quality consensus could not agree marks good sleep [2]. Regularity, which has the
  strongest outcome evidence after duration [3], carries 8.
- **Not covered here:** body composition, Body Battery and the cat collection, which are not 0–100
  weighted scores; and anything needing the full text of a paper behind a paywall. Where a figure
  could only be found in a search summary and not confirmed from the source, it was left out. The
  exact REM and N3 percentages in [2] are one example.

## Sources

1. Watson NF et al. *Recommended Amount of Sleep for a Healthy Adult: A Joint Consensus Statement of
   the American Academy of Sleep Medicine and Sleep Research Society.* Sleep / J Clin Sleep Med, 2015.
   [aasm.org PDF](https://www.aasm.org/resources/pdf/adultsleepdurationconsensus.pdf) ·
   [PMC4434546](https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/)
2. Ohayon M et al. *National Sleep Foundation's sleep quality recommendations: first report.* Sleep
   Health, 2017;3(1). PMID 28346153. Consensus that latency, awakenings > 5 min, wake after sleep
   onset and efficiency are appropriate quality markers; less or no consensus on sleep architecture
   ([abstract, Europe PMC](https://europepmc.org/article/MED/28346153)). The four numeric markers are
   quoted from the NSF's own release:
   ["What is good quality sleep?"](https://www.eurekalert.org/news-releases/532436).
   2b. The 15-minute latency band, and an 85–94 % efficiency band, are as reported by
   [Healio](https://www.healio.com/news/primary-care/20170130/national-sleep-foundation-defines-what-makes-a-good-night-s-sleep)
   from the paper's tables; the full text was not readable here, so treat 2b as secondary.
3. Windred DP et al. *Sleep regularity is a stronger predictor of mortality risk than sleep
   duration: a prospective cohort study.* Sleep, 2024;47(1). 60,977 UK Biobank participants.
   [PMC10782489](https://pmc.ncbi.nlm.nih.gov/articles/PMC10782489/)
4. Nunan D et al. *A quantitative systematic review of normal values for short-term heart rate
   variability in healthy adults.* Pacing Clin Electrophysiol, 2010. 44 studies, 21,438 adults.
   [Semantic Scholar](https://www.semanticscholar.org/paper/A-Quantitative-Systematic-Review-of-Normal-Values-Nunan-Sandercock/a6af3a00bc11938a8883ed1a1e78b8e32d97ab86)
5. Quer G et al. *Inter- and intraindividual variability in daily resting heart rate…: retrospective,
   longitudinal cohort study of 92,457 adults.* PLOS ONE, 2020.
   [PMC7001906](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7001906/)
6. Paluch AE et al. *Daily steps and all-cause mortality: a meta-analysis of 15 international
   cohorts.* Lancet Public Health, 2022;7:e219–e228.
   [ScienceDaily summary](https://www.sciencedaily.com/releases/2022/03/220303112207.htm)
7. Bull FC et al. *World Health Organization 2020 guidelines on physical activity and sedentary
   behaviour.* Br J Sports Med, 2020. [PMC7719906](https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/)
