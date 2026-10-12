# Evidence for metric links

_Research note written 2026-10-12 for [`metric-links.md`](../architecture/metric-links.md). Read-only
research: nothing was run on a device, and no production data was used. It builds on
[`2026-10-12-readiness-metric-evidence.md`](2026-10-12-readiness-metric-evidence.md) (called "the
evidence note" below) and [`scoring-layers-and-data-inputs.md`](../architecture/scoring-layers-and-data-inputs.md).
The D-numbers here are this note's own; `metric-links.md` renumbers them in its catalogue._

**How citations were checked.** Every PMID below was looked up through NCBI E-utilities
(esearch, esummary, efetch) on 2026-10-12, and the abstract was read. Two sets of numbers come from
the open full text on PMC and say so: Leota 2025 and Pietilä 2018. Citations marked *(EN)* were
verified in the evidence note; here I only looked up their PMIDs. Numbers marked *(derived)* are my
arithmetic. Thresholds marked *(mine)* are proposals, not published cut-offs.

---

## Summary

Of the 30 links below, six are strong and specific enough to change how a score is read.
**Menstrual-cycle phase** shifts the normal for temperature, resting HR, HRV and breathing rate.
**A sustained energy deficit** lowers resting HR, so a falling RHR during a diet is not a fitness
gain. **A short night** cuts next-day performance by about 7.6% and raises effort ratings, so sleep
can fairly count toward training capacity. It also makes the next night's extra deep sleep and REM an
expected rebound, not a bonus. **Illness signals in combination** (temperature, breathing, resting HR,
HRV) beat any single one and justify a ceiling. **The HRV–RHR pattern over 7 days** beats any single
night. Hard training, late hard exercise, alcohol, caffeine, psychological stress, late meals, heat,
light and melatonin are real effects. They should only **explain** a score, because their effects
already land in HRV, RHR and sleep, which the app measures. Weighting them would count them twice.
The links are weak, or there is no daily link, for steps → that night's sleep, protein → next-day
recovery, everyday mild dehydration → HRV, and monotony → illness. Five common beliefs are **myths or
overstated**. Alcohol does not improve sleep: it cuts REM even at about two drinks. Evening exercise
does not ruin sleep in general; only hard sessions ending within roughly 1–4 h of sleep do. Protein
does not reduce next-day soreness. A hard day does not greatly raise deep-sleep need; the measured
gain is about 1 percentage point. Higher HRV is not always better: overreached endurance athletes
show higher HRV and lower RHR. Two more do not hold up: daily weight change is not fat change, and a
lifting session does not give a usable daily HR-recovery reading (evidence note). For validation, the
best target is the self-rated fatigue item. HRV-guided training gives only a small benefit
(g ≈ 0.2–0.4, often not significant for performance), so readiness should not be sold as a large
performance lever.

## How to decide what a link may do (rules used in the table)

These are reasoning, not citations. They follow from the evidence below.

1. **A behaviour that acts through measured physiology explains; it does not score.** Alcohol,
   caffeine, late exercise, meals and stress show up in tonight's HRV, RHR and sleep. A weight on
   the behaviour as well counts it twice. Use it to explain, and to predict tomorrow.
2. **Context that changes what "normal" means adjusts the band or the normal, not the points.**
   Examples are cycle phase, a sustained deficit, sleep debt before a recovery night, and a smoothed
   weight trend.
3. **A score may SHARE into a second pillar only when it predicts a different outcome there.** Short
   sleep predicts lower training performance and higher RPE (an Activity outcome), separately from
   sleep health. Never share in a loop. For example, stress → sleep → stress is bidirectional (Yap
   2020), so pick one direction.
4. **A combination becomes a FLAG only when it beats its parts.** That holds for illness (sensors
   plus symptoms beat symptoms alone; temperature adds AUC). For overreaching, the evidence is weak.
5. **Personal links are learned within each person, with a lag.** Every study here that found a
   daily link compared each person with their own nights (Pietilä, Yap, Fang, Wang). The app's
   "how X affects you" engine should do the same, and say nothing until it has enough exposed and
   unexposed days. I suggest ≥ 10 of each *(mine)*.
6. **Every link carries a lag window:** same night (alcohol, caffeine, late exercise, meals,
   stress), 24–72 h (a training session), weekly (load, regularity, deficit), or months (HR
   dipping, fitness).

---

## Link table

Use: SHARE = also counts in another pillar · ADJUST = shifts another score's normal or band ·
EXPLAIN = explains only · FLAG = part of a red-flag combination · VALIDATE = an outcome to tune
against · DERIVE = combine into a new metric · NONE. Where a link has a second use, the notes say so.

| # | From → To | Direction | Lag | Effect size | Strength | Population | Citations | Use |
|---|---|---|---|---|---|---|---|---|
| 1 | Hard training day → that night's HRV, RHR, next morning | HRV ↓, RHR ↑; may overshoot above baseline at 48–72 h | Same night to 72 h | Marathon: nocturnal RMSSD 55%, HR 130% of rest day; moderate run 87% / 109%. Aerobic recovery ≤24 h (easy), 24–48 h (threshold), ≥48 h (high intensity) | Moderate–strong | Active men; athletes; small n | PMID 20419617; 23912805; 21667290; 21273908 | EXPLAIN |
| 2 | Training load → sleep duration, deep sleep, sleep need | Acute: small ↑ in TST, SWS. Overreaching: TST, efficiency ↓ | Same night; weeks | SWS +1.3 pp after evening exercise; overreached: TST −7.9%, efficiency −1.6% | Strong that acute effect is small; weak for "need" | Healthy adults; trained triathletes | PMID 25596964; 9178916; 24091995 | FLAG |
| 3 | Vigorous exercise ≤1–4 h before bed → latency, TST, overnight HR/HRV | Later onset, shorter TST, RHR ↑, HRV ↓ | Same night | Maximal vs light, ending 2 h before usual onset: +36 min onset, −22 min TST, +3.9 bpm, −14% HRV. None if ending ≥4 h before | Moderate–strong | 14,689 WHOOP users; healthy adults (meta) | PMID 40234380; 30374942; 34416428 | EXPLAIN |
| 4 | Daily steps → that night's sleep efficiency | No consistent within-person daily link; chronic exercise helps | Same night (none); months | Daily: small, mixed direction. Regular exercise: small TST/efficiency gains | Weak (daily); moderate (chronic) | Adults, 33 studies | PMID 33571893; 25596964 | NONE |
| 5 | Late or large evening meal → nocturnal HR/HRV, latency, efficiency | Mixed; large dinner lowers parasympathetic index; 1 h vs 5 h dinner no stage change | Same night | Eating ≤3 h before bed: OR 1.61 for night waking; HF/TP 41.7 vs 45.0 | Weak / contested | Students; small crossovers | PMID 32295235; 29894762; 34017207 | EXPLAIN |
| 6 | Caffeine dose and timing → latency, TST, deep sleep, HRV | Latency ↑, TST ↓, deep ↓; HRV weakly ↓ | Same night | TST −45 min, efficiency −7%; 400 mg within 12 h disrupts; 100 mg at 4 h no effect | Strong (sleep); weak (HRV) | Healthy adults; young men | PMID 36870101; 39377163; 24235903 | EXPLAIN |
| 7 | Alcohol dose → overnight HRV, RHR, REM, next day | HR ↑, RMSSD ↓, REM ↓, early deep ↑ | Same night; next day | ≤0.25 / 0.25–0.75 / >0.75 g/kg: HR +1.4 / +4.0 / +8.7 bpm, RMSSD −2.0 / −5.7 / −12.9 ms | Strong | 4,098 employees; 27 lab studies | PMID 29549064; 39631226; 21848959 | EXPLAIN |
| 8 | Energy deficit → RHR, HRV, sleep, performance | Diet deficit lowers RHR; chronic: hormones, mood, strength ↓ | 24 h; weeks | 24 h diet LEA: overnight HR −4 bpm, HRV unchanged. Contest diet: HR 53 → 27 bpm (case) | Moderate (chronic); weak (acute) | Cyclists; physique athletes | PMID 40523229; 36645885; 23412685 | ADJUST |
| 9 | Protein intake → next-day recovery, soreness | No effect on soreness; small strength preservation | 24–96 h | Isometric strength at 96 h g = 0.56; soreness: none | Weak; myth for soreness | Resistance-trained, 29 studies | PMID 36513777; 41433039 | NONE |
| 10 | Dehydration → RHR, HRV | HR ↑, HRV ↓ only after large losses | Hours | −3.4% body mass: HRV ↓ at 4 h if not rehydrated. 16 h water deprivation: no autonomic change | Weak (everyday levels) | Athletes; young adults | PMID 25726222; 14561843; 31617739 | EXPLAIN |
| 11 | Daytime psychological stress → that night's HRV, latency | HRV ↓; efficiency ↓; deep-sleep onset later | Same night; bidirectional next day | Efficiency 81.0% vs 85.2%; stage-3 latency 33.9 vs 18.3 min | Moderate | Healthy adults; 326 young adults | PMID 29486547; 14747638; 17884278; 31608395 | EXPLAIN |
| 12 | Short sleep → next-day performance, RPE, mood, appetite, HRV, injury | All worse | Next day; chronic for injury | Performance −7.6%; RPE SMD +0.39; positive mood g −0.94; intake +385 kcal; RMSSD ↓; injury OR 1.58 | Strong (performance, mood); moderate (RPE, appetite, HRV); weak (injury) | Mostly young men; adolescents for injury | PMID 35708888; 40236824; 33367799; 27804960; 40895095; 30888337 | SHARE |
| 13 | Sleep irregularity, social jet lag → HRV, mood, performance | Mood ↓; nocturnal vagal HRV ↓; performance unclear | Next day; weekly | Within person, steadier TST and wake time → better next-day mood. Midpoint deviation: −0.016 lnRMSSD per 30 min | Moderate (mood); weak (HRV, performance) | 2,115 interns; students; athletes | PMID 33603132; 30722058; 31555086; 42845805 | DERIVE |
| 14 | HRV and RHR together; 7-day lnRMSSD and its CV | Pattern matters more than one night; HRV can rise in overreaching | Weekly | ≥3 nights/week match 7. CV fall in weeks 1–3 vs fitness gain r = −0.74 | Moderate | Endurance athletes; female soccer | PMID 22367011; 24136138; 24334285; 26200192 | DERIVE |
| 15 | Temperature + breathing + RHR + HRV together → illness | Combination beats single channels | 1–3 days before symptoms | Alerts in 80% of infections, median 3 days early. Sensors + symptoms AUC 0.80 vs symptoms 0.71 | Moderate | Large wearable cohorts; challenge studies | PMID 34845389; 33122860; 34586364; EN: 35236896 | FLAG |
| 16 | Menstrual-cycle phase → temperature, RHR, HRV, breathing, sleep | Luteal: temp ↑, RHR ↑, HRV ↓, RR ↑ | Cycle phase | Late luteal: +0.45 °C, ~+4 bpm, ~+0.5 br/min; HRV d = −0.39 | Strong | Naturally cycling women | EN: PMID 31726666; 30998226; 31783840 | ADJUST |
| 17 | Training monotony and strain → illness, overreaching | Higher strain → more illness | Weeks | "High percentage" of illnesses beyond personal strain thresholds | Weak | Small athlete groups, one lab | PMID 9662690; 24624008; 14636112 | DERIVE |
| 18 | Session RPE × minutes as one load for lifting and cardio | Valid across modes | Per session | Resistance training ICC 0.88; 36 validation studies | Strong | Athletes and adults | PMID 11708692; 15142026; 29163016 | DERIVE |
| 19 | Subjective wellness ↔ HRV/RHR; which to validate against | Fatigue tracks load best; HRV agrees moderately | Daily | Fatigue vs load r = −0.51; lnRMSSD r = −0.24; HRR, soreness ≈ 0 | Moderate–strong | Athletes, 56 studies | PMID 26423706; 25710257; 30208575 | VALIDATE |
| 20 | HRV-guided training → outcomes | Small benefit; fewer non-responders | Weeks | VO₂max ES 0.40 (HRV) vs smaller in control; performance g 0.08–0.20, not significant | Moderate | Endurance only; no lifting RCTs found | PMID 33143175; 34489178; 34639599; 17849143 | VALIDATE |
| 21 | Nocturnal HR dip (day vs night HR) → long-term health | Blunted dip → higher mortality | Years | Lowest vs highest dip decile HR 2.67; night HR alone predicts CV events HR 1.17 | Moderate (long-term only) | Clinical ABPM; 55–75 y | PMID 17954807; 23306958 | DERIVE |
| 22 | Hot nights → sleep, HR | Wake ↑, deep and REM ↓, sleep loss | Same night | Higher night temperature → more reported insufficient sleep | Moderate (observational) | General population | PMID 38598988; 28560320; 22738673 | EXPLAIN |
| 23 | Day-to-day weight → hydration, glycogen noise | Daily swings are water and gut content | Days | Daily SD 0.51 kg (CV 0.66%); ≥3 g water per g glycogen | Strong (physiology) | Active men; dieters | PMID 15673099; 25911631; 24504358 | ADJUST |
| 24 | Daylight and evening light → sleep timing, quality | Early/bright light → earlier clock, more deep sleep; evening screens → latency ↑ | Same day; weeks | Later light explained 47% of variance in clock timing | Moderate (timing); weak (next night) | Healthy adults | PMID 29040758; 25535358; EN: 34488088 | EXPLAIN |
| 25 | Sleep debt → next night's deep, REM, latency (added) | Rebound: SWS ↑, REM ↑, latency ↓ | Next 1–2 nights | After 2 nights of 4 h: SWS up night 1, REM up nights 1–2 | Strong (lab physiology) | Young adults | PMID 1693894; 26762182 | ADJUST |
| 26 | Alcohol, stress, travel → false illness alerts (added) | Trigger alerts without infection | Same night | 1.15 alert days per person vs 3.42 in COVID cases | Moderate | 3,318 smartwatch users | PMID 34845389 | FLAG |
| 27 | Melatonin (supplement log) → latency, TST (added) | Latency ↓, TST ↑, modest | Same night | Latency −7.1 min, TST +8.3 min | Strong that it is modest | Primary sleep disorders | PMID 23691095 | EXPLAIN |
| 28 | Daytime nap → same-day fatigue, RPE (added) | Fatigue ↓, RPE ↓ after normal sleep; no effect after deprivation | Same day | Fatigue SMD 0.91; RPE during exercise SMD 1.62 | Low certainty (moderate for RPE) | Active people, 35 studies | PMID 41668951 | EXPLAIN |
| 29 | Acute respiratory illness → training performance (added) | Performance ↓, training load ↓ | Days–weeks | Acute decrements in 4 studies; endurance little changed when mild | Weak–moderate | Athletes, 17 studies | PMID 35695464 | FLAG |
| 30 | Sleep ↔ next-day stress and mood (added) | Bidirectional | Next day | Short TST → higher next-day stress (within person) | Moderate | Young adults; diary studies | PMID 31608395; 30404728 | VALIDATE |

---

## Notes per link

**1. Hard training → night HRV/RHR.** Hynynen 2010 (10 active men): nocturnal RMSSD fell to
87 ± 10% of the rest-day value after a moderate run and 55 ± 16% after a marathon. HR rose to
109% and 130%. Myllymäki 2012 (14 men, runs at 6 pm): higher intensity raised nocturnal HR but not
HRV; only 90 min of running lowered HRV; sleep quality did not change. Stanley 2013 (review): full
recovery takes up to 24 h after easy work, 24–48 h after threshold work and ≥ 48 h after high
intensity, and is faster in fitter people. Strength work differs. Acute resistance exercise lowers
vagal modulation more than aerobic work (Kingsley 2016). In 7 weightlifters after a 2-h session,
HF-HRV and lifting performance were both down at 3 h, back at 24 h and above baseline at 48–72 h,
while soreness stayed high for 72 h (Chen 2011). HRV tracked performance, not soreness. Wang 2026
(54 students, 1,232 mornings): each 100 AU of sRPE load above usual gave −0.0089 lnRMSSD next
morning. That is a single new study. **Use:** EXPLAIN, not ADJUST. A dip after hard work is real
reduced readiness; it is exactly what HRV-guided training acts on. The useful derived signal is
the dip that the logged load does *not* explain (D3).

**2. Load → sleep.** Kredlow 2015 (66 studies): acute exercise has small benefits for TST, latency,
efficiency and SWS. Youngstedt 1997: effects of 0.18–0.52 SD. Stutz 2019: evening exercise gave SWS
+1.3 pp. So "a hard day needs much more deep sleep" is overstated. Overreaching works the other
way. In Hausswirth 2014, only the 9 functionally overreached triathletes lost sleep (TST −7.9%,
efficiency −1.6%, immobile time −7.6%), and 67% of them reported URTI against 11% of controls. Sleep
need: elite athletes *say* they need 8.3 h and get 6.7 h (Sargent 2021). No study found measured
extra need per unit of load. **Use:** FLAG, as one part of an overreaching watch (D15). Don't
raise the duration band on hard days.

**3. Late vigorous exercise.** Two meta-analyses agree that evening exercise does not harm sleep
overall. Stutz 2019 (23 studies): REM latency +7.7 min, SWS +1.3 pp, but latency, TST and efficiency
may suffer after vigorous exercise ending ≤ 1 h before bed. Frimpong 2021 (15 studies, 194 people):
high-intensity exercise ending 0.5–4 h before bed reduced REM by 2.34% and changed nothing else. Leota
2025 (WHOOP, 4.08 M nights; PMC full text) found a timing × strain gradient. Maximal against light
exercise ending 2 h before habitual sleep onset: onset +36 min, TST −22 min, RHR +3.9 bpm, HRV
−14.1%. Ending 2 h after habitual onset: +80 min, −43 min, +9.4 bpm, −32.6%. Exercise ending
≥ 4 h before sleep onset showed no association. The cohort is observational, and two authors work
for WHOOP. **Use:** EXPLAIN (D4). Myth: "evening exercise ruins sleep" in general.

**4. Steps → sleep.** Atoui 2021 (33 studies) found no bidirectional daily link. Sleep quality,
efficiency and WASO predicted next-day activity weakly, and a more active day went with slightly
*shorter* sleep between people. Regular exercise improves sleep over weeks (Kredlow 2015). **Use:**
NONE for a daily link. Steps already score in Activity.

**5. Late meals.** The evidence is thin and conflicting. Chung 2020 (793 students, survey): eating
within 3 h of bed → nocturnal waking OR 1.61 (1.43 adjusted); no link to latency > 30 min or short
sleep. Crispim 2011 (52, PSG): late fat and calorie intake correlated with worse latency and
efficiency in women. Duan 2021 (20, crossover, PSG): dinner 1 h vs 5 h before bed did not change
sleep stages, and delta power was higher early in the night. Tada 2018 (24 women, crossover): a
dinner holding half the day's energy lowered the nocturnal parasympathetic index (HF/TP 41.7 vs 45.0;
first 3 h 45.6 vs 51.5). Uçar 2021 (16 men): a heavy meal at 22:00 did not change HRV, but the
protein-and-fat meal disturbed sleep. Afaghi 2007 (12 men): a high-GI meal 4 h before bed shortened
latency (9.0 vs 17.5 min); the same meal 1 h before gave 14.6 min. **Use:** EXPLAIN with a "large
meal within 3 h of bed" tag, and let personal data decide.

