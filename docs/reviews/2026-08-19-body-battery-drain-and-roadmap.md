# Body Battery measures how long you wore the ring, not what you did — and the roadmap to fix it

**Date:** 2026-08-19 · **Agent:** Tuning · **Type:** diagnosis + design brief, docs-only
**Filed as:** Q-521 · **Lane:** A implements · **From:** an owner brief

> *"body battery still doesn't seem that good… I assume body battery should be 0 if training is hit,
> step count is hit or exceeded, movement per hour is good, calories burned is good… so in a day i
> just workout and no walks/movement, id expect a bit of reserve at the end of the day. on a day where
> I have done everything, id expect to see 0. id like that type of granular drain."*

**The owner is right, and the reason is worse than "needs tuning": the drain model does not respond to
activity at all.**

---

## 1. Diagnosis — drain tracks wear time, not exertion

51 days of `body_battery_daily` joined to steps and completed workouts:

| relationship | measured | what it should be |
|---|---|---|
| `corr(hr_sample_count, total_drained)` | **+0.518** | — |
| `corr(steps, total_drained)` | **−0.153** | strongly **positive** |
| `corr(steps, end_value)` | **+0.112** | strongly **negative** |
| `corr(total_drained, end_value)` | −0.674 | negative ✓ (the only sane one) |

**The strongest predictor of the battery ending low is how many HR samples were recorded — i.e. how
long the ring was worn.** Steps are *negatively* associated with drain. More walking, very slightly
*less* depletion.

### 1.1 A workout makes no difference

| | n | mean `end_value` |
|---|---|---|
| workout days | 37 | **50.6** |
| non-workout days | 14 | **50.0** |

**0.6 points.** Training all but does not register.

### 1.2 The days that hit zero are the *quiet* ones

Four days ended at exactly 0. Their step counts: **828, ~3,020 (median), 4,152**. All low-movement
days. Meanwhile **16 of 51 days cleared the 8,000-step goal**, and those days did *not* end lower.

**So today, `0` means "you wore the ring a long time", and the owner wants it to mean "you did
everything". Those are close to opposites.**

### 1.3 Mechanism

`route.ts` drains as `-DRAIN_RATE × (hrr − REST_THRESHOLD) × dt` — purely heart-rate driven. Steps,
workouts, zone minutes and calories enter only through whatever they do to HR.

Combined with **Q-515** — the rest boundary has fallen to ~60 bpm as the owner got fitter — nearly
every waking sample now sits above the threshold, so drain accrues almost continuously. The
multiplier `(hrr − threshold)` varies far less than wear duration does, so **drain ≈ rate × time
worn**, which is exactly what the +0.518 correlation says.

**Q-521 is therefore downstream of Q-515.** Fixing the boundary's anchoring does not fix this on its
own, but leaving it broken will keep re-poisoning whatever replaces the drain model.

---

## 2. Roadmap — two of the three asks are already done or specified

The owner asked for the same treatment across sleep, activity and Body Battery. They are at three
different stages.

### 2.1 Sleep — **already delivered** (Q-503), just not visible

> *"id like sleep to show 90-100 when its really above and beyond the general sleep."*

The shipped `SCORE_CALIBRATION` already does this. Its top anchors are `[88.7, 97], [91, 99],
[93, 100]`, and the owner's best real night blends to 91 — so 100 is reserved, not routine. The
replayed distribution over 65 nights: `30s:4 · 40s:4 · 50s:9 · 60s:16 · 70s:9 · 80s:16 · **90s:7**`.

**7 of 65 nights (11%) score in the 90s.** That is "above and beyond" by any reasonable reading.

**Why it doesn't look done:** stored history is still the old model (mean 85.3, 27 of 36 nights ≥ 85),
and rows are only rescored when the route recomputes. **Nothing more to build here** — see Q-501/Q-518
for why history has not caught up.

### 2.2 Activity — **already specified** (Q-505), unbuilt

