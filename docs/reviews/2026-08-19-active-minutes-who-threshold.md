# Active minutes: the WHO mapping is shifted one band, and moderate intensity has no zone

**Date:** 2026-08-19 · **Agent:** Tuning 🎶 · **Pillars:** `[activity]` `[heart-rate]`
**Resolves the open question in Q-523** — *what Zone 2 floor would actually carry signal.*
**Owner instruction that started it:** *"Use current recorded high and set a % off it to choose the
heart rate zones. Make it dynamic so as max HR increases the zones can too."*

**The owner's instruction is right, and on its own it fixes about a third of the problem.** Applying
it and then following where the numbers led turned up a second, larger defect that needs no owner
labels to fit: **`activeMinutesFromZoneSeconds` claims to implement the WHO convention and is one
band off it.** Together the two take the contributor from **0 on 53 of 59 days** to the **highest-
variance input in the Activity Score**.

---

## 1. The observed max already exists, and is deliberately not used for this

`resolveHrProfile` (`packages/shared/src/health/hr-profile.ts`) already computes exactly what the
owner asked for. It resolves **two** numbers on purpose, and its own comment explains why:

- **`maxHr`** — the ceiling. Uses the observed max **only when it is ≥ the age prediction**, because
  *"a low observed max usually means you haven't gone hard on a monitored session lately — that must
  not drag the ceiling down and make ordinary efforts read as maximal."*
- **`targetAnchorMax`** — for *reachable* targets. Uses the corroborated observed max whenever there
  is one, because *"220−age reads as a 20-year-old athlete's ceiling."*

Measured now: `estimatedMax` = **187** (220 − 33), corroborated `observedMax` = **167** (the 5th-
highest of 72,519 plausible readings over 90 days — `CORROBORATION = 5`, so a single spike cannot
move it; the raw peak is 168). Observed < estimated, so **`maxHr` stays 187 and the zones are built
off a ceiling this athlete has never come within 19 bpm of.**

**So the instruction resolves cleanly: active-minutes should anchor on `targetAnchorMax`, not
`maxHr`.** That is the existing, documented split — no new concept, no new constant, and it is
dynamic by construction: the observed max is a rolling 90-day order statistic, so the zones rise as
the athlete does. The conservative `maxHr` stays where it is for %-of-max effort math, which is what
it is for.

**On its own it is not enough.** Rebuilding the current zones off 167 (reserve 114 → Zone 2 at
**121 bpm**):

| | zero-minute days | mean min/day |
|---|---|---|
| current (`maxHr` 187, Z2 = 133) | **53 / 59** | 1.4 |
| observed (`targetAnchorMax` 167, Z2 = 121) | **38 / 59** | 2.6 |

Better, and still dead — because the band boundary itself is wrong for this purpose.

---

## 2. The real defect: "moderate" intensity has no zone at all

`activeMinutesFromZoneSeconds` documents its own contract:

> *WHO-style "active minutes" … Zone 2 "Light" (**≥60% HR reserve, WHO "moderate"**) counts once;
> Zone 3+ … (**WHO "vigorous"**) counts DOUBLE.*

**The WHO/ACSM thresholds are moderate = 40–59% of heart-rate reserve, vigorous = ≥60%.** So 60% is
where *vigorous* begins, not moderate. The mapping is shifted one band up, and the consequence is
structural rather than a matter of degree:

- What the code counts **once** as "moderate" (Zone 2, 0.60–0.70 reserve) is **vigorous** by WHO.
- **Moderate intensity — 0.40 to 0.60 of reserve — is not represented by any zone**, so it earns
  nothing.

Moderate is the band that ordinary movement lives in: brisk walking, carrying things, stairs. **It
has been scoring zero by construction**, which is why this contributor reads 0 on 90% of days and why
Q-522's sibling measurement found no relationship between steps and drain.

This is the same shape as **Q-516** (`PEAK_BANDS` calibrated for a range strength training never
reaches) and **Q-515** (a boundary anchored to the wrong reference), and it is the sixth instance of
the recurring lesson: *the threshold is right for what it says it measures; it is measuring the wrong
thing.* `ZONE_DEFS` is not wrong — those are **training** zones for cardio prescription and should be
left alone. The bug is in the roll-up that borrows them for a **public-health** question.

