# Cardiovascular Health system — design spec (2026-07-26)

> **Decision record from a grilling session with the owner.** Everything marked **D-n** is a
> settled decision, not a proposal — a fresh agent should implement to these, not re-litigate
> them. Companion document: [`2026-07-26-running-system-redesign-brief.md`](2026-07-26-running-system-redesign-brief.md)
> (current-state audit, workout parallel, Activity Score analysis).
>
> Status: **spec complete, one item unconfirmed** (phasing — see §9).

---

## 1. The shape: a hub, and one program hanging off it

**Three layers, deliberately loosely coupled** (owner, 2026-07-26):

```
Cardiovascular page  ← the HUB
├── Your cardio profile — min / max / avg HR, resting HR, trend
├── This week's quota  — minutes remaining per HR zone, steps remaining (day + week)
└── What do you want to do?
    ├── Run       → THE RUNNING PROGRAM: own goal, own progression, anchors, push sessions
    ├── Walk      → guided walk — a tool, not a program
    └── Activity  → any logged activity — treadmill, cycle, whatever
```

**The only coupling between them is metrics.** Whatever you do, its zone minutes and steps draw
down the shared weekly quota. Running is otherwise **a completely separate system** with its own
goal and progression; walk and activity are metric contributors with no program, no anchor and
no progression of their own.

*Why this matters:* it removes most of the cross-modality complexity. There is no need to
reconcile a walk's pace against a run's, no per-modality anchor bookkeeping, and no
"which modality should today be?" arbitration. The hub shows what's outstanding; you pick a
tool; the tool reports metrics back.

---

## 2. Decisions

### D-9 — The week is a QUOTA, filled opportunistically (the load-bearing one)

> Owner: *"you have x amount of HR zone minutes left in this zone, and x in this zone, and x
> steps for the day/week — what would you like to do. walks and runs both complete it. it's
> just the user's choice. treadmill should also be here/other activity as it can take these
> minutes off too."*

**Not** a day-by-day schedule and **not** "2 runs + 3 walks assigned to days". The week holds:

- **Per-zone remaining minutes** — Z1…Z5, each with a target and a drawn-down actual
- **Steps remaining** — daily and weekly

**Any activity draws the quota down** — run, walk, treadmill, generic logged activity. The user
picks; the app never forces a modality. "2 runs + 3 walks" survives only as an *emergent
expectation*, never a prescription.

The user picks by **time available** — a small gap → the 30-min walk; an evening free → the run.
The hub may suggest the highest-value option for the time on offer, but it is **always a
suggestion, never an assignment**.

### D-10 — Lifting workouts contribute to the zone quota (already true — verified)

Owner requirement: gym workouts must draw down the HR-zone quota too. **This already works and
needs no build.** Verified 2026-07-26:

- `computeDayZoneSeconds` (`slices/oura.ts:633`) takes the **whole local day**
  (`00:00:00`→`23:59:59` in user tz), reads every HR sample via `getHrForWindow`, and runs
  `accumulateZoneSeconds`. **It has no concept of activities** — it is modality-agnostic by
  construction.
- So any time HR is recording — lifting, running, walking, mowing the lawn — those minutes land
  in the zone totals. HR during workouts is already captured (chest strap + ring, plus
  `set_hr_stats` / `workout_hr_stats`).
- **Not double-counting** against the Activity Score: lifting feeds `strengthFreq`/
  `strengthVolume`, and its HR feeds `zoneMinutes`. Different components measuring different
  things (did you train / how hard did your heart work). Intentional.

**Design consideration this raises — passive fill.** Because the quota draws from all-day HR,
low zones fill without deliberate exercise. Z1 is 10–35% of the weekly target depending on
framework (`aerobic-recovery` is 0.35), so a chunk of it accrues from ordinary daily movement.
That is *correct* for the health-floor reading of the quota, but misleading as a "did I train
enough" signal. The hub should either weight its display toward **Z2+** (the zones that need
deliberate effort) or distinguish session-earned from passively-earned minutes. Decide in
planning — do not silently let Z1 auto-complete and imply the week is done.

### D-11 — Quota shape: research-driven split, personalised volume

The per-zone **proportions** stay research-driven — you cannot honestly personalise "what fraction
of my week should be easy" without lab testing. They already exist as per-goal weights in
`lib/running/zone-targets.ts` (Seiler 80/20, WHO 150 min/wk, zone-2 emphasis for heart health).

