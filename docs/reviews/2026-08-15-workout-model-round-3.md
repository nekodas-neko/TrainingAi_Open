# Workout model, round 3 — the 1RM question, volume landmarks, and a correction to Q-298

**Date:** 2026-08-15 · **Against:** `main` at `47a760e` (v1.317.x) · **Type:** review, docs-only
**Fourth of four:** [scoring pillars](2026-08-15-comprehensive-app-review.md) →
[six unused lenses](2026-08-15-uncovered-lenses-review.md) →
[pillar model soundness](2026-08-15-pillar-model-soundness-review.md) → **this**
**Backlog:** Q-304, Q-305 filed · **Q-298 amended in place** (it was partly wrong)

Picking up the items the previous review listed as *not started*. Two are done here. **Four are
still not done and are named in §5** rather than quietly dropped.

---

## 0. First: I broke `main`, and the fix is in this PR

A merge resolution staged with `git add -A` committed **four files with their conflict markers
intact** — 21 marker lines. They passed **Lint, Tests, Build, Migration Check, Custom Rules and
E2E**, all six green, and merged in #1380. Nothing looks at markdown for this, and `<<<<<<< HEAD`
is ordinary prose to every other tool.

Fixed here, and `scripts/check-conflict-markers.js` is added to the Custom Rules job so it cannot
recur (**Ran 36 of 36** locally). It scans every tracked file and anchors on the exact forms git
emits, so a doc quoting a diff does not trip it. Verified in both directions — clean on the tree,
exit 1 on a planted marker.

No backlog entry: it is fixed in the same PR.

---

## 1. Correction — Q-298 was half wrong

Q-298 filed all ten zero-`estimated_1rm` rows as one defect. Reading the write path settles it,
and **half of them are working as designed**.

`packages/shared/src/1rm.ts:158`, inside `estimateOneRm` — the function the write path
(`log-exercise.ts:194`) actually calls:

```ts
if (deloaded) return { estimated1rm: 0, target80: 0, targetPct }
```

**The five 2026-08-06 rows all have `exercise_deloaded = true`. They are zero on purpose** — deload
work is submaximal and must not feed a 1RM. That is correct behaviour and Q-298 called it a bug.

**What survives the correction, and it is narrower and better-specified:**

Storing **`0` rather than `null`** as the sentinel is still wrong, and it is the part that produced
the visible damage: my own first-vs-last trend query read those exercises as **−100%**. A null
propagates as "no estimate"; a zero propagates as an estimate of zero.

**And the five 2026-08-09 rows are still unexplained by that**, since they carry
`exercise_deloaded = false`. Their `set_logs` narrow it to at least two distinct mechanisms:

```
Barbell Shrug           4 × 87.5 kg × 6   use_for_1rm=TRUE    → should compute ≈103 kg, stored 0
Sumo Deadlift           4 × 82.5 kg × 6-7 use_for_1rm=TRUE    → should compute, stored 0
Bent-Over Barbell Row   4 × 30 kg × 6     use_for_1rm=TRUE    → should compute, stored 0
Dumbbell Preacher Curl  3 × 16.25 kg × 12 use_for_1rm=FALSE   → no qualifying set
Pull-Up                 3 × 0 kg × 5      use_for_1rm=FALSE   → bodyweight, weight_kg = 0
```

- **Pull-Up** is the bodyweight path. `estimateOneRm` substitutes `max(1, bwRef + weightKg)` = 100
  **only when `exerciseType === 'bodyweight'`**. If that did not resolve, `weights` is 0, the
  `!(w && r)` filter drops every set, `oneRMs` is empty, and `calculate1RM` returns **0**.
- **Preacher Curl** has `use_for_1rm = false` on all three sets. When the style has *some*
  `useFor1rm`, `calculate1RM` filters to those indices — none qualify, `oneRMs` is empty, **0**.
- **Shrug, Sumo Deadlift and Bent-Over Row have real weights, real reps and `use_for_1rm = true`.
  They should compute. Three rows remain genuinely unexplained.**

Corroborating that the zero was written at compute time rather than overwritten later: every one of
those sets has `intensity_pct = NULL`, and the write path derives it as
`computeIntensityPct(weight, estimated1rm)` — which is null exactly when the estimate is 0.

