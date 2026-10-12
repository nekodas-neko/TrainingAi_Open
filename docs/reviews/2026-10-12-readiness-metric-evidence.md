# Evidence for new readiness inputs

_Research note written 2026-10-12 for [`scoring-layers-and-data-inputs.md`](../architecture/scoring-layers-and-data-inputs.md) §6 and §9. Read-only research: nothing was run on a device, and no production data was used._

Research date 2026-10-12. Scope: 14 candidate inputs to a daily readiness score for a person who
lifts and trains for general fitness. The app uses a ring and a phone.

**How citations were checked.** Every citation below was looked up in PubMed through the NCBI
E-utilities API, which returned the authors, year, journal, volume, pages and DOI. Numbers come
from the PubMed abstract or from the open full text on PMC. Where a number came only from a
secondary page, or the full text could not be read, the "Not verified" section at the end says so.
No citation is included that could not be found in PubMed.

**Shapes** follow the app's model. **Sweet spot**: 100 inside a band. **Steady**: 100 at your own
normal, falling with distance either way. **Directional**: better in one direction. "Day" means
compared with your own 30-day median, with spread = IQR / 1.349. "Level" means graded against a
population yardstick. Wherever a yardstick below is my own arithmetic rather than a published
cut-off, it is marked *(derived)*.

---

## Summary table