**6. Caffeine.** Gardiner 2023 *(EN)*: TST −45 min, efficiency −7%, latency +9 min, less deep
sleep. The meta-analysis cut-offs are 107 mg ≥ 8.8 h and 217.5 mg ≥ 13.2 h before bed. Gardiner 2025
RCT (23 men): 100 mg had no effect even 4 h before bed. 400 mg within 12 h delayed sleep and changed
architecture; within 8 h it fragmented sleep. Perceived quality fell only at 4 h (−34%), so people
do not notice the 8–12 h effect. Drake 2013: 400 mg at 0, 3 or 6 h before bed all disrupted sleep.
HRV: 400 mg at bedtime raised LF/HF in REM (Bonnet 2005, n = 15), which is weak. **Use:** EXPLAIN
(D6). The two Gardiner papers disagree on ~100 mg; start with the meta-analysis cut-offs and let
personal data relax them.

**7. Alcohol.** Pietilä 2018 (4,098 people, within-person, first 3 h of sleep; PMC full text):
≤ 0.25 / 0.25–0.75 / > 0.75 g/kg raised HR by 1.4 / 4.0 / 8.7 bpm and cut RMSSD by 2.0 / 5.7 /
12.9 ms. The effect was larger in younger people and those with a low baseline sleep HR. Sagawa 2011
(10 men, 0.5 and 1.0 g/kg): dose-related HR rise and HRV fall. Gardiner 2025 meta (27 studies): REM
falls from ≤ 0.50 g/kg (about 2 drinks) and worsens with dose; latency and time to N3 shorten only
at ≥ 0.85 g/kg; TST, efficiency and WASO are uncertain. Ebrahim 2013: more SWS in the first half,
more disruption in the second. So the deep + REM share can look normal or better after drinking.
Next day: ~0.5 g/kg after exercise is unlikely to impair most recovery; larger doses impair muscle
recovery (Barnes 2014). **Use:** EXPLAIN. Also: suppress the illness flag (#26), and do not credit
deep sleep on an alcohol night. Myth: "a drink helps you sleep".

**8. Energy deficit.** Smith 2025 (20 cyclists, Oura for HRV): one day of diet-induced low energy
availability (15 kcal/kg FFM) lowered overnight HR by 4 ± 3 bpm against exercise conditions, with no
HRV change. Exercise-induced low EA lengthened sleep by 53–61 min. Chronic: in physique athletes
dieting for 23 weeks, resting HR fell together with T3 and adjusted resting energy expenditure, then
recovered (Isola 2023). In a natural bodybuilder case, HR fell from 53 to 27 bpm, testosterone from
9.22 to 2.27 ng/mL, and mood disturbance rose from 6 to 43 (Rossow 2013). Prolonged EA < 25 kcal/kg
FFM went with muscle loss and hormonal and mood problems in men (Fagerberg 2018 review). The IOC
REDs statement *(EN)* covers the long-term harm. **Use:** ADJUST. In a sustained deficit, don't award
the RHR Day bonus (D9). This is the clearest case where a "better" number means something worse.

**9. Protein.** Pearson 2023 (29 studies): peri-exercise protein preserved isometric strength at
96 h (g = 0.56) and lowered CK at 72 h, with **no effect on soreness**. Zhao 2026 (75 RCTs): every
significant benefit came from trials that did not match energy intake, so the benefit may be energy,
not protein. Pasiakos 2014 *(EN)* agrees. **Use:** NONE as a daily link. Keep weekly g/kg as context
(evidence note).

**10. Dehydration.** After exercise-induced loss of 3.4% of body mass, HRV fell 4 h later only in
those not rehydrated (Castro-Sepulveda 2014, n = 14). Exercise dehydration raised post-exercise
resting HR and halved cardiac baroreflex gain (18.7 → 9.2 ms/mmHg; Charkoudian 2003, n = 13).
Three days of lower water intake ending in 16 h without water raised serum sodium but did not change
blood-pressure variability, baroreflex function or sympathetic transduction (Watso 2020, n = 35).
**Use:** EXPLAIN, only when ≥ 2 WUT markers are present (evidence note). Don't infer it from logged
water.

**11. Psychological stress.** Stress lowers HF-HRV (Kim 2018, 37 studies). A pre-sleep speech task
lowered parasympathetic modulation through NREM and REM and blunted its normal rise across the night
(Hall 2004, n = 59 randomised). On high-stress nights, efficiency was 81.0% vs 85.2% and stage-3
latency 33.9 vs 18.3 min (Åkerstedt 2007, n = 16). Within person, evening stress predicted shorter
TST, and short or poor sleep predicted higher next-day stress (Yap 2020, 326 people, > 2,500 nights).
**Use:** EXPLAIN. The Oura-style daytime stress score is already HR/HRV-derived, so it must not also
penalise HRV.

**12. Short sleep → next day.** Performance −7.56% (95% CI −11.9 to −3.1) across 227 outcomes,
about −0.4% per hour awake before the task. Morning tasks were largely unaffected; deprivation and
early waking hurt most (Craven 2022). RPE rose (SMD 0.39) and maximal force fell (SMD −0.35) (Kong
2025, 45 studies). For lifting, one sleepless night changed strength little, while consecutive
restricted nights cut multi-joint force (Knowles 2018). Mood: negative mood g = 0.45, positive mood
g = −0.94 (Tomaso 2021, 64 studies). Intake +385 kcal/day (252–517) with no change in expenditure
(Al Khatib 2017). RMSSD fell after deprivation (Zhang 2025, 11 RCTs). Injury: chronic poor sleep
gave OR 1.58 (1.05–2.37) in adolescents, and acute evidence was mixed (Gao 2019; Milewski 2014: < 8 h
→ 1.7×). No verified study on next-day resting HR. **Use:** SHARE. Last night's duration (or the
7-night balance) should also count toward training capacity, at a reduced weight. Secondary: VALIDATE
(RPE, e1RM).