`runningEstimate1RM` already has a fallback for the empty-`oneRMs` case ("fall back to averaging all
logged sets so a number always shows from set 1"). **`calculate1RM` does not, and the write path
uses `calculate1RM`** — so the live widget shows a sensible number while the saved row gets 0.

Q-298 is amended in place with all of this rather than re-filed.

---

## 2. I4 — the 1RM question at high reps

`repFactor` averages Epley and Brzycki, **freezing the Brzycki term at 20 reps** so it cannot blow
up toward its 37-rep pole, with `REP_CEILING = 30` above which nothing is estimated. That is
careful, deliberate engineering and better than most implementations.

`amrapScaleFactor` exists precisely for high-rep inflation — 1.0 / 0.97 / 0.93 / 0.88 / 0.82 by rep
band — and is applied by **`calcAmrap1RM`**. But `estimateOneRm`'s ordinary path calls
**`calculate1RM`**, which does not apply it.

Measured against production (`set_logs`, `deleted_at IS NULL`):

| rep band | sets | **feeding the 1RM estimate** |
|---|---|---|
| 1–5 | 40 | 32 |
| 6–8 | 497 | 390 |
| 9–12 | 411 | 191 |
| **13–20** | **59** | **27** |
| **21+** | **2** | **2** |

**29 sets at 13+ reps feed the estimate on a path with no AMRAP correction**, where the band's own
scale factor would be 0.88 or 0.82 — a 12–18% reduction.

**The honest qualifier, and it matters:** `prescriptionFactor` rescales by
`1 / ((pct/100) × repFactor(targetReps))` when a style supplies both. Where a style is present that
normalisation may absorb most of the inflation. Where it is absent, `factor = 1` and the raw
`repFactor` stands. **I did not establish how often a style is present on those 29 sets**, so this
is a flagged risk with a measurement attached, not a proven defect. Filed as **Q-304** with that
distinction written into the entry.

---

## 3. Volume landmarks — computed, and never shown to anyone

Weekly sets per muscle over the last 7 days, unnested from `exercise_logs.muscle_groups` and
compared against `MUSCLE_LANDMARKS`:

| muscle | sets/7d | MEV | MAV | MRV | |
|---|---|---|---|---|---|
| triceps | 17 | 6 | 12 | 20 | above MAV |
| biceps | 14 | 6 | 14 | 22 | at MAV |
| shoulders | 13 | 8 | 16 | 22 | MEV–MAV |
| hamstrings | 12 | 6 | 12 | 18 | at MAV |
| glutes | 12 | 4 | 10 | 18 | above MAV |
| chest | 11 | 8 | 16 | 22 | MEV–MAV |
| **lats** | **9** | **10** | 16 | 22 | **below MEV** |
| quads | 8 | 8 | 14 | 20 | at MEV |
| **upper back** | **7** | **8** | 14 | 20 | **below MEV** |
| **calves** | **2** | **8** | 14 | 20 | **quarter of MEV** |

**The finding is not the numbers — it is that nothing surfaces them.** `volume-targets.ts` computes
landmarks, `program_volume_targets` exists as a table, and no screen tells the owner that calves are
at a quarter of their minimum effective volume while triceps sit above MAV. This is the same
"computed and discarded" class as Q-278 and Q-302. Filed as **Q-305**.

**One week is a small sample** and the entry says so — a light week is not a programming defect. The
durable part is the absent surface, not this particular week.

### A finding that died on verification

`core` is tagged on exercises and absent from `MUSCLE_LANDMARKS` (which has `abs`/`obliques`),
which looked like a silent fall-through to `DEFAULT_LANDMARKS`. It is not: `muscles.ts:17` maps
`core: 'abs'` and `volume-targets.ts:58` applies `normalizeMuscle` **before** the lookup. Working
correctly. **Fourth finding to die on verification across these four reviews** — a rate worth
stating, since it is the process working rather than failing.

---

## 4. Surfaces NOT exercised

- No device, emulator, browser or `pnpm dev`. Docs-only.
- **The three unexplained 2026-08-09 rows were not root-caused** — narrowed, not solved.
- **How often a progression style accompanies a 13+ rep set was not measured**, which is the
  qualifier on §2.
- Volume landmarks are **one week** of one user.
- `error_events` prunes at 30 days.

---

## 5. Still not started, after four reviews

Named so nobody reads four review documents as completeness:

| item | status |
|---|---|
| **Deload policy** — does it fire at defensible times? | **not started** |
| **Phase engine** — do phases progress sensibly? | **not started** |
| **Muscle balance / exercise selection** (push:pull, coverage) | **not started** |
| **Cardio pace/HR model** across 47 activity logs | **not started** |
| Systematic AI-output audit | partial — 8 of 117 read |
| Degradation matrix against a running app | desk-only (Q-294) |
| **"What breaks at 10 users, at 100"** | **not answered — fourth time** |

The last one needs load testing against a seeded multi-user database, not reading. It will not
close by inspection, and listing it again without saying that would be dishonest.
