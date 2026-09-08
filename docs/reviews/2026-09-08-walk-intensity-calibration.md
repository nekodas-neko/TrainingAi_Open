# Can the interval walk be calibrated? Yes — and it explains Q-523 — 2026-09-08

*Tuning · production data pulled 2026-09-08. Files **TN-24**; supplies the mechanism for **Q-523**.
Propose-only. Counts are the owner's account only (`claude_ro` is row-scoped).*

Owner, after a 30-minute interval walk that logged **30:00 in Z1 Recovery and 0:00 in every other
zone**: *"now that we have some data including steps/HR/cadence etc. can we make any calibrations or
formulas for this to optimise the walk?"*

**Yes — three, and the first one explains why `zoneMinutes` has been floored at zero for months.**

---

## 1. Zone 2 is unreachable on foot, and that is arithmetic rather than fitness

`hr-zones.ts:38` builds zones as **fractions of heart-rate reserve** (Karvonen), with Z1 spanning
**0.0 → 0.6**. For this owner (resting **52**, max **168**, reserve **116**):

| zone | lower bound |
|---|---|
| Z1 Recovery | **52 bpm** |
| **Z2 Light** | **122 bpm** |
| Z3 Aerobic | 133 bpm |
| Z4 Hard | 145 bpm |
| Z5 Peak | 156 bpm |

**Z1 spans 52–122 bpm — 60% of the entire usable range in a single bucket.** Everything from sitting
still to a brisk interval walk is "Recovery".

**The max is real, so this is not a stale anchor.** `oura_heartrate` holds **140 samples above 150**
and a genuine peak of **168** (2026-07-05, with 166 on 07-24). The zones are anchored correctly; the
training simply never reaches them — **nothing above 140 bpm has been recorded since 2026-07-24**,
six weeks ago.

**This is Q-523's mechanism.** That entry records `zoneMinutes` floored at 0 on **53 of 59 days** and
has never had a cause. The cause is that the owner's training is walking and lifting, and **neither
can reach 122 bpm**.

## 2. Cadence is the wrong lever, and the data says how wrong

Across **88 intervals over 10 sessions** with both cadence and HR:

| | |
|---|---|
| `corr(cadence, HR)` | **+0.512** |
| slope | **0.288 bpm per spm** |
| mean cadence separation, fast vs slow | **27.2 spm (31% faster)** |
| **mean HR separation, fast vs slow** | **7.9 bpm** |
| mean fast-interval intensity | **40.1% of reserve** (Z2 needs 60%) |
| best fast interval ever | **50.5% of reserve** (2026-08-18) |

**A 31% cadence increase buys 7.9 bpm.** Extrapolating the fit, averaging 122 bpm would take
**≈198 spm** — that is a run, not a walk.

**So the protocol's own control variable is nearly exhausted.** Walking speed is cadence × stride, and
at the owner's measured **0.739 m** stride (see
[2026-08-31](2026-08-31-measured-stride-from-cadence.md)) the achievable speed range simply does not
demand much cardiovascularly. **Grade or carried load are the levers that remain** — both raise the
metabolic cost at a walking speed the owner already sustains, where cadence cannot.

## 3. The protocol is not progressing

| date | fast spm | slow spm | fast HR | ΔHR | % reserve |
|---|---|---|---|---|---|
| 2026-08-01 | 123.5 | 116.6 | 103.1 | 9.8 | 44.1% |
| 2026-08-05 | 127.0 | 108.3 | 103.5 | 9.0 | 44.4% |
| 2026-08-07 | 125.2 | 90.1 | 100.4 | 9.6 | 41.7% |
| 2026-08-14 | 112.1 | 86.3 | 86.8 | 5.2 | 30.0% |
| 2026-08-18 | 118.0 | 86.7 | **110.6** | 6.4 | **50.5%** |
| 2026-08-19 | 120.2 | 87.7 | 96.2 | 8.2 | 38.1% |
| 2026-09-02 | 116.2 | 88.4 | 102.2 | 4.4 | 43.3% |
| 2026-09-04 | 117.7 | 84.6 | 96.0 | 10.0 | 37.9% |
| 2026-09-07 | 115.3 | 85.3 | 92.6 | 7.8 | 35.0% |
| 2026-09-08 | 112.3 | 81.1 | 93.4 | 8.6 | 35.7% |

**Fast/slow HR separation trends at −0.11 bpm per session** — flat across ten sessions. And **fast
cadence has fallen 123.5 → 112.3 spm** while slow cadence fell further (116.6 → 81.1), so the
*contrast* improved while the *effort* declined. A protocol whose hard intervals are getting easier is
not progressing.

**⚠ This is a description, not a diagnosis.** Ten sessions, one subject, and no controlled
comparison. The declining trend could equally be seasonal, terrain, or deliberate.

---

## What to build

**(a) Report intensity against something a walk can reach.** The zone bar is structurally uninformative
for this training. Either add a walking-appropriate band below Z2, or surface **% of heart-rate
reserve** directly on the summary — 40.1% is a meaningful, movable number where "Z1, 30:00" is not.

**(b) Coach the lever that works.** The app currently prescribes cadence. The data says cadence is
near its ceiling for HR purposes. **A prescription targeting a heart-rate band, with grade or load as
the suggested adjustment, is the one that can actually move the number.**

**(c) Progress on measured separation, not on prescribed cadence.** The natural target is fast/slow HR
separation, which has been flat at 7.9 bpm. **Do not ship a target number from this review** — ten
sessions is not enough to set one, and a target that cannot be hit is the Q-504 mistake.

**⛔ Do not "fix" this by lowering the zone boundaries.** The Karvonen fractions are conventional and
the max is genuine; moving Z2 down to make walks qualify would make the zone label mean something
different from every other use of it, and would silently re-score history. **The fix is what the app
reports, not where the boundaries sit.**

---

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK. **The
zone bounds were computed by hand from `ZONE_DEFS` and the owner's profile, not by executing
`computeHrZones`.** The cadence→HR slope is a linear fit to 88 intervals (r = 0.512, so it explains
~26% of the variance) and is used only to show that the required cadence is far outside the observed
range, not to predict any individual interval. **17 of 106 segments carry a distance**, so nothing
here rests on pace. Ten sessions, single subject.