**13. Regularity and social jet lag.** Fang 2021 (2,115 interns, wearables): within person, lower
day-to-day shifts in TST and wake time predicted better next-day mood. Variability mattered as much
as the mean. Gao 2019 (42 students): a week of irregular sleep-wake timing predicted worse mood the
following week. Sűdy 2019 (33 men): higher social jet lag went with lower vagal HRV (pNN50, RMSSD)
in the first hours of workday sleep. Wang 2026: each 30 min of midpoint deviation gave −0.0156
lnRMSSD, and irregularity strengthened the load → HRV dip. In athletes the performance evidence is
"scarce and inconsistent" (Fox 2026 scoping review). Regular sleepers had higher efficiency (ES 0.31;
median SRI 85.1; Halson 2022). **Use:** DERIVE (SRI and midpoint deviation, D11).

**14. HRV and RHR together.** In an elite triathlete heading into non-functional overreaching, the
7-day rolling lnRMSSD fell (−0.17/week) and so did its CV (−0.65%/week). The control athlete stayed
flat (Plews 2012, n = 2). In 13 functionally overreached triathletes, weekly-mean lnRMSSD *rose* and
RHR fell. Once-a-week readings missed it, and the taper reversed it (Le Meur 2013). In elites, HRV can
fall while RHR falls ("saturation"), and both rises and falls can mean trouble (Plews 2013). Resting
RMSSD rises with positive adaptation (SMD 0.58) and slightly with overreaching (SMD 0.26) (Bellenger
2016). Three random valid nights a week match a full week (Plews 2014). A falling weekly CV over
weeks 1–3 went with fitness gain (r = −0.74; Flatt 2016). A higher CV went with fatigue (r = −0.55)
and lower fitness (r = −0.65; Flatt 2017). **CV is ambiguous on its own:** falling CV with a falling
mean was bad (Plews), and falling CV with a steady mean was good (Flatt). **Use:** DERIVE (D1, D2).
Myth: "higher HRV is always better".