---

## 3. The fit, and why it needed no owner labels

Q-523 said a candidate floor needed days the owner would call "active" to fit against. **It does
not** — the threshold is published, and the code already names the standard it means to follow. The
only fitting required was confirming the published number behaves sensibly on this athlete's data.

Sweeping the moderate floor as a fraction of reserve off `targetAnchorMax` = 167 (bpm = 53 + f×114),
over 59 days:

| f | floor bpm | zero days | mean min | sd | days ≥ 22-min goal |
|---|---|---|---|---|---|
| 0.30 | 87 | 0 | 96.1 | 72.3 | 54 / 59 — meaningless, everything counts |
| 0.35 | 93 | 3 | 52.4 | 44.5 | 44 / 59 |
| **0.40** | **99** | **6** | **28.6** | 27.9 | **28 / 59** ← **WHO moderate** |
| 0.45 | 104 | 10 | 15.9 | 18.1 | 13 / 59 |
| 0.50 | 110 | 16 | 7.8 | 12.5 | 4 / 59 |
| 0.60 | 121 | 38 | 2.6 | 9.1 | 2 / 59 ← current rule, observed max |
| 0.60 | 133 | **53** | 1.4 | — | ~2 / 59 ← **shipped today** (age max) |

**The published threshold lands where a good target should**: about half the days clear the goal,
few are zero, and the sweep is smooth around it — 0.40 is not perched on a cliff, so a small error in
the max estimate does not swing the answer.

### The proposed rule, and what it does

Moderate = **[0.40, 0.60) of reserve, counts once**. Vigorous = **≥ 0.60, counts double**. Both off
`targetAnchorMax`. For this athlete today: **99–121 bpm ×1, ≥121 bpm ×2.**

| contributor `zoneMinutes` (weight 10) | shipped today | proposed |
|---|---|---|
| days reading **zero** | **53 / 59** | **6 / 59** |
| mean active minutes | 1.4 | **24.7** |
| median | 0 | 15.7 |
| max | 40 | 103 |
| days hitting the 22-min goal | ~2 | **23 / 59** |
| **sub-score mean** | ~6 | **63.8** |
| **sub-score sd** | ~0 | **38.7** |

**That makes it the highest-variance contributor in the Activity Score** — above `steps` (sd 33.4)
and `strengthVolume` (23.8), and it currently sits at the bottom. Combined with Q-522's `moveHours`
fix it converts 22 of 100 nominal weight from inert to informative, which is most of what the
[contributor audit](2026-08-19-activity-contributor-audit.md) found missing.

---

## 4. What this does NOT change, deliberately

- **`ZONE_DEFS` stays as it is.** Zones 1–5 are training zones with an established meaning; re-cutting
  them to serve the active-minutes roll-up would break cardio prescription to fix a public-health
  metric. Add the WHO bands as their own thing.
- **`maxHr` stays conservative.** Only the active-minutes path moves to `targetAnchorMax`. Anything
  computing %-of-max effort keeps the ceiling that cannot read low.
- **The strength-day suppression guard is untouched here**, but it should be **re-measured after this
  lands** — the guard exists because a lifting day scored a structural zero, and at a 99 bpm floor
  lifting days will no longer be zero. It may become unnecessary, or actively wrong.
- **The 120 s gap cap versus the ring's 300 s cadence is NOT fixed by this** (Q-523 §4). Ring-only
  days still keep 35% of elapsed time against a strap day's 84%, so the numbers above are floors, and
  cross-day comparability still needs that separate fix.

**Caveats.** One athlete, 59 days, `claude_ro` row-scoped. The WHO/ACSM band is a population
guideline, so it is the right *default* rather than a personal fit — which is the point: it replaces
an invented constant with a published one instead of with a differently-invented one. The 0.40 fit
was validated on this athlete only; a second user should re-run the sweep before it is assumed to
transfer.