The redesign brief already states that hitting every target yields 100, with the owner's own
"what if I do too much" question resolved in its §4. It is waiting on Lane A. Its current sd of
**6.0** with zero days under 50 is the thing it fixes.

### 2.3 Body Battery — **the genuinely new work.** §3.

---

## 3. Design brief — an exertion-integrated battery

### 3.1 What the owner is asking for, stated precisely

Not a completion checklist. **Drain proportional to total exertion, scaled so that a full day of
everything approximately empties it.** That is why a workout-only day should leave reserve: less total
work was done than on a workout-plus-walking day. This is physiologically coherent and is roughly what
comparable products do.

### 3.2 The shape

- **Keep the morning anchor.** Starting reserve from readiness is correct — a bad night should start
  the day lower, and it already does.
- **Replace time-integrated HR drain with exertion-integrated drain**, combining the signals the owner
  named: steps/movement, HR above rest, workout load, zone minutes.
- **Normalise against that day's targets** (`getDailyGoals`), so "everything hit" lands near empty.
  This is the calibration anchor the brief is really specifying.
- **Floor at 0 and route the excess elsewhere.** Doing 150% of everything should not read the same as
  100%, but the battery cannot go below empty. The overshoot belongs in an overreach signal — the same
  resolution the owner already chose for Activity ("keep the 100, detract from readiness").

### 3.3 Two constraints the data imposes

1. **`active_calories` is unusable as a load-bearing input** — present on **8 of 51 days**. Steps are
   on all 51. Any design that needs calories will silently degrade to the HR-only model that is being
   replaced.
2. **Normalising to targets means a fitter person drains less for the same absolute work.** That is
   correct for a "did you do your day" meter and *wrong* for a "how depleted are you" meter. **The
   owner's brief chooses the former**, and that choice should be written into the model's comment so
   it is not silently reversed later.

### 3.4 The tension worth stating once

An exertion-scaled battery answers *"have I done my day?"*. It cannot also answer *"am I overreaching?"*
— on a target-hitting day both a well-recovered and an overreached athlete read 0. Overreach detection
already lives elsewhere (ACWR, readiness, the illness radar), and **this model should not be asked to
carry it.** Q-276 already flags that readiness and Body Battery share no variance while both being sold
as "recovery"; this brief makes Body Battery explicitly *not* a recovery number, which arguably
resolves Q-276 by picking a side.

---

## 4. Sequencing

1. **Q-515 first** (the rest boundary's anchoring). Not because it fixes this, but because every drain
   model built on top of a boundary that moves with fitness inherits the drift.
2. **Q-521** — the exertion-integrated drain, per §3.
3. **Q-505** (Activity) can proceed in parallel; it shares `getDailyGoals` but not the drain path.
4. **Re-measure with §1's four correlations.** They are the pass test: `corr(steps, total_drained)`
   must become clearly positive, and workout vs non-workout `end_value` must separate by much more
   than 0.6 points.

---

## 5. What was not exercised

- **No code changed.** §3 is a brief, not an implementation, and no drain model was prototyped or
  replayed — the numbers in §1 describe the **current** model only.
- **`corr` here is Pearson on daily aggregates**, n = 51, one athlete. The +0.518 wear-time
  relationship is strong enough to act on; the weaker ones (+0.112, −0.153) are best read as *"no
  relationship"* rather than as precise effects with a sign.
- **Steps are the only activity input with full coverage.** Zone minutes and movement-per-hour were
  **not** pulled or tested — §3 names them because the owner did, not because their coverage was
  verified. **That check belongs at the start of implementation**, since `active_calories` at 8/51
  shows how badly a missing input degrades things.
- **The sleep claim in §2.1 rests on the replayed distribution recorded in Q-503**, not on a fresh
  replay run here, and stored rows still show the old model.
- **No causal claim is made.** That drain tracks wear time is a correlation plus a reading of the
  drain expression; no controlled comparison was run.
- Every figure is **the owner's** (`claude_ro` is row-scoped), 51 days to 2026-08-19.