**15. Illness composite.** Evidence-note sources: RHR flagged 63% before symptoms (Mishra 2020);
respiratory rate flagged 20% two days before and 80% by day 3 (Miller 2020); temperature rose before
symptoms in 38/50 (Smarr 2020); temperature added 4.9% AUC to a 0.819 model (Mason 2022). New:
smartwatch HR + steps alerts caught 80% of infections pre- or asymptomatically, median 3 days before
symptoms (Alavi 2022, 3,318 people, 84 infected). Sensors plus symptoms gave AUC 0.80 against 0.71
for symptoms alone (Quer 2021). In viral challenge studies, wrist data alone detected H1N1 with
sensitivity 90% and specificity 93% (AUC 0.85), and rhinovirus with 78% and 100% (Grzesiak 2021).
No verified paper gives sensitivity and specificity for each single channel against the
combination; Mason's AUC gain is the closest. **Use:** FLAG (D8).

**16. Menstrual cycle** *(EN, restated)*. Vagal HRV falls follicular → luteal (d = −0.39), more
steeply premenstrually (Schmalenberger 2019). Late luteal: wrist temperature +0.45 °C, HR ~+4 bpm,
breathing ~+0.5/min (Goodale 2019). Oura finger temperature +0.30 °C (Maijala 2019). Sleep and
perceived readiness did not change (Alzueta 2022). Progesterone correlated with a lower nocturnal
parasympathetic index (Tada 2018). **Use:** ADJUST, with separate phase normals.