| # | Candidate | Strength | What the research supports measuring | Shape and starting yardstick | Daily or context | Verified citations |
|---|---|---|---|---|---|---|
| 1 | **Self-reported wellness** (fatigue, soreness, mood, stress, sleep quality) | **Strong** that it tracks training load; **moderate** on which items | A short daily check-in of single items, each scored on its own. Saw 2016 reviewed 56 studies: self-report responded to acute and chronic load more sensitively and consistently than objective markers, and total scores were less sensitive than subscales. Thorpe 2015: of all the markers, the fatigue rating tracked daily load best (r = −0.51). In that study soreness and sleep-quality ratings did not track load. | **Directional**, per item, Day only, against your own median. Research gives no absolute band. Score each item separately and give fatigue the most weight. A missing answer drops out. A pre-filled answer is not a self-report. | **Daily** | Saw AE, Main LC, Gastin PB. *Br J Sports Med* 2016;50(5):281–91. [doi:10.1136/bjsports-2015-094758](https://doi.org/10.1136/bjsports-2015-094758) · McLean BD et al. *Int J Sports Physiol Perform* 2010;5(3):367–83. [doi:10.1123/ijspp.5.3.367](https://doi.org/10.1123/ijspp.5.3.367) · Hooper SL et al. *Med Sci Sports Exerc* 1995;27(1):106–12. [PMID 7898325](https://pubmed.ncbi.nlm.nih.gov/7898325/) |
| 2 | **Sleep Regularity Index (SRI)** | **Strong** for long-term outcomes; **moderate** for performance (consensus); not tested for next-day readiness | SRI is the chance of being in the same sleep/wake state at two moments 24 h apart. It runs from 0 (random) to 100 (perfectly regular). It is computed from epoch-level sleep/wake over at least 5 days (Windred required 120 h of valid paired epochs). | **Directional ↑, with a plateau.** UK Biobank median 81 (IQR 73.8–86.3). Bottom-quintile cut-off 71.6, top-quintile cut-off 87.3. Most of the drop in mortality risk has happened by the second quintile. Starting map *(derived)*: ≥ 87 → 100, 81 → ~70, < 72 → ≤ 40. Compute over a rolling 7 days. | **Slow** (rolling 7-day); use as a Level-type unit, not a day-to-day swing | Windred DP et al. *Sleep* 2024;47(1):zsad253. [doi:10.1093/sleep/zsad253](https://doi.org/10.1093/sleep/zsad253) ([PMC10782501](https://pmc.ncbi.nlm.nih.gov/articles/PMC10782501/)) · Phillips AJK et al. *Sci Rep* 2017;7:3216. [doi:10.1038/s41598-017-03171-4](https://doi.org/10.1038/s41598-017-03171-4) · Sletten TL et al. (NSF consensus). *Sleep Health* 2023;9(6):801–20. [doi:10.1016/j.sleh.2023.07.016](https://doi.org/10.1016/j.sleh.2023.07.016) |
| 3 | **Daytime resting HR / walking HR** | **Moderate** for illness detection and as a fitness trend; **weak** for day-to-day training readiness | *Daytime still HR*, as Mishra 2020 defined it: HR at any moment when the previous 12 min had zero steps, compared with a 28-day baseline. Elevations of this measure flagged 63% of COVID cases before symptoms, in real time. *Non-active HR* as a fitness trend: 2.4 bpm lower went with 1.3 mL/kg/min higher peak VO₂ (Zhang 2024). Walking HR is an uncontrolled form of submaximal exercise HR (HRex). Controlled HRex has a typical error of ~3% (Buchheit 2014), but free-living walking does not control pace or gradient. | **Directional ↓, Day only.** No population Level: people's normal resting HR ranges from 40 to 109 bpm. Floor the spread near 3 bpm: within-person SD was ~3 in 92,457 Fitbit users (Quer 2020). Best used as a fourth input to the illness modifier, and as a 30–90-day fitness trend. Not a separate weighted unit. | **Daily** (illness) / **slow** (fitness) | Mishra T et al. *Nat Biomed Eng* 2020;4(12):1208–20. [doi:10.1038/s41551-020-00640-6](https://doi.org/10.1038/s41551-020-00640-6) · Quer G et al. *PLoS One* 2020;15(2):e0227709. [doi:10.1371/journal.pone.0227709](https://doi.org/10.1371/journal.pone.0227709) · Zhang Y et al. *J Med Internet Res* 2024;26:e56676. [doi:10.2196/56676](https://doi.org/10.2196/56676) |
| 4 | **HR recovery after exercise (HRR)** | **Strong** as a long-term prognostic marker; **contested** as a daily readiness marker | Cole 1999: a drop of ≤ 12 bpm in the first minute after a peak treadmill test predicted death (adjusted RR 2.0). Qiu 2017 meta-analysis: attenuated HRR had HR 1.68 for all-cause mortality. Per 10 bpm less recovery, HR 1.09. For readiness, Bellenger 2016 found HRR rises with positive adaptation (SMD 0.63) **and** with overreaching (SMD 0.46), so the direction is ambiguous. HRR's typical error is ~25%, against a smallest worthwhile change of ~7% (Buchheit 2014). | **Directional ↑, as a slow fitness context.** Measure only after a standardised effort (same intensity, same cooldown). Cole's ≤ 12 bpm cut-off comes from maximal tests and does not transfer to submaximal sets. Use a 4–8-week trend. No daily weight. | **Context** | Cole CR et al. *N Engl J Med* 1999;341(18):1351–7. [doi:10.1056/NEJM199910283411804](https://doi.org/10.1056/NEJM199910283411804) · Qiu S et al. *J Am Heart Assoc* 2017;6(5):e005505. [doi:10.1161/JAHA.117.005505](https://doi.org/10.1161/JAHA.117.005505) · Bellenger CR et al. *Sports Med* 2016;46(10):1461–86. [doi:10.1007/s40279-016-0484-2](https://doi.org/10.1007/s40279-016-0484-2) |
| 5 | **VO₂max / cardiorespiratory fitness** | **Strong** for health outcomes; not a recovery signal | Each 1 MET higher fitness carried RR 0.87 for all-cause mortality. Low fitness (< 7.9 METs) carried RR 1.70 against high (≥ 10.9 METs) (Kodama 2009). Mandsager 2018 found no upper limit of benefit. Wearable estimates from exercise-based algorithms showed bias −0.09 mL/kg/min but limits of agreement of about ±10. Estimates from resting data overestimated by 2.17 (Molina-Garcia 2022). | **Directional ↑ as a Level/context.** Kodama bands: < 7.9 METs (≈ 27.7 mL/kg/min) is low, ≥ 10.9 METs (≈ 38.2) is high *(mL conversion derived, 1 MET = 3.5)*. Age- and sex-specific percentiles are better (FRIEND, Kaminsky 2022). Use the 90-day trend and ignore changes smaller than the device error. | **Context** | Kodama S et al. *JAMA* 2009;301(19):2024–35. [doi:10.1001/jama.2009.681](https://doi.org/10.1001/jama.2009.681) · Mandsager K et al. *JAMA Netw Open* 2018;1(6):e183605. [doi:10.1001/jamanetworkopen.2018.3605](https://doi.org/10.1001/jamanetworkopen.2018.3605) · Molina-Garcia P et al. *Sports Med* 2022;52(7):1577–97. [doi:10.1007/s40279-021-01639-y](https://doi.org/10.1007/s40279-021-01639-y) |
| 6 | **Breathing disturbances in sleep** (AHI- or ODI-style index) | **Weak** for readiness; **strong** as a health screen | No study was found linking nightly swings in a wearable AHI/ODI to next-day training readiness. Night-to-night variability is large. A single night misclassifies 20–50% of people with OSA, and results stabilise at about 14 nights (Lechat 2022, 67,278 people). Wearable AI detection: pooled accuracy 0.869, sensitivity 0.938, specificity 0.752 (Abd-Alrazaq 2024). | **No weighted score.** Context flag on a 14-night mean. Clinical AHI bands: < 5 normal, 5–15 mild, 15–30 moderate, ≥ 30 severe (AASM 1999, via secondary sources). A ring index is not a diagnostic AHI. AASM 2017 says algorithms should not diagnose OSA, so the most the app should do is suggest a proper sleep study. | **Context** | Lechat B et al. *Am J Respir Crit Care Med* 2022;205(5):563–9. [doi:10.1164/rccm.202107-1761OC](https://doi.org/10.1164/rccm.202107-1761OC) · Abd-Alrazaq A et al. *J Med Internet Res* 2024;26:e58187. [doi:10.2196/58187](https://doi.org/10.2196/58187) · Kapur VK et al. *J Clin Sleep Med* 2017;13(3):479–504. [doi:10.5664/jcsm.6506](https://doi.org/10.5664/jcsm.6506) |
| 7 | **Respiratory-rate rise and skin-temperature deviation** (illness) | **Moderate** (consistent across several cohorts, mostly COVID) | **Overnight respiratory rate against your own baseline.** In healthy people the within-person nightly SD is **0.51 ± 0.20 breaths/min** (CV 3.3%). A WHOOP model flagged 20% of COVID-positive people in the 2 days before symptoms and 80% by day 3 (Miller 2020). **Finger temperature** (Oura): illness-related rises were seen before symptom report in 38 of 50 cases (Smarr 2020). A detection algorithm reached AUC 0.819, and adding temperature raised AUC by 4.9% (Mason 2022). Respiration had the largest and slowest-resolving shift (Natarajan 2020). *Mishra 2020 used HR, steps and sleep, not respiration or temperature.* | **Steady, Day only (no Level)**, with a one-sided penalty, used as an illness modifier. Floor the RR spread at ~0.5 breaths/min, so that +1 breath/min ≈ +2 SD *(derived)*. Temperature has no validated °C cut-off for a finger ring: Smarr used normalised units. Any cut-off below ~+0.3 °C fires every luteal phase (row 12). | **Daily modifier** (already built as the app's illness radar) | Miller DJ et al. *PLoS One* 2020;15(12):e0243693. [doi:10.1371/journal.pone.0243693](https://doi.org/10.1371/journal.pone.0243693) · Smarr BL et al. *Sci Rep* 2020;10:21640. [doi:10.1038/s41598-020-78355-6](https://doi.org/10.1038/s41598-020-78355-6) · Mason AE et al. *Sci Rep* 2022;12:3463. [doi:10.1038/s41598-022-07314-0](https://doi.org/10.1038/s41598-022-07314-0) |
| 8 | **Alcohol and caffeine** | **Strong** | **Alcohol** (4,098 employees, within-person): during the first 3 h of sleep, an HRV-derived "physiological recovery state" fell by 9.3, 24.0 and 39.2 percentage units at ≤ 0.25, 0.25–0.75 and > 0.75 g/kg. The effect was stronger in younger people and those with a lower baseline sleep HR (Pietilä 2018). This is a Firstbeat index, not a raw rMSSD % change. Alcohol shortens sleep latency, disrupts the second half of the night and delays REM (Ebrahim 2013). **Caffeine** (meta-analysis of 24 studies): −45 min total sleep, −7% efficiency, +9 min latency, less deep sleep. A 107 mg coffee should be ≥ 8.8 h before bed, and a 217.5 mg pre-workout ≥ 13.2 h (Gardiner 2023). | **No weighted score.** Their effect already lands in HRV, RHR and sleep, so a weight would double-count it. Log dose and timing as explanatory tags. Alcohol bands in g/kg: ≤ 0.25 / 0.25–0.75 / > 0.75. Caffeine: last-intake time against bedtime, using the 8.8 h and 13.2 h marks. Feed the "how X affects you" engine. | **Context** (explains the next morning) | Pietilä J et al. *JMIR Ment Health* 2018;5(1):e23. [doi:10.2196/mental.9519](https://doi.org/10.2196/mental.9519) · Gardiner C et al. *Sleep Med Rev* 2023;69:101764. [doi:10.1016/j.smrv.2023.101764](https://doi.org/10.1016/j.smrv.2023.101764) · Drake C et al. *J Clin Sleep Med* 2013;9(11):1195–200. [doi:10.5664/jcsm.3170](https://doi.org/10.5664/jcsm.3170) |
| 9 | **Training load from all activity vs lifting volume; ACWR** | **Moderate** for measuring load; **contested** for ACWR as an injury predictor | Session RPE (CR-10 × minutes) is one internal-load method validated across modes, resistance training included (Foster 2001; Sweet 2004). Monitor both internal and external load (Bourdon 2017 consensus). Endurance work interferes with strength and hypertrophy gains (Wilson 2012), so all activity belongs in the load, not lifting alone. **ACWR:** Gabbett 2016 proposed 0.8–1.3 as a "sweet spot" and ≥ 1.5 as a "danger zone". Impellizzeri 2020 found "no evidence supporting the use of ACWR". Impellizzeri 2021 showed that random chronic loads reproduce the injury association. Lolli 2019 showed the ratio is mathematically coupled. | **Sweet spot on acute (7 d) against chronic (28 d)**, only as a low-weight unit or a spike warning. Starting band 0.8–1.3 (Gabbett), labelled a team-sport heuristic, not validated for recreational lifters. Use one internal-load unit per session: sRPE for every session, and HR-based TRIMP for HR-tracked cardio. MET-minutes are a fallback for unlogged movement only: METs measure energy cost, not lifting strain *(reasoning, not a cited finding)*. | **Daily-computed context** | Foster C et al. *J Strength Cond Res* 2001;15(1):109–15. [PMID 11708692](https://pubmed.ncbi.nlm.nih.gov/11708692/) · Gabbett TJ. *Br J Sports Med* 2016;50(5):273–80. [doi:10.1136/bjsports-2015-095788](https://doi.org/10.1136/bjsports-2015-095788) · Impellizzeri FM et al. *Int J Sports Physiol Perform* 2020;15(6):907–13. [doi:10.1123/ijspp.2019-0864](https://doi.org/10.1123/ijspp.2019-0864) |
| 10 | **Protein and energy availability (RED-S / REDs)** | **Strong** for long-term harm from low energy availability (LEA); **weak** for next-day readiness | **Protein:** gains in fat-free mass plateau at 1.62 g/kg/day (95% CI 1.03–2.20), and ~2.2 is "prudent" for maximal gains (Morton 2018, 49 RCTs). ISSN gives 1.4–2.0, and 2.3–3.1 in a calorie deficit. Protein does not reliably speed recovery of muscle function after a single bout (Pasiakos 2014). **Energy availability** = (intake − exercise energy) / fat-free mass. LH pulsatility was disrupted below 30 kcal/kg lean mass/day in women (Loucks 2003), and 45 is the conventional "adequate" level. Male thresholds are unclear: effects appear at ~15–19 (Areta 2021). The 2023 IOC statement separates "problematic" from "adaptable" LEA rather than using one cut-off. | **Protein: directional ↑ with a plateau** on a 7-day average: 100 at ≥ 1.6 g/kg/day, falling below 1.4. **EA: one-sided sweet spot.** Flag a sustained 7-day EA below 30 kcal/kg FFM/day; ≥ 45 is adequate. Both are weekly modifiers, not daily weights. Unlogged food = missing, not zero. | **Context** | Morton RW et al. *Br J Sports Med* 2018;52(6):376–84. [doi:10.1136/bjsports-2017-097608](https://doi.org/10.1136/bjsports-2017-097608) · Mountjoy M et al. *Br J Sports Med* 2023;57(17):1073–97. [doi:10.1136/bjsports-2023-106994](https://doi.org/10.1136/bjsports-2023-106994) · Loucks AB, Thuma JR. *J Clin Endocrinol Metab* 2003;88(1):297–311. [doi:10.1210/jc.2002-020369](https://doi.org/10.1210/jc.2002-020369) |
| 11 | **Hydration status** | **Moderate** for performance once fluid loss is large; **weak** as a daily readiness input | Losing more than 2% of body mass as water compromises performance (ACSM 2007). A wide range of intakes is compatible with being well hydrated, and body water varies 600–900 mL a day (< 1% of body mass) (Cheuvront & Kenefick 2016), so **a fixed intake target is not supported**. Measure status instead. The WUT tool combines morning weight change, urine colour and thirst, and 2 or more markers present was accurate against urine markers (Keefe 2024). The reference change for body mass is 2.5% (Cheuvront 2010). | **Directional flag**, not intake volume: count how many WUT markers are present (morning weight > 1% below its 7-day median, dark urine, thirst). Flag at 2 or more. Score nothing when there is no morning weight. | **Daily flag** if a morning weight exists; otherwise drop it | ACSM; Sawka MN et al. *Med Sci Sports Exerc* 2007;39(2):377–90. [doi:10.1249/mss.0b013e31802ca597](https://doi.org/10.1249/mss.0b013e31802ca597) · Cheuvront SN, Kenefick RW. *J Am Coll Nutr* 2016;35(2):185–92. [doi:10.1080/07315724.2015.1067872](https://doi.org/10.1080/07315724.2015.1067872) · Keefe MS et al. *Br J Nutr* 2024. [doi:10.1017/S000711452300274X](https://doi.org/10.1017/S000711452300274X) |
| 12 | **Menstrual-cycle phase** (context for HRV, temperature, RHR) | **Strong** that phase shifts these signals | Meta-analysis of 37 studies (1,004 people): vagal HRV falls from follicular to luteal phase (d = −0.39), and more steeply into the premenstrual phase (d ≈ −1.2 to −1.3) (Schmalenberger 2019). Ava bracelet, 237 women, late luteal against follicular: wrist temperature +0.45 °C, HR +~4 bpm, respiration +~0.5 breaths/min *(computed from the paper's phase means)* (Goodale 2019). Oura: luteal finger temperature +0.30 °C (Maijala 2019). HR and temperature were higher in the mid and late luteal phase, while sleep and perceived readiness did not change (Alzueta 2022). | **Modifier, no weight.** Keep a separate baseline for each phase (follicular and luteal medians) for temperature, RHR, HRV and RR. Never score a luteal shift as illness. Applies only to users who menstruate; these studies used naturally cycling women. | **Context** | Schmalenberger KM et al. *J Clin Med* 2019;8(11):1946. [doi:10.3390/jcm8111946](https://doi.org/10.3390/jcm8111946) · Goodale BM et al. *J Med Internet Res* 2019;21(4):e13404. [doi:10.2196/13404](https://doi.org/10.2196/13404) · Alzueta E et al. *Int J Womens Health* 2022;14:491–503. [doi:10.2147/IJWH.S341917](https://doi.org/10.2147/IJWH.S341917) |
| 13 | **Time in daylight and circadian alignment** | **Moderate** (very large observational cohorts, long-term outcomes); **weak** for next-day readiness | Daytime light at the eye, and darkness in the evening. Consensus targets: daytime ≥ 250 lux melanopic EDI, evening ≤ 10 lux from 3 h before bed, ≤ 1 lux during sleep (Brown 2022). In UK Biobank the median was 2.5 h outdoors a day (IQR 1.5–3.5). Each extra hour went with less tiredness (OR 0.80–0.82), fewer insomnia symptoms and easier waking (Burns 2021). In 88,905 people, brighter days and darker nights predicted lower mortality (Windred 2024, PNAS). | **Directional ↑ with a plateau** for daytime outdoor hours, around the 2.5 h median. Evening light is directional ↓. **Hard to measure:** the ring has no light sensor and the phone is not at the eye, so self-reported outdoor time or a location proxy is the realistic input. | **Context** | Brown TM et al. *PLoS Biol* 2022;20(3):e3001571. [doi:10.1371/journal.pbio.3001571](https://doi.org/10.1371/journal.pbio.3001571) · Burns AC et al. *J Affect Disord* 2021;295:347–52. [doi:10.1016/j.jad.2021.08.056](https://doi.org/10.1016/j.jad.2021.08.056) · Windred DP et al. *PNAS* 2024;121(43):e2405924121. [doi:10.1073/pnas.2405924121](https://doi.org/10.1073/pnas.2405924121) |
| 14 | **Body-composition trend** (body fat %) | **Weak** for readiness | Consumer bioimpedance (BIA) scales disagree widely with DXA. Median fat-mass errors were −2.2 to −4.4 kg across three smart scales (Frija-Masson 2021), and a Tanita scale's limits for body fat % were 1.2 ± 9.5%. Changes agree better than single readings (Thomson 2007). Hydration distorts BIA (Kyle 2004). IOC REDs subgroup: no body-composition cut-off predicts performance, assessment should be infrequent, and focusing on it raises REDs risk (Mathisen 2023). | **No score.** Use a 4-week trend as context for energy balance and the goal pace (steady against the plan), and ignore day-to-day readings. | **Context** | Frija-Masson J et al. *JMIR Mhealth Uhealth* 2021;9(4):e22487. [doi:10.2196/22487](https://doi.org/10.2196/22487) · Mathisen TF et al. *Br J Sports Med* 2023;57(17):1148–58. [doi:10.1136/bjsports-2023-106812](https://doi.org/10.1136/bjsports-2023-106812) · Kyle UG et al. *Clin Nutr* 2004;23(5):1226–43. [doi:10.1016/j.clnu.2004.06.004](https://doi.org/10.1016/j.clnu.2004.06.004) |

---

## Notes per candidate

What the app already has comes from a read of `docs/architecture/readiness-tree.md`,
`packages/shared/src/types/day-checkin.ts` and `packages/shared/src/health/illness-radar.ts`.

1. **Wellness.** The morning check-in now asks two questions, Recovery and Sleep quality (1–5).
   Soreness and mood were retired as "double-ups". The research points the other way on two
   counts. Saw 2016 found single subscales more sensitive than totals. The best-supported single
   item is **fatigue**, which correlated with load at r = −0.51 in Thorpe 2015 and r = −0.42 over
   3 days in Thorpe 2017. Soreness correlated with load in McLean 2010 but not in Thorpe 2015, so
   it is optional. Duignan 2020 (*J Athl Train* 55(9):944–53,
   [doi:10.4085/1062-6050-0528.19](https://doi.org/10.4085/1062-6050-0528.19)) found the
   associations mostly trivial to moderate in the largest studies. Treat these items as a
   personal-baseline signal, not an absolute one. An earlier review in this repo found
   `perceived_recovery` stored as 3 on all 17 days, which is the pre-fill rather than an answer.
   Without the person actually answering, this channel has no signal.
2. **SRI.** The current "timing / consistency" unit is steady against usual bed and wake times.
   SRI is the published version of the same idea and has outcome data behind it. Windred's
   full-model all-cause hazard ratios against the least regular quintile were 0.80, 0.75, 0.72 and
   0.70 across Q2–Q5, so the gain flattens above ~79. Fischer 2021 (*Sleep* 44(10),
   [doi:10.1093/sleep/zsab103](https://doi.org/10.1093/sleep/zsab103)) shows SRI measures
   regularity from one day to the next and is sensitive to all-nighters. The UK Biobank cut-offs come from
   wrist accelerometers, so check where a ring hypnogram's SRI falls before trusting them. A
   search summary also mentioned a later study finding that two SRI calculators give markedly
   different scores on the same data. I did not verify it, but it is another reason to calibrate
   against the person's own distribution.
3. **Daytime and walking HR.** Buchheit 2014 (Table 1) gives a typical error of ~10% for resting
   HR against a smallest worthwhile change of ~2%, and ~3% against ~1% for controlled
   submaximal exercise HR. Overnight resting HR, which the app already scores, is the more
   standardised measure. Daytime still HR adds an illness channel (Mishra; Radin 2020,
   *Lancet Digit Health* 2(2):e85–93,
   [doi:10.1016/S2589-7500(19)30222-5](https://doi.org/10.1016/S2589-7500(19)30222-5)). It is
   confounded by posture, caffeine, meals, heat and stress.
4. **HRR.** Thorpe 2015 and 2017 found HRR did not track daily load. Daanen 2012 (*IJSPP*
   7(3):251–60, [doi:10.1123/ijspp.7.3.251](https://doi.org/10.1123/ijspp.7.3.251)) concluded it
   relates to training status but needs better standardisation. The H10 chest strap makes HRR
   measurable, but only after a repeatable effort, and a set of lifts is not one.
5. **VO₂max.** The app already derives it (`packages/shared/src/health/vo2max.ts`). Use it as a
   Level anchor for the Heart pillar, not as a daily unit. Lang 2024 (*Br J Sports Med*
   58(10):556–66, [doi:10.1136/bjsports-2023-107849](https://doi.org/10.1136/bjsports-2023-107849))
   is an umbrella review of 199 cohorts confirming the association. Only its title and record
   were read. For age- and sex-specific percentiles, see Kaminsky LA et al., FRIEND update,
   *Mayo Clin Proc* 2022;97(2):285–93,
   [doi:10.1016/j.mayocp.2021.08.020](https://doi.org/10.1016/j.mayocp.2021.08.020). Mandsager 2018
   grouped people by age- and sex-matched percentiles (< 25th, 25–49th, 50–74th, 75–97.6th,
   ≥ 97.7th), which is a ready-made Level scale.
6. **Breathing disturbances.** `breathing_disturbance_index` already exists in the schema (from
   Oura). The research supports a 14-night mean as a screening flag and nothing more.
7. **Respiratory rate and temperature.** These are already the top two weights in the illness
   radar (0.40 temperature, 0.25 breathing), and the research supports that order: temperature
   added the most AUC in Mason 2022, and respiration had the largest effect in Natarajan 2020
   (*npj Digit Med* 3:156, [doi:10.1038/s41746-020-00363-7](https://doi.org/10.1038/s41746-020-00363-7)).
   Two changes follow from the research. Floor the RR spread at ~0.5 breaths/min. Make the
   temperature threshold cycle-aware for users who menstruate.
8. **Alcohol and caffeine.** An "alcohol last night" context flag exists. Adding dose (drinks or
   g/kg) and the time of the last caffeine is cheap. The value is in explaining the morning and in
   feeding the insights engine, not in a weight.
9. **Training load.** Gabbett's "< 10% weekly increase" is, in his own paper, based on
   unpublished observations. Gabbett 2020 (*Br J Sports Med* 54(1):58–66,
   [doi:10.1136/bjsports-2018-099784](https://doi.org/10.1136/bjsports-2018-099784)) is his reply
   to critics, worth reading next to Impellizzeri 2021 (*Sports Med* 51(3):581–92,
   [doi:10.1007/s40279-020-01378-6](https://doi.org/10.1007/s40279-020-01378-6)) and Lolli 2019
   (*Br J Sports Med* 53(15):921–2,
   [doi:10.1136/bjsports-2017-098110](https://doi.org/10.1136/bjsports-2017-098110)). Sweet 2004
   (*J Strength Cond Res* 18(4):796–802, [doi:10.1519/14153.1](https://doi.org/10.1519/14153.1))
   validates sRPE for resistance training. Banister's HR-weighted TRIMP is set out in Morton,
   Fitz-Clarke & Banister 1990 (*J Appl Physiol* 69(3):1171–7,
   [doi:10.1152/jappl.1990.69.3.1171](https://doi.org/10.1152/jappl.1990.69.3.1171)). The app
   already has a 7:28 load unit with a 0.8–1.3 band. The research says to keep its weight low and
   to build it from sRPE across all sessions.
10. **Protein and energy availability.** Areta 2021 (*Eur J Appl Physiol* 121(1):1–21,
    [doi:10.1007/s00421-020-04516-0](https://doi.org/10.1007/s00421-020-04516-0)) is the clearest
    source on male data and on why the 30 kcal threshold is debated. Jäger 2017 (ISSN,
    *J Int Soc Sports Nutr* 14:20,
    [doi:10.1186/s12970-017-0177-8](https://doi.org/10.1186/s12970-017-0177-8)) gives the
    1.4–2.0 g/kg range. Pasiakos 2014 (*Sports Med* 44(5):655–70,
    [doi:10.1007/s40279-013-0137-7](https://doi.org/10.1007/s40279-013-0137-7)) is the reason
    protein is context rather than a next-day readiness input.
11. **Hydration.** The evening check-in has a "Hydration" scale (well hydrated … barely drank).
    That rates intake, which the research says is a poor guide to status. Thirst is one WUT
    marker. The other two are morning weight change and urine colour.
12. **Menstrual cycle.** The readiness tree already lists this as edge case 9. The magnitudes
    above are the reason. A late-luteal +0.45 °C, +4 bpm and +0.5 breaths/min is the size of an
    illness flag on every one of the radar's channels.
13. **Daylight.** Wright 2013 (*Curr Biol* 23(16):1554–8,
    [doi:10.1016/j.cub.2013.06.039](https://doi.org/10.1016/j.cub.2013.06.039)): a week of
    natural light while camping moved melatonin timing earlier. Phillips 2017: irregular sleepers
    had lower light amplitude and later melatonin. The evidence is good. Measuring it with a ring
    and a phone is the problem.
14. **Body composition.** The app stores body fat % from a scale. The literature supports showing
    the trend, not scoring it. The Tanita figure is from Pateyjohns 2006 (*Obesity* 14(11):2064–70,
    [doi:10.1038/oby.2006.241](https://doi.org/10.1038/oby.2006.241)). The change-tracking result
    is from Thomson 2007 (*Clin Nutr* 26(6):771–7,
    [doi:10.1016/j.clnu.2007.08.003](https://doi.org/10.1016/j.clnu.2007.08.003)): during weight
    loss, the limits of agreement for body fat % narrowed to about ±3.4%.

---

## Recommendation: the 5 additions with the best evidence-to-effort ratio

Ranked for a ring + phone app, given what the app already stores.

1. **Sleep Regularity Index, replacing the bed/wake "consistency" unit.** The outcome evidence is
   the strongest of any candidate (Windred 2024, n = 60,977), and the 2023 NSF consensus covers
   performance too. The ring already gives epoch-level sleep/wake, so this is pure computation
   with no new input from the user. Directional ↑, 100 at ≥ 87 and ~70 at the population median
   of 81. Check the ring-derived scale against these cut-offs first.
2. **A real multi-item morning wellness check, fatigue first.** This is the best-evidenced
   readiness signal there is (Saw 2016). The UI already exists. Score each item against the
   person's own median, never pre-fill, and treat an unanswered item as missing.
3. **Session RPE for every session, giving one internal-load number for lifting and cardio.** One
   tap after each workout. It replaces "lifting volume only" with the measure the research
   validates across modes, and HR-based TRIMP can be added when the strap is worn. Keep the ACWR
   band as a low-weight unit or spike warning, because the injury-prediction claim is contested.
4. **Alcohol dose and caffeine timing as explanatory tags.** The evidence is strong (Pietilä 2018;
   Gardiner 2023) and the effort minimal, since the alcohol flag exists. They get no weight, so
   nothing is counted twice. They explain a low morning and power the "how does X affect you"
   insight.
5. **Cycle-aware baselines, if the user menstruates; otherwise daytime still HR in the illness
   radar.** Cycle phase shifts temperature, RHR, HRV and RR by as much as an illness flag
   (Goodale 2019), so without it the radar misfires every month. For a user who does not
   menstruate, the next best is Mishra's daytime still-HR channel, built from HR and step data
   the app already stores.

**Not in the top five, and why.** Respiratory rate and temperature are already built into the
illness radar, which the research supports as it stands. HRR is ambiguous as a daily marker and
needs a standardised bout. VO₂max is already derived and only ever context. Breathing
disturbances are noisy across single nights and a screening matter. Hydration needs a morning
weight and urine colour. Protein and energy availability need food logging and act over weeks.
Daylight cannot be measured well by a ring or phone. Body composition from BIA is too noisy.

---

## Not verified, or verified only in part

- **Hooper index scoring** (four items rated 1–7 and summed) is widely described, but I could not
  read it in the 1995 paper. The abstract confirms only that daily well-being ratings predicted
  staleness.
- **McLean questionnaire wording** (five items, 1–5, fatigue / sleep quality / soreness / stress /
  mood) was checked only against the World Rugby reproduction. The PubMed abstract names fatigue,
  well-being and soreness.
- **AASM 1999 AHI bands (5 / 15 / 30)** come from secondary sources. PubMed has no abstract for
  the report (*Sleep* 1999;22(5):667–89, PMID 10450601, no DOI listed).
- **WUT cut-offs** (> 1% weight, urine colour, thirst; 2 or more markers) are as used in Keefe 2024's
  validation. The Cheuvront & Kenefick 2016 full text was not readable.
- **2023 IOC REDs statement:** only the abstract was read (the publisher returned 403). Its
  position on thresholds is taken from Areta 2021 and secondary summaries.
- **Buchheit 2014** typical-error and smallest-change figures were read from PMC Table 1 through
  a summarising fetch. They were consistent across two separate reads.
- **"Burns 2023, Nature Mental Health"** (day and night light and psychiatric disorders) was not
  found in PubMed, so it is not cited.
- Every number marked *(derived)* is my arithmetic from a cited figure, not a published cut-off.

## Side finding in this repo

`docs/architecture/component-references.md`, source 3, links Windred et al. 2024 to
**PMC10782489**. That PMC record is the accompanying editorial (Zuraikat et al., "Consistency is
key: sleep regularity predicts all-cause mortality"). The paper itself is **PMC10782501**,
doi:10.1093/sleep/zsad253. Under CLAUDE.md this should become an issue. I did not file one,
because this task was read-only.
