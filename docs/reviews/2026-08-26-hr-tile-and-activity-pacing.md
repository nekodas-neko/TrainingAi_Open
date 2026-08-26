# What the HR tile should show, and whether an Activity pace score works — 2026-08-26

*Tuning · production data pulled 2026-08-26. Amends [`TN-13`](../implementation-backlog.md), files
**TN-17**, and reconciles [`TN-3a`](../implementation-backlog.md) against what actually shipped.
Propose-only. Counts are the owner's account only (`claude_ro` is row-scoped).*

Owner, on the HR tile: *"Maybe it needs to show you the average awake resting HR? … or maybe its
better to have resting HR comparison? not sure what could be used here?"* And on Activity: a
**pace-to-goal** score that starts near 100 at wake and decays unless you keep up.

Both were measurable rather than arguable.

---

## 1. The HR tile — the question is not *which* number, it is *against what*

### The candidates, measured over 70 days

A "waking rest HR" does not exist as a stored column, so it was computed: the **10th percentile of
BLE heart-rate samples between 08:00 and 21:00 Brisbane**, days with ≥50 samples. Coverage is good —
**70 days, mean 984 samples/day**.

| candidate | mean | night-to-night \|Δ\| |
|---|---|---|
| waking-rest HR (10th pct, 08–21) | 69.5 bpm | **6.24 bpm** |
| waking **median** HR | — | 8.65 bpm |
| nightly resting HR | — | 2.10 bpm |
| **the 7-day average the tile shows today** | 52 | **0.44 bpm** |

So the owner's instinct is right that a waking measure carries more day-to-day movement — **14× more
than the tile has today.**

### But movement is not usefulness, and the measurement says so

Against the morning check-in's `perceived_recovery` (**scale runs 1 = fully recovered … 5 = wrecked**,
`packages/shared/src/types/day-checkin.ts:17` — so a **positive** r is the correct direction):

| | r vs perceived_recovery | n |
|---|---|---|
| waking-rest HR, **raw bpm** | +0.176 | 51 |
| nightly resting HR, **raw bpm** | +0.129 | 46 |
| waking-rest HR, **Δ vs its own 7-day baseline** | **+0.291** | 51 |
| nightly resting HR, **Δ vs its own 7-day baseline** | **+0.278** | 43 |

**Expressing the same signal as a deviation from the owner's own baseline roughly doubles its
correlation with how they report feeling — for both candidates.** Choosing between waking-rest and
nightly moves the number far less (+0.291 vs +0.278) than choosing raw-vs-relative does.

That is the design answer, and it resolves the owner's *"not sure what could be used here"*: **the
tile's problem is not that it picked the wrong metric. It is that it shows an absolute bpm at all.**
69 bpm means nothing without knowing that your usual is 63.

### Reconciling this against the +0.557 quoted in the pillar review

The check-in lookback reported `restingHeartRate` at **+0.557**, and the raw-bpm figure here is
**+0.129**. Both are right and they are not the same pairing. Re-measured directly: the stored
**`readiness_contributors.restingHeartRate` score** (0–100, baseline-relative, higher = better)
against `perceived_recovery` (higher = worse) is **r = −0.553, n = 35** — the same magnitude, with the
sign carried by the two scales pointing opposite ways. Dropping the 4 `provisional: true` placeholder
days (score pinned at 50) is what takes it from −0.395 to −0.553, which is worth knowing before any
future correlation is run against that field.

**So the lookback's number was the baseline-relative contributor, not raw bpm** — which is the same
conclusion as the table above, arrived at from the other end: **0.13 raw, 0.55 baseline-relative.**

### What TN-13 should now say

Show **last night's resting HR with its delta against baseline** — "52 · +2 vs usual" — which was
already the recommendation, now with the reason measured rather than assumed. **The waking-rest HR is
worth a second tile, not a replacement**: it is the better *stress* candidate the owner intuited (it
moves 6.24 bpm/day and is computable from data already stored), but it needs its own entry and its
own validation, and it does not belong on a tile labelled "Heart Rate".

**⚠ What this does not establish.** n = 43–51, one subject, same-day pairing. `perceived_recovery`
is a 5-point ordinal treated here as continuous. And a correlation of 0.29 is a weak signal in
absolute terms — the claim is that baseline-relative is **twice as good as raw**, not that either is
strong.

---

## 2. Activity as a pace-to-goal score (TN-17) — the mechanism works, the goals do not

The owner's design: at wake you start near 100; the target for each contributor is prorated across
the waking day; you stay at 100 by keeping up and decay if you fall behind.

**The data it needs exists.** `body_metrics.steps` is a **running daily total** — `updated_at` moves
through the day on every recent row — so "steps so far" is answerable at any hour without new
plumbing.

**⛔ But `step_live_windows`, the obvious intraday source, is effectively empty: 8 rows across 6 days
since 2026-07-22, 7,745 steps total.** A pacing implementation that reaches for it will read a flat
zero. Use the running daily total.

**The real obstacle is that the goals are not calibrated to the owner.** Over the last 60 days:

| | |
|---|---|
| median daily steps | **4,649** |
| mean | 5,511 |
| days reaching 7,000 (the stored `users.steps_goal`) | **19 of 60 — 32%** |
| days reaching 10,000 (the derived goal for `activity_level = 'moderate'`) | **9 of 60 — 15%** |

**A pace score against 7,000 sits below par on two days in three, and below par against 10,000 on
five days in six.** Today's score is a lenient average that reads 63–82; the pacing version of the
same day would read red from mid-morning onward. **That is a worse tile, not a better one** — and it
would arrive as "the app now says I'm failing", which is the Q-504 failure mode in a new costume.

**So TN-17 ships only with Q-524 resolved** — three step goals are live simultaneously (7,000 stored,
10,000 derived, 8,000 dormant default) — and with a goal the owner actually sets. The pacing
mechanic is sound; **it makes goal calibration load-bearing in a way the averaging version hides.**

**And two of the four contributors cannot be paced at all today**: `zoneMinutes` is floored at 0 on
53 of 59 days (Q-523) and `activeEnergy` is present on 8 of 51. Pacing a contributor that is
structurally absent produces a guaranteed decay to zero. **Pace only what is measured** — steps
today, MET-derived movement after TN-11.

---

## 3. TN-3a has shipped, and its queue entry did not notice

`oura_daytime_stress_buckets` exists (migrations **212** and **213**) and is writing: **69 rows
across 2026-08-24…26, ~26 buckets/day**, which is the 30-minute series over a ~13-hour waking day.
The per-bucket persistence TN-3a asked for is live.

**What has NOT happened is the back-fill.** History begins 2026-08-24, so *"which hours cause most
stress"* is answerable over three days and no further. TN-3a's own entry already anticipated this —
it says TN-3b is *"blocked on a back-fill existing, not merely on the table existing"* — so the entry
stays queued with a `Keep:` naming the back-fill, rather than being deleted as done.

**This does not unblock TN-3b.** The mechanism now exists; the reason TN-3b and TN-16 are parked is
Q-507's sign, which is unchanged.

---

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK. The
waking-rest HR is a **derived** quantity computed in SQL for this review; **nothing in the app
computes it**, so its coverage is a claim about stored samples, not about a shipped code path. Every
correlation is same-day and single-subject; none establishes direction of causation.