**17. Monotony and strain.** Foster 1998 (25 athletes): a high share of illnesses happened when an
athlete passed their own threshold, mostly for strain. Load = sRPE × minutes. Monotony = daily mean ÷
SD over a week. Strain = weekly load × monotony. Increases in load, monotony and strain went with
illness in 14 soccer players (Putlur 2004), and injuries rose with load in 12 basketball players
(r = 0.675; Anderson 2003). The samples are small and come from one group. **Use:** DERIVE (D7), as a
low-weight context. Monotony explodes when the week's SD is near zero, so rest days must count as 0.

**18. sRPE as one load.** The sRPE score tracked an HR-based score across steady, interval and
basketball sessions (Foster 2001). In resistance training, session RPE was reliable (ICC 0.88), and
heavy low-rep sets felt harder than light high-rep ones (Day 2004; Sweet 2004 *(EN)*). A review of
36 studies confirmed validity across sports, sexes and ages (Haddad 2017). **Use:** DERIVE: one
internal-load number per session, for every kind of session.

**19. Wellness vs HRV.** Self-report beat objective markers for sensitivity (Saw 2016, 56 studies).
In elite soccer, fatigue tracked daily load at r = −0.51, lnRMSSD at r = −0.24, and HRR, soreness and
sleep quality hardly at all (Thorpe 2015). In 17 swimmers, lnRMSSD was higher on days when sleep
quality, fatigue, stress and mood were better than usual, and 15/17 showed at least one
within-person link (Flatt 2018). **Use:** VALIDATE. The fatigue item is the main tuning target;
agreement between HRV and fatigue raises confidence (D13).

**20. HRV-guided training.** Kiviniemi 2007 (26 men, 4 weeks): the HRV-guided group raised VO₂peak
from 56 to 60 mL/kg/min; the fixed plan did not change significantly. Meta-analyses: VO₂max ES 0.402
in HRV-guided groups, with a significantly larger effect than controls (Granero-Gallegos 2020).
Submaximal markers g = 0.296 (significant), performance g = 0.079 and VO₂peak g = 0.171 (not
significant), with fewer non-responders (Düking 2021, 8 studies). Vagal HRV SMD 0.50 (significant),
VO₂max and performance SMD 0.20 (not significant) (Manresa-Rocamora 2021). All endurance; I found no
HRV-guided resistance-training RCT. **Use:** VALIDATE. Expect small group gains and fewer bad
responders, not big jumps.

**21. Nocturnal HR dipping.** Non-dipping = (awake − sleep HR) / awake HR < 0.1. Across 3,957
ambulatory-BP patients, the lowest vs highest decile of HR dip carried a mortality HR of 2.67
(1.31–5.47) (Ben-Dov 2007). Night-time HR was the only HR measure that predicted CV events after full
adjustment, HR 1.17 (1.05–1.30) (Johansen 2013, 653 people aged 55–75). There is no evidence for
daily readiness. **Use:** DERIVE as a 30-day context number (D12).

**22. Heat.** A systematic review found that higher outdoor and indoor temperatures degrade sleep
quantity and quality worldwide, more so in the hottest periods and in vulnerable people (Chevance
2024). Hotter-than-usual nights increased self-reported insufficient sleep in 765,000 US respondents
(Obradovich 2017). Heat with bedding raises wake and lowers SWS and REM; humid heat is worse
(Okamoto-Mizuno 2012). **Use:** EXPLAIN, only if the app gets local temperature (weather API or a
room sensor). A hot room also plausibly raises finger temperature, so a hot night should temper the
temperature illness channel *(reasoning)*.

**23. Day-to-day weight.** First-morning body mass varied 0.51 ± 0.20 kg a day (CV 0.66%), and 3 days
give a fair estimate (Cheuvront 2004, 65 men). Each gram of muscle glycogen is stored with at least
3 g of water (Fernández-Elías 2015), and early dieting weight loss is largely glycogen plus water
(Kreitzman 1992). Weight peaks Sunday–Monday and falls through the week (Orsama 2014, 4,657
weighings). **Use:** ADJUST. Weight vs plan should read a smoothed trend (D14). A single morning's
weight touches readiness only through the hydration flag.