The **total weekly minutes** are personalised: seeded from the user's actual current volume and
grown ≤10%/week. Same shape, different size — a beginner and a fit runner get the same
distribution scaled to what they can absorb.

Resolves the D-1 sub-decision: the running plan's framework supplies the shape; the volume comes
from observed capacity. Falls back to a neutral health-floor distribution when no running plan
exists.

### D-12 — Cadence is a tracked metric, not a goal

Owner decision. There is no cadence goal and no cadence-driven progression. **This does not
change D-4** — cadence is still captured (Polar PMD first, ring fallback) and displayed on the
live and session screens; it simply never becomes a target to train toward. Removes the "is
cadence a goal?" open question and one branch from the progression engine.

### D-13 — Benchmark re-test rhythm: 4 weeks, or earlier on a breakthrough *(running only)*

Applies to goals measured by a periodic benchmark (pace). Standard training practice is every
**4–6 weeks**: under ~3 weeks adaptation hasn't occurred, and a time trial is itself a hard
session that costs recovery. Four weeks also aligns with a block.

**Refinement:** re-test at 4 weeks **or earlier if an ordinary session shows an unusually large
jump**, so a breakthrough isn't sat on. Continuously-measured goals (distance-in-fixed-time,
zone-time, efficiency) need no re-test — every session is a measurement.

### D-14 — The guided walk targets EFFORT, not heart-rate zones

**Owner tested this: walking often cannot reach the prescribed HR zones.** Prescribing "fast
block ≥132 bpm" asks for a number the walker's legs may not be able to produce, which reads as
failure at no fault of theirs.

- Blocks are set by **effort** — "as brisk as you can hold" / "comfortable stroll".
- The walk may carry an optional **beat-your-last goal** (distance from the last comparable walk).
- The week's zone contribution is presented as an **estimate** from recent walks, never a promise.
- **Zones actually reached are reported at the end**, where they're an observation rather than a
  target.

Consistent with the 2026-07-23 guided-walk decision that pace leads and HR is secondary
(cardiac drift makes HR a poor fast/slow discriminator while walking).

### D-1 (REVISED 2026-07-26) — Running is a separate program; walk/activity are contributors

> Owner: *"the running system can be completely separate to walk/activity as it's only the
> metrics that it's completing need to carry over… running can stay the same, you choose what
> your goal is and it works towards it."*

| Layer | Owns | Does NOT own |
|---|---|---|
| **Cardiovascular hub** | the weekly zone/step quota, the HR profile display, the modality choice | any goal or progression of its own |
| **Running program** | goal, framework, progression, baseline anchor, push sessions, plateau handling, block review | anything about walks |
| **Walk / Activity** | execution + metric reporting | no goal, no anchor, no progression |

**Supersedes the earlier "one goal, both modalities serve it, per-modality anchors" decision.**
The consequences are all simplifications:

- **Walks do not progress** — the previously-open Q-E is closed the other way. A guided walk is
  a tool you use; it contributes zone minutes and steps and nothing more.
- **No per-modality anchor bookkeeping** — only running has an anchor, so D-3 (push sessions),
  D-5 (environment tagging), D-7 (plateau) and D-8 (block review) apply **to running only**.
- **No modality arbitration** — the app never decides "today is a walk".

**Open sub-decision — where does the per-zone quota shape come from?** `weeklyZoneTargets()` is
framework-driven, and the framework now belongs to running. Two options:
1. **The running plan's framework shapes the whole week's zone split** (everything draws against
   it), falling back to a neutral health-floor distribution when no running plan exists.
   *Recommended* — keeps `weeklyZoneTargets` useful and means the goal genuinely shapes the week.
2. **The quota is modality-agnostic health floor only** (WHO 150 min/wk + `getDailyGoals()`),
   and the running framework shapes only how *running sessions* are prescribed.

Decide this in planning; option 1 is the stronger default.

### D-2 — Weekly targets are an always-on FLOOR; the goal is the improvement axis
Every program enforces the weekly zone/step quotas regardless of goal. The goal supplies what
*improves*:

| Goal | Existing `GoalKind` | Improvement axis |
|---|---|---|
| pace | `speed` | time over a benchmark distance ↓ |
| distance | `endurance` | distance covered in the session ↑ |
| heart health | `heart_health` | **efficiency — HR-at-pace ↓** |
| recovery | `recovery` | HRR1 / resting HR |
| cadence | *(new)* | steps/min ↑ at a given pace |

*Rationale:* "hit 154 zone-min/week" is compliance — once met there is nowhere to progress,
which is the flat feeling being fixed. Efficiency gives heart-health an unbounded axis.

### D-3 — Adherence targets by default; beat-it only on push sessions *(running only)*
- Most sessions carry an **adherence** target ("stay in Zone 2") — hitting it is success even
  if slower than last time.
- **~1 in 4–5 is a push/benchmark session** with an explicit "beat 4.2 km".
- Progress tracked every session, **challenged** only on push days.

*Rationale:* an every-session PR target contradicts the polarized 80/20 model already in
`lib/running/frameworks/`, is the standard overtraining route, and manufactures constant
failure at plateau.

### D-4 — Cadence: Polar accelerometer first, ring fallback

✅ **SHIPPED 2026-07-27 (PR #790, `2ff34ef`) — retracted as an open decision.** This section
originally scoped Polar cadence as a new, blocked native workstream (quoted below as the
historical record of what was decided and why); a parallel session built and merged it while
this plan was being implemented. **No plan or implementation work remains open here** — see
`lib/health/cadence.ts`, `PolarProtocol.kt`/`PolarGattClient.kt`/`PolarStrapService.kt`,
migration `140_activity_cadence.sql`, `components/activity/cadence-readout.tsx`, and
`app/admin/cadence/page.tsx` (the calibration console). Two independent derivations land in one
module exactly as this decision anticipated — ring `stride_frequency` + a new Polar accelerometer
DSP (gated on foot-based activity types, correctly excluding cycling and correctly *including*
the treadmill, where cadence matters most) — with `cadence_source` recording which one produced
each stored reading. **Still device-gated**, per the shipping commit: "nothing that produces a
cadence number is verifiable without a device" — the native strap path needs the rebuilt APK
before it can be trusted, same caveat this decision always carried.

**Original decision (superseded by the above, kept for context):** *Owner reaffirmed after cost
was flagged — a new native workstream, not a wiring job. `PolarProtocol.kt` implemented only the
standard HR service (`0x180D`/`0x2A37`); no accelerometer, no PMD, no RSC. Requires Polar's
proprietary PMD GATT service + control-point protocol, raw 3-axis ACC → cadence DSP, new Kotlin,
APK rebuild, on-device accuracy validation, with UUIDs/byte layouts verified against the pinned
Polar SDK source. Fallback: ring `stride_frequency` when the strap isn't worn — its Hz bands
were still provisional (sub-plan D-2 open), needing its own counted-walk validation. No cadence
column existed on `activity_logs` — a migration was required regardless of source.*

### D-5 — Sessions are environment-tagged; anchors compare within environment *(running only)*
Every session records indoor/outdoor. Anchors and PRs compare like-for-like only, so a
treadmill run can be a push session but against treadmill history. Prevents manually-typed belt
distance and permanent zero-elevation from corrupting the outdoor trend.

Note `treadmill` is deliberately `is_distance_based = false` (migration 101 — it was drawing
wandering GPS routes indoors). HR-based goals work identically indoors; only
distance/pace/elevation degrade.

### D-6 — Visualisation: full pass, one hero interactive chart
Both per-session detail **and** trends, designed together as one visual language.

- **Hero (interactive):** scrub the HR/pace timeline → a marker slides along the route map
  showing position + HR at that moment.
- **Everything else static but dense:** elevation profile, pace-per-km bars, cadence trace,
  splits table, time-in-zone donut; trends = efficiency curve, weekly zone stacks,
  distance/pace vs anchor, cadence trend, PR history.
- Confines Samsung-WebView perf risk to one component.

**Hard constraints:** `chart.js` + `react-chartjs-2` and Leaflet are already installed — no new
charting dep. **Never pass a `var(--x)` string to canvas paint APIs** — it silently renders
black (documented recurrence). Resolve tokens via `resolveColor`. Theme-aware in both schemes.

### D-7 — Plateau: change the stimulus, then re-test *(running only)*
Three missed push targets → switch structure (steady ↔ intervals) or insert a lighter week,
then re-test. Treats a plateau as an exhausted stimulus, not a failure. **Mirror the lifting
machinery** — `emergency-deload.ts`, `deload-constants.ts`, `per-exercise-deload.ts`.

### D-8 — Block end: review, then auto-propose the next *(running only)*
X weeks ends with a summary of everything improved vs the original baseline (a gamification
beat), then the app re-baselines from current fitness and proposes the next block. Accept or
switch goals.

### Carried from earlier sessions
- **IA:** workout screen → **Gym Workout** / **Other Activity** → **Cardio · Run/Walk**.
  Replaces the flat Run / Log Activity button row (`workout-select-content.tsx:408-424`).
- **Goal ≠ time constraint** — separate wizard steps, mirroring `BuilderWizard`'s `goal` +
  `timePerSessionMinutes`.
- **Non-session days:** adaptive filler, driven primarily by the **step** gap (see §4).
- **Headline metric:** composite "cardio fitness" score vs the baseline anchor, individual
  metrics visible beneath.
- **Gamification:** baseline anchor + PRs/best-efforts + streaks/weekly rings.
  **Explicitly not** levels, XP or badges.

---

## 3. What already exists (verified against `main`, 2026-07-26)

The quota model is mostly **assembly, not invention**:

| Need | Exists | Where |
|---|---|---|
| Per-zone weekly minute **targets**, goal-driven | ✅ | `weeklyZoneTargets(frameworkKey, weeklyMinutes)` → `perZone: [{zoneId, minutes}]`; zone weights per framework in `lib/running/zone-targets.ts` |
| Per-day zone minutes **actual** | ✅ | `daily_zone_minutes` (migrations 129 + 134) + `/api/zone-minutes` |
| Step goal / zone-min goal / active-energy goal | ✅ | `getDailyGoals()` (`lib/health/daily-goals.ts`) |
| Splits, best efforts, elevation, pace series | ✅ computed, mostly unrendered | `lib/activity/activity-metrics.ts` |
| `activity_logs` columns for elevation, steps, splits, bestEfforts, paceSeries, routePolyline | ✅ | `schema.ts:279` |
| **Cadence column** | ❌ | needs migration |
| Prescription engine + recovery gate (incl. leg-day awareness) | ✅ | `lib/running/prescription.ts`, `recovery-gate.ts`, `lower-body.ts` |
| Zone maths, score bands | ✅ | `lib/health/hr-zones.ts` — One Formula One Place |
| Interval segment engine (reusable for runs) | ✅ | `lib/walk/interval-plan.ts` (pure) |
| Re-prescribe at session end | ✅ pattern | `lib/ai-periodization/generate-prescription.ts` |
| Charts / map / zone breakdown | ✅ | `ActivityHrChart`, `ActivityRouteMap`, `ZoneBreakdown`, `StreakCard` |

**"X minutes left in Zone 2" = target (exists) − actual (exists).** Both halves are built.

---

## 4. The steps problem (do not skip)

Worked against real constants — see brief §5b:

- **Zone minutes:** 5 × 30-min sessions ≈ 150 min/wk vs the 154 needed. **Essentially solved
  by the sessions themselves.**
- **Steps:** sessions supply only **~20,100 of 56,000/wk (~36%)**, leaving ~5,100/day to daily
  living. And **steps carry Activity-Score weight 18 vs zone-minutes' 10.**

**Therefore the program cannot be only a session prescriber.** A daily step target is a
first-class part of the plan, and the adaptive filler is driven primarily by the **step** gap.

Also: the daily-movement lane **resets daily** while the strength lane is rolling-7-day, so 5
session days at 100% + 2 empty days at 0% averages ~71% even when the weekly guideline is met.

---

## 5. Risks carried into implementation

1. ~~**`daily_zone_minutes` compute-once-forever cache (J-1)**~~ — ✅ **NOT a risk; verified
   2026-07-26.** `getZoneMinutesRange` (`lib/data/postgres/slices/oura.ts:684`) already
   implements reconcile-on-read: **today is always recomputed** (only past days are cached),
   each cached row is **stamped with the HR profile** (`maxHr`/`restingHr`) and recomputed if
   the profile drifts, with a retention cutoff past which the cache is trusted because the raw
   HR is gone. The quota model can rest on this table safely.
2. **Ring cadence units unconfirmed (D-2)** — Hz bands are physiological priors, not validated
   against a counted walk. The fallback path is unproven.
3. ~~**Polar PMD is greenfield native**~~ — ✅ **SHIPPED 2026-07-27**, see D-4. Remaining risk is
   narrower: the native strap path is still device-unverified (no APK rebuild has run against
   it yet), not that it needs building.
4. **Two gait sources** — precedence must be explicit or they will drift. Now more concrete
   than a hypothetical: `cadence_source` on `activity_logs` already records which of the two
   shipped derivations produced each reading — confirm the app actually surfaces/uses that
   provenance rather than silently picking one.
5. **Canvas colour tokens** — `var(--x)` into chart.js renders black. Recurred before.
6. **Safe-area** — new full-screen surfaces need the **floored** utilities
   (`pb-safe-action-lg` for navless/takeover screens), never bare `pb-safe`.
7. **Offline-first** — cardio happens away from signal. Local store + outbox for every write;
   local-first reads. New sync domains need the full chain (local table = payload =
   `getSyncDelta` = `pullDelta` = `applyDelta`).

---

## 6. Explicitly out of scope

- Levels, XP, badges/achievements (owner declined).
- A fixed day-by-day calendar (superseded by D-9).
- Rebuilding the prescription engine — `lib/running/` is kept and extended.
- Web-only affordances — canonical runtime is the S25 APK.

---

## 7. Still open

**Nothing open.** Phasing was confirmed by the owner on 2026-07-26 ("perfect for iteration 1") — the
§9 ordering stands and is queued in [`docs/implementation-backlog.md`](../../implementation-backlog.md).

**Closed since first draft:** whether walks progress (D-1 — they don't); cross-modality anchor
reconciliation (D-1 — not needed); the quota-shape sub-decision (D-11); cadence as a goal
(D-12 — it's a metric); benchmark re-test rhythm (D-13 — 4 weeks); how the walk targets its
blocks (D-14 — effort, not HR). Passive Z1 fill is handled by D-10's display rule (show it
complete but excluded).

---

## 8. New build vs. wiring

**Genuinely new:**
- **Cardiovascular hub** — HR profile + per-zone/step quota display + modality choice (D-9)
- Density-progression framework (none of the 4 existing frameworks fit a fixed session length —
  all progress by *adding minutes*)
- ~~Polar PMD cadence (native) + cadence column/migration~~ ✅ shipped 2026-07-27, see D-4
- Composite cardio-fitness score + running baseline-anchor storage
- Dedicated run execution screen
- Environment tagging (running)

**Wiring up what exists:**
- Per-zone quota display (targets + actuals both exist)
- Elevation, splits, best efforts, pace series (computed, unrendered)
- Live HR + zone on the activity screen
- Recovery-gate reasons (computed, barely shown)
- VDOT paces, fitness snapshot, progress markers (computed, never surfaced)
- IA split

---

## 9. Phasing (CONFIRMED by owner 2026-07-26)

1. **IA split + quota dashboard** — mostly assembly of existing parts; immediate daily value.
   ✅ **Shipped 2026-07-27** as `feat/cardio-hub-phase-1`.
2. **Session picker + recovery-gate reasons surfaced** — completes the core loop.
3. **Visual system** — per-session + trends, one pass, hero interactive chart.
4. **Density-progression engine + anchors + push sessions** — the new engine work.
5. **Dedicated run execution screen.**
6. ~~**Polar PMD cadence** — independent native track, own validation cycle.~~ ✅ **Shipped
   2026-07-27** (PR #790) by a parallel session while this batch was being planned/implemented —
   see D-4. Remaining: on-device validation of the native strap path, not new build.

Each stage independently shippable and revertible.

---

## 10. Status

**Phase 1 is planned and queued.** Plan:
[`docs/superpowers/plans/2026-07-26-cardio-hub-phase-1.md`](../plans/2026-07-26-cardio-hub-phase-1.md)
— 14 tasks, branch `feat/cardio-hub-phase-1`. Queued top of the cardio batch in
[`docs/implementation-backlog.md`](../../implementation-backlog.md), alongside stub entries for
phases 2–6 (plans not yet written; each gets its own planning pass).

Risk #1 (`daily_zone_minutes` recompute) was **verified and retracted** — see §5.