**24. Light.** Later first exposure to > 10 lux went with more awakenings; early, bright light went
with more SWS; and light timing explained 47% of the variance in clock timing (Wams 2017, n = 20,
ambulatory PSG). An e-reader before bed lengthened latency, suppressed melatonin, delayed the clock
and reduced next-morning alertness (Chang 2015). Outdoor time went with less tiredness (Burns 2021
*(EN)*). **Use:** EXPLAIN. The ring cannot measure light (evidence note).

**25. Sleep debt → rebound (added).** After 2 nights restricted to 4 h, the first recovery night
had more SWS, REM rebounded on nights 1 and 2, and latency was shorter (Brunner 1990), as the
two-process model predicts (Borbély 2016). **Use:** ADJUST. After a short night, a high deep + REM
share and a short latency are expected and should not earn a bonus (D10).

**26. Non-illness alert triggers (added).** Stress, alcohol and travel also triggered alerts, at
1.15 alert days per person against 3.42 for COVID cases (Alavi 2022). **Use:** FLAG, as downgrade
conditions inside the illness composite.

**27. Melatonin (added).** Latency −7.06 min (4.37–9.75), TST +8.25 min, and sleep quality SMD 0.22,
in people with primary sleep disorders (Ferracioli-Oda 2013, 19 studies). **Use:** EXPLAIN, from the
supplement log.

**28. Naps (added).** After normal sleep, a nap lowered fatigue (SMD 0.91) and RPE during exercise
(SMD 1.62), and raised perceived recovery (SMD 1.66). After deprivation it had no significant effect
on sleepiness or fatigue (Boukhris 2026; certainty moderate for RPE, low to very low otherwise).
**Use:** EXPLAIN. Whether naps should count toward 7-night balance is unstudied.

**29. Illness → performance (added).** Acute respiratory infection lowered sports performance and
lung function acutely; mild infection changed endurance little; training volume fell afterwards
(Kaulback 2023, 17 studies, n = 7,793). **Use:** FLAG. This supports a ceiling on a confirmed
illness.

**30. Sleep ↔ next-day mood and stress (added).** Diary studies show reciprocal day-to-day links
between subjective sleep (quality, duration, latency) and next-day mood (Konjarski 2018). Short sleep
predicted higher next-day stress within person (Yap 2020). **Use:** VALIDATE. Mood logs are an
outcome that sleep scores should predict. Do not feed mood back into sleep (rule 3).

---

## Derived metrics worth building

Each one combines values the app already has. Formulas marked *(mine)* need tuning on real data
before they move a score.

**D1. 7-day HRV mean and CV.** `lnR_d = ln(overnight RMSSD_d)`.
`HRV7 = mean(lnR over the last 7 nights)`, valid with ≥ 3 nights (Plews 2014).
`CV7 = 100 × SD(lnR, same nights) / HRV7`. Read them together. Falling HRV7 with falling CV7 over
weeks is a maladaptation warning (Plews 2012). Steady HRV7 with falling CV7 is adaptation (Flatt
2016). High CV7 goes with fatigue (Flatt 2017). Daily rule (Kiviniemi 2007): tonight
< 10-day mean − 1 SD, or falling 2 nights in a row → suggest an easy day. HRV7 should be the Level
input and tonight's z the Day input. Carries information that neither single nights nor the mean
alone do.

**D2. HRV–RHR pattern.** `zH = (HRV7 − 60-day median of HRV7) / spread`; `zR` the same for 7-day
overnight RHR *(mine)*.
- zH ↓, zR ↑ → sympathetic load, acute fatigue or illness. Caution.
- zH ↑, zR ↓, with fatigue item worse or e1RM stalling → possible functional overreaching (Le Meur
  2013). Caution, not a reward.
- zH ↓, zR ↓ → "saturation" (Plews 2013). Usually benign in very fit endurance athletes; unlikely
  in a recreational lifter.
- zH ↑, zR ↓, with fatigue normal → positive adaptation (Bellenger 2016).

**D3. Unexplained recovery dip.** Fit, within person:
`lnR_{d+1} − normal = β × (load_d − usual_load) + ε`. Use Wang 2026 (−0.0089 per 100 AU sRPE) as the
prior for β. `unexplained = observed − β × Δload`. Show "HRV is lower than yesterday's training
explains" when `unexplained ≤ −1 spread` *(mine)*. This separates "tired from training" (expected,
24–72 h; Stanley 2013) from "tired from something else".

**D4. Bedtime strain gap.** `gap_h = sleep_onset − session_end`. Mark a session "late hard" when
`gap_h < 4` and session RPE ≥ 7 *(mine; Leota used WHOOP strain, not RPE)*. Expected that night:
RHR +4 to +9 bpm and HRV −14% to −33% against a light session (Leota 2025). Explains the night; adds
no penalty.

**D5. Alcohol dose.** `g_per_kg = drinks × grams_per_drink / body_mass`. Pietilä used 12 g
portions; set grams per drink to the user's locale. Bands ≤ 0.25 / 0.25–0.75 / > 0.75 →
expected first-3-h HR +1.4 / +4.0 / +8.7 bpm and RMSSD −2.0 / −5.7 / −12.9 ms. Use it to explain,
to mute the illness flag, and to withhold any deep-sleep bonus.

**D6. Caffeine too close to bed.** `h = bedtime − last_caffeine_time`, dose in mg from the
supplement log. Flag when 107 mg and h < 8.8, or 217.5 mg and h < 13.2 (Gardiner 2023,
interpolate *(mine)*), or ≥ 400 mg and h < 12 (Gardiner 2025). Let personal data relax the
~100 mg rule, because the 2025 RCT saw no effect at 4 h.

**D7. Load, monotony, strain (Foster 1998).** `L_d = Σ sessions (sRPE × minutes)`, with rest days
= 0. `W = Σ last 7 L_d`. `M = mean7(L) / SD7(L)`, capped *(mine)* when SD7 is near 0.
`S = W × M`. Judge S against the person's own history, as Foster did, not a fixed cut-off.

**D8. Illness composite.** Channels, each scored as a z against its own normal in the bad direction:
temperature (against the cycle-phase normal), breathing rate (spread floored at 0.5/min, EN),
overnight RHR, overnight HRV (inverted), and daytime still HR (EN). `count = channels with z ≥ 2`
*(mine)*. FLAG when count ≥ 2 on 2 consecutive nights, or count ≥ 1 plus a symptom answer (Quer
2021: sensors + symptoms beat symptoms). **Downgrade** one level after alcohol ≥ 0.25 g/kg, travel
or a time-zone change, a late hard session (D4), or a hot night (Alavi 2022; Leota 2025; Chevance
2024). Expected lead time is 1–3 days.

**D9. Energy-deficit guard.**
`EA7 = mean over 7 days of (intake kcal − exercise kcal) / FFM kg`. Take FFM from the latest DEXA
or a smoothed scale value. While `EA7 < 30` (Loucks 2003 *(EN)*, women; male thresholds unclear,
Areta 2021 *(EN)*), or while weight falls faster than plan, cap RHR's positive Day term at 0. Show
"low RHR may reflect the deficit" (Smith 2025; Isola 2023). Unlogged food = missing, so no guard.

**D10. Recovery-night expectation.** When last night's TST was ≥ 1.5 h below the personal normal
*(mine)*, cap tonight's deep + REM share and latency scores at their normal value, so the rebound
earns no bonus (Brunner 1990).

**D11. Regularity.** SRI as in the evidence note. Plus
`midpoint_dev_d = |mid_sleep_d − 28-day median mid_sleep|` (the Wang 2026 predictor, per 30 min).
Plus social jet lag `SJL = |MSF − MSW|`: mid-sleep on free days minus mid-sleep on workdays, the
MCTQ convention behind Wittmann 2006. Use midpoint deviation to explain an HRV dip, and SRI or SJL as
slow inputs.

**D12. Nocturnal HR dip.** `dip% = 100 × (awake still HR − sleeping HR) / awake still HR`, taken as
a 30-day median. Non-dipping < 10% (Ben-Dov 2007). Slow Heart-pillar context only.

**D13. Wellness–HRV concordance.** Each morning: `zF` = fatigue item against its own median, and
`zH` = lnR z. "Concordant low" when both ≤ −1 *(mine)*. Track the concordance rate as a validation
statistic. Give a low readiness more confidence when both agree (Flatt 2018; Thorpe 2015).

**D14. Trend weight.** A 7-day median, or an exponentially weighted average with α ≈ 0.1
*(mine)*. Ignore daily moves under ~1% (daily CV 0.66%, Cheuvront 2004). Expect a weekend bump
(Orsama 2014) and a 3–4 g water per g glycogen jump after a refeed (Kreitzman 1992;
Fernández-Elías 2015).

**D15. Overreaching watch (weak).** All four together *(mine)*: 7-day sRPE load ≥ 1.3 × the 28-day
mean; 7-day median sleep efficiency down ≥ 1.5 pp (Hausswirth 2014: −1.6%); fatigue item worse on
≥ 3 of 7 days; and HRV7 outside its normal band **in either direction** (Le Meur 2013; Plews 2012).
Explain, and suggest a lighter week. Do not set a ceiling until it is validated against e1RM trends.

---

## Not verified

- **Drake 2013, "more than 1 h less sleep at 6 h":** the abstract gives no number, and the full
  text was not available through PMC.
- **Caffeine half-life (~5 h) and any "caffeine left at bedtime" model:** not checked. D6 uses only
  the published cut-offs.
- **The exact saturation-correcting HRV index in Plews 2013** (often quoted as lnRMSSD:RR): the
  abstract only says "specific HRV indices".
- **Smallest worthwhile change = 0.5 × SD of lnRMSSD:** widely used, but not found in an abstract I
  read. Kiviniemi's "10-day mean − 1 SD" rule is verified.
- **Monotony > 2.0 as a risk threshold:** commonly quoted; not in the Foster 1998 abstract.
- **Sleep restriction raising next-day resting HR:** no verified study found.
- **HRV-guided resistance-training RCTs:** none found in PubMed searches.
- **Overnight HR "settling" or nadir timing as a recovery marker:** no peer-reviewed validation
  found. It appears to be vendor practice.
- **Minor et al. 2022 (One Earth), sleep lost per °C of night heat:** not indexed in PubMed, so not
  cited.
- **Numbers only in full texts I could not read:** Kredlow 2015 effect sizes; Chang 2015 latency in
  minutes; Orsama 2014 weekend amplitude; the unit behind Johansen 2013's HR 1.17.
- **A bpm figure for nocturnal HR after a large late meal:** not found.
- **Extra sleep need per unit of training load:** no study found. Sargent 2021 is self-reported need.
- **Mapping WHOOP "strain" to session RPE** (needed for D4): none exists.
- **Gunn 2018** (next-day cognition after heavy drinking, PMID 30144191) was found but not read, so
  it is not used.
- **Jet lag and altitude** were not researched in depth. Janse van Rensburg 2020 (PMID 32303523)
  was found, but its abstract gives no effect sizes.
- **Wang & Wang 2026** was published in September 2026 and is a single 54-person study. Treat its
  slopes as priors only.

## References

New in this note (PMID · DOI):

- Afaghi 2007 · 17284739 · 10.1093/ajcn/85.2.426
- Åkerstedt 2007 · 17884278 · 10.1016/j.biopsycho.2007.07.010
- Al Khatib 2017 · 27804960 · 10.1038/ejcn.2016.201
- Alavi 2022 · 34845389 · 10.1038/s41591-021-01593-2
- Anderson 2003 · 14636112 · 10.1519/1533-4287(2003)017<0734:iotpoi>2.0.co;2
- Atoui 2021 · 33571893 · 10.1016/j.smrv.2021.101426
- Barnes 2014 · 24748461 · 10.1007/s40279-014-0192-8
- Bellenger 2016 · 26888648 · 10.1007/s40279-016-0484-2
- Ben-Dov 2007 · 17954807 · 10.1001/archinte.167.19.2116
- Bonnet 2005 · 16184581 · 10.1002/da.20127
- Borbély 2016 · 26762182 · 10.1111/jsr.12371
- Boukhris 2026 · 41668951 · 10.5114/biolsport.2026.153310
- Brunner 1990 · 1693894 · 10.1016/0013-4694(90)90136-8
- Buchheit 2014 · 24578692 · 10.3389/fphys.2014.00073
- Castro-Sepulveda 2014 · 25726222 · 10.3305/nh.2015.31.3.8523
- Chang 2015 · 25535358 · 10.1073/pnas.1418490112
- Charkoudian 2003 · 14561843 · 10.1113/jphysiol.2003.048629
- Chen 2011 · 21273908 · 10.1519/JSC.0b013e3181da7858
- Cheuvront 2004 · 15673099 · 10.1123/ijsnem.14.5.532
- Chevance 2024 · 38598988 · 10.1016/j.smrv.2024.101915
- Chung 2020 · 32295235 · 10.3390/ijerph17082677
- Craven 2022 · 35708888 · 10.1007/s40279-022-01706-y
- Crispim 2011 · 22171206 · 10.5664/jcsm.1476
- Day 2004 · 15142026 · 10.1519/R-13113.1
- Drake 2013 · 24235903 · 10.5664/jcsm.3170
- Duan 2021 · 34017207 · 10.2147/NSS.S301113
- Düking 2021 · 34489178 · 10.1016/j.jsams.2021.04.012
- Ebrahim 2013 · 23347102 · 10.1111/acer.12006
- Fagerberg 2018 · 28530498 · 10.1123/ijsnem.2016-0332
- Fang 2021 · 33603132 · 10.1038/s41746-021-00400-z
- Fernández-Elías 2015 · 25911631 · 10.1007/s00421-015-3175-z
- Ferracioli-Oda 2013 · 23691095 · 10.1371/journal.pone.0063773
- Flatt & Esco 2016 · 26200192 · 10.1519/JSC.0000000000001095
- Flatt 2017 · 26997322 · 10.23736/S0022-4707.16.06322-2
- Flatt 2018 · 30208575 · 10.3390/sports6030093
- Foster 1998 · 9662690 · 10.1097/00005768-199807000-00023
- Foster 2001 · 11708692 · (no DOI in PubMed)
- Fox 2026 · 42563357 · 10.1080/15402002.2026.2715423
- Frimpong 2021 · 34416428 · 10.1016/j.smrv.2021.101535
- Gao B 2019 · 30888337 · 10.1097/BPO.0000000000001306
- Gao L 2019 · 30722058 · 10.1093/sleep/zsz034
- Gardiner 2025 (caffeine RCT) · 39377163 · 10.1093/sleep/zsae230
- Gardiner 2025 (alcohol meta) · 39631226 · 10.1016/j.smrv.2024.102030
- Granero-Gallegos 2020 · 33143175 · 10.3390/ijerph17217999
- Grzesiak 2021 · 34586364 · 10.1001/jamanetworkopen.2021.28534
- Haddad 2017 · 29163016 · 10.3389/fnins.2017.00612
- Hall 2004 · 14747638 · 10.1097/01.psy.0000106884.58744.09
- Halson 2022 · 35713743 · 10.1186/s40798-022-00470-7
- Hausswirth 2014 · 24091995 · 10.1249/MSS.0000000000000177
- Hynynen 2010 · 20419617 · 10.1055/s-0030-1249625
- Isola 2023 · 36645885 · 10.1139/apnm-2022-0372
- Johansen 2013 · 23306958 · 10.1093/eurheartj/ehs449
- Kaulback 2023 · 35695464 · 10.1080/17461391.2022.2089914
- Kim 2018 · 29486547 · 10.30773/pi.2017.08.17
- Kingsley & Figueroa 2016 · 25524332 · 10.1111/cpf.12223
- Kiviniemi 2007 · 17849143 · 10.1007/s00421-007-0552-2
- Knowles 2018 · 29422383 · 10.1016/j.jsams.2018.01.012
- Kong 2025 · 40236824 · 10.3389/fphys.2025.1544286
- Konjarski 2018 · 30404728 · 10.1016/j.smrv.2018.05.005
- Kredlow 2015 · 25596964 · 10.1007/s10865-015-9617-6
- Kreitzman 1992 · 1615908 · 10.1093/ajcn/56.1.292S
- Le Meur 2013 · 24136138 · 10.1249/MSS.0b013e3182980125
- Leota 2025 · 40234380 · 10.1038/s41467-025-58271-x
- Manresa-Rocamora 2021 · 34639599 · 10.3390/ijerph181910299
- Milewski 2014 · 25028798 · 10.1097/BPO.0000000000000151
- Myllymäki 2012 · 21667290 · 10.1007/s00421-011-2034-9
- Obradovich 2017 · 28560320 · 10.1126/sciadv.1601555
- Okamoto-Mizuno 2012 · 22738673 · 10.1186/1880-6805-31-14
- Orsama 2014 · 24504358 · 10.1159/000356147
- Pearson 2023 · 36513777 · 10.1038/s41430-022-01250-y
- Pietilä 2018 · 29549064 · 10.2196/mental.9519
- Plews 2012 · 22367011 · 10.1007/s00421-012-2354-4
- Plews 2013 · 23852425 · 10.1007/s40279-013-0071-8
- Plews 2014 · 24334285 · 10.1123/ijspp.2013-0455
- Putlur 2004 · 24624008 · (no DOI in PubMed; PMC3938062)
- Quer 2021 · 33122860 · 10.1038/s41591-020-1123-x
- Rossow 2013 · 23412685 · 10.1123/ijspp.8.5.582
- Sagawa 2011 · 21848959 · 10.1111/j.1530-0277.2011.01558.x
- Sargent 2021 · 34021090 · 10.1123/ijspp.2020-0896
- Smith 2025 · 40523229 · 10.1249/MSS.0000000000003783
- Stanley 2013 · 23912805 · 10.1007/s40279-013-0083-4
- Stutz 2019 · 30374942 · 10.1007/s40279-018-1015-0
- Sűdy 2019 · 31555086 · 10.3389/fnins.2019.00950
- Tada 2018 · 29894762 · 10.1016/j.physbeh.2018.06.010
- Thorpe 2015 · 25710257 · 10.1123/ijspp.2015-0004
- Tomaso 2021 · 33367799 · 10.1093/sleep/zsaa289
- Uçar 2021 · 33426778 · 10.1002/smi.3025
- Wams 2017 · 29040758 · 10.1093/sleep/zsx165
- Wang & Wang 2026 · 42845805 · 10.3389/fphys.2026.1966561
- Watso & Farquhar 2019 · 31405195 · 10.3390/nu11081866
- Watso 2020 · 31617739 · 10.1152/ajpregu.00149.2019
- Wittmann 2006 · 16687322 · 10.1080/07420520500545979
- Yap 2020 · 31608395 · 10.1093/sleep/zsz250
- Youngstedt 1997 · 9178916 · 10.1093/sleep/20.3.203
- Zhang 2025 · 40895095 · 10.3389/fneur.2025.1556784
- Zhao 2026 · 41433039 · 10.1080/15502783.2025.2605338

From the evidence note, PMID looked up here: Alzueta 2022 · 35422659; Areta 2021 · 33095376;
Burns 2021 · 34488088; Gardiner 2023 · 36870101; Goodale 2019 · 30998226; Loucks 2003 · 12519869;
Maijala 2019 · 31783840; Mason 2022 · 35236896; Miller 2020 · 33301493; Mishra 2020 · 33208926;
Mountjoy 2023 · 37752011; Natarajan 2020 · 33299095; Pasiakos 2014 · 24435468; Saw 2016 · 26423706;
Schmalenberger 2019 · 31726666; Smarr 2020 · 33318528; Sweet 2004 · 15574104.
