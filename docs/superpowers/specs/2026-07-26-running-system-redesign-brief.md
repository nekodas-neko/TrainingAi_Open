# Cardio system redesign — design brief + kickoff prompt (2026-07-26)

> **Status: DRAFT — owner input still needed on §7.** Everything else is verified against `main`
> as of 2026-07-26, or is a confirmed owner decision from the 2026-07-26 session.
>
> This is a *pre-plan* brief. It produces the design prompt in §8, which feeds a design spec,
> which feeds phased implementation plans in `docs/superpowers/plans/` per the backlog-driven
> protocol in `CLAUDE.md`.

---

## 1. What exists today (verified against `main`)

### 1a. The engine is good. The surface is not.

The most important framing for this redesign: **the deterministic prescription engine under
`lib/running/` is solid and should be kept.** The problem is that ~95% of what it computes never
reaches a screen, and there is no multi-session program to progress through.

| Layer | State | Verdict |
|---|---|---|
| `lib/running/` engine (types, 4 frameworks, recovery gate, zone targets, VDOT, fitness snapshot) | Built, unit-tested | **Keep** — extend, don't rewrite |
| `app/api/running-plan/` (GET assembles live signals → prescribes → upserts today's run) | Built | **Keep the shape**, extend the payload |
| `/running` page (3 components, ~420 lines total) | Thin | **Redesign** |
| Run *execution* | Doesn't exist — "Start run" does `router.push('/activity')` | **Build** |
| Run *history / progression* | Doesn't exist on the running surface | **Build** |
| Guided walk (`components/guided-walk/`, `lib/walk/`) | Built, standalone, has its own uplift plan in flight | **Absorb into the cardio section** |

### 1b. What the engine computes but never shows

This is the "lackluster" feeling, precisely located. All of this is computed on every
`GET /api/running-plan` and then discarded:

- **`gateReasons`** — the recovery gate reads 8 signals (Oura readiness, provisional-baseline
  flag, hours since a heavy leg day, leg volume, ACWR, Foster monotony, hours since last hard
  run, sleep hours) and produces plain-English reasons. Shown only as a small amber box, and
  only when it softens. **Note: the "workout-aware" behaviour the owner asked for in Q1 already
  exists here** — `lib/running/lower-body.ts` + the leg-day terms in `recovery-gate.ts`.
- **VDOT paces** (`lib/health/vdot.ts`) — computed, rendered nowhere. The `speed` goal collects
  a target distance and never shows a single pace number.
- **Progress markers** (`lib/health/progress-markers.ts`) — baseline→current verdicts for
  RHR / HRR1 / HRV with bands. Exists as a *health* card, not wired to running at all, despite
  `CARDIO_GOALS[].markers` declaring which markers each goal is judged by.
- **`FitnessSnapshot`** (maxHr, restingHr, vo2max, thresholdHr, weeklyBaseMinutes, and whether
  it came from a real baseline or an age estimate) — resolved every prescription, never shown.
- **Framework identity** — the plan stores a real `frameworkKey` with distribution logic behind
  it. The UI never names it or explains what following it means.

### 1c. Metric capture — what's there vs. what needs building

Owner wants **GPS + HR + steps + elevation + cadence**. These are *not* equally expensive:

| Metric | Capture | Display | Cost |
|---|---|---|---|
| GPS route, distance, pace, splits, **best efforts (fastest 1K/5K/10K)** | ✅ `lib/activity/activity-metrics.ts` | Partial (live distance+pace only) | **Free** — render it |
| Elevation gain/loss | ✅ computed | ❌ never rendered | **Free** — render it |
| HR | ✅ live via `getLiveHrManager()` (ring or Polar strap) | ❌ absent from the active screen | **Cheap** — wire it |
| Steps | ⚠️ `runStepCounterPipeline` is on-device accuracy-confirmed, but `getOuraRawSamplesByTags` reads *newest N frames*, not `[from,to]` | ❌ | **Real work** — needs a windowed reader |
| Cadence | ✅ **SHIPPED 2026-07-27 (PR #790, `2ff34ef`)** — `lib/health/cadence.ts` derives it from the ring's decoded stride frequency *and* a new Polar H10 accelerometer DSP (`PolarProtocol.kt`/`PolarGattClient.kt`); `activity_logs.cadence_spm`/`cadence_series`/`cadence_source` (migration 140) persist it per-activity | ✅ live readout + saved series, admin calibration console | **Done** — was "real work, needs new plumbing" when this brief was first written; superseded before this line could go stale further |

`activity-metrics.ts` already computing **best efforts** is a free PR/leaderboard system for the
gamification layer — worth knowing before designing one from scratch.

---

## 2. The workout parallel (the owner's stated anchor)

| Workout system | Cardio equivalent | Exists? |
|---|---|---|
| `BuilderWizard` — 10 steps: name → equipment → sessions/week → **time per session** → focus → **goal** → progression mode → phase structure → **weeks** → schedule | A cardio setup wizard | ❌ **the big gap** — `PlanSetupSheet` is one screen |
| AI generates a `GeneratedProgram`, user **reviews and edits** before saving (`BuilderReview`) | AI generates a cardio program, user reviews | ❌ |
| `Program` persists `sessions[]`, `schedule`, `phaseMode`, `totalWeeks`, `trainingGoal` | `running_plans` persists goal + frameworkKey only | ❌ |
| `computeAiDynamicNextSession` scores sessions by recovery/balance/freshness → picks today's | `prescribeNextRun` → framework proposes, recovery gate softens | ✅ **direct analogue, already built** |
| Post-session AI re-prescription (`generate-prescription.ts` runs at session end, in-process) | Post-session cardio re-prescription | ❌ — but the pattern to copy is exact |
| History + progression (exercise-history sheets, 1RM trends, Heart & Recovery) | Nothing on the cardio surface | ❌ |

**One-sentence framing:** *the cardio system should be to cardio what `BuilderWizard` +
`Program` + `computeAiDynamicNextSession` + exercise-history is to lifting — and the
prescribe-and-gate middle piece already exists.*

---

## 3. Confirmed owner decisions (2026-07-26)

### 3a. Information architecture

The workout screen splits into **two top-level options**:

```
Workout screen
├── Gym Workout          → existing session carousel / program flow
└── Other Activity
    └── Cardio · Run/Walk      ← the new Cardiovascular Health section lives HERE
        ├── Guided walk
        └── Running program
```

Today (`app/workout-select/workout-select-content.tsx:408-424`) this is a flat "Run" +
"Log Activity" button row under the carousel. The redesign restructures it.

### 3b. Program model (answers Q1/Q2)

- **Not a fixed calendar.** A program runs for X weeks; after **each session**, AI reviews it and
  decides how to pace/plan the next one — mirroring how lifting sessions re-prescribe.
- **Must be workout-aware** — a heavy legs session should produce a rest day or a lighter cardio
  load. *(This already exists in `recovery-gate.ts`; it needs surfacing, not building.)*
- **One unified Cardiovascular Health section** covering both walks and runs, choosing between
  them to meet activity goals. Target cadence: **2 runs + 3 guided walks per week.**

### 3c. Goal and time-constraint are SEPARATE questions (owner correction, 2026-07-26)

> *"The 30min mark shouldn't be the goal. Goal should be: distance, pace, zone-time/HR health,
> cadence, etc. Then it should ask somewhere how long you can dedicate — this is where the
> 30mins could be added in."*

This is the workout builder's exact shape, and it resolves the goal-vs-constraint tension
cleanly. `BuilderWizard` asks `goal` **and** `timePerSessionMinutes` as two separate steps.
Cardio does the same:

| Axis | Question | Example |
|---|---|---|
| **Goal** (what improves) | "What are you training for?" | zone-time / HR health |
| **Time constraint** (what you can give) | "How long per session?" | 30 minutes |
| **Frequency** | "How many sessions a week?" | 2 runs + 3 walks |

**The existing `CARDIO_GOALS` registry already covers most of the owner's list** — no new
taxonomy needed for three of the four named:

| Owner's goal | Existing `GoalKind` | Declared markers (already in the registry) |
|---|---|---|
| pace | `speed` — "Get faster" | time_trial, vo2max, efficiency, zone_distribution |
| distance | `endurance` — "Go further" | efficiency, vo2max, resting_hr, zone_distribution |
| zone-time / HR health | `heart_health` — "Heart health" | resting_hr, vo2max, zone_distribution |
| *(unlisted but exists)* | `recovery` — "Recovery & resilience" | hrr1, resting_hr, zone_distribution |
| **cadence** | ❌ none | — |

`CARDIO_GOALS[].markers` already declares which progress markers each goal is judged by, which
is exactly the wiring the "am I improving?" surface needs. **Cadence is the only genuinely new
one** — and it sits oddly as a primary goal (cadence is usually a means to efficiency rather
than an end). The design should decide whether it becomes a goal, a tracked metric under
`speed`/`endurance`, or a form-quality sub-score.

### 3c-ii. The progression axis follows the goal, within the constraint

The goal decides **what's held fixed and what improves**; the time constraint bounds every
session regardless.

| Goal | Fixed | Improves | Measurement |
|---|---|---|---|
| **Zone-time / HR health** | session length (the constraint) | zone-minutes accumulated, HR-at-pace ↓ | every session |
| **Distance** | session length | distance covered ↑ | every session |
| **Pace** | a benchmark distance | **time ↓** over that distance | **periodic re-test** (see Q-F) |
| **Cadence** | session length | steps/min ↑ at a given pace | every session |

Baseline → anchor → progression then works uniformly: the first session at the chosen
constraint is a **baseline**, it becomes the **anchor**, and every later session is scored
against it on the goal's own axis. The *structure* varies (steady / tempo / intervals / long)
— the owner flagged this as the part needing the most work.

### 3d. Gamified as much as possible.

### 3e. The plan, if followed, should max the Activity Score.

See §5 — this needs an important correction.

---

## 4. The progression engine (where the work is)

### 4a. None of the four existing frameworks fit a fixed time budget

All four current frameworks (`polarized-80-20`, `speed-vo2max`, `zone2-base`,
`aerobic-recovery`) progress by **adding minutes** — 5–10%/week volume growth. Under a fixed
30-minute budget you cannot grow volume; you can only grow **density**: more distance, higher
zones, better pace, better cadence in the same 30 minutes.

**So a new framework type is required** — one whose progression variable is intensity/density
rather than duration. This is the single largest genuinely-new piece of engine work in the
redesign. The distance-goal path, by contrast, *can* largely reuse the existing frameworks
(sessions vary in length in service of a benchmark) plus a re-test rhythm.

### 4b. What the per-session decision must produce

Each time it runs, the progression rule needs to decide:

- **Structure** — steady / tempo / intervals / long effort (within whatever the goal fixes)
- **Target** — the specific number to beat this session (distance / pace / zone-minutes / cadence)
- **Back-off** — whether the recovery gate + workout-awareness should soften or rest it

And it needs an **anchor snapshot** per program: the baseline session's metrics, plus a rolling
"current best" per metric, so improvement is both visible and gamifiable.

### 4c. Structure variety is for adaptation, not score

Alternating steady / tempo / interval sessions matters **physiologically** (Zone 4–5 drives
VO₂max; volume drives aerobic base) — not for Activity Score reasons. See §5 Finding 1: within
a 30-minute budget, intervals and steady runs score *identically*. The design should state this
explicitly rather than implying intervals "score better", so the progression engine is tuned
for adaptation and the score is treated as a floor to clear.

The underlying math, for reference — within a fixed 30-minute budget:

- **Steady** — 30 min in Zone 2–3 → 30 moderate minutes
- **Intervals** — e.g. 12 min in Zone 4–5 + 18 min moderate → 12×2 + 18 = **42 moderate-equivalents**
  (vigorous counts double, per the WHO/CDC convention `computeActivityScore` already encodes)

Intervals genuinely are more zone-minute-dense per minute of time — the daily goal of 22 is
just low enough that both clear it, so the difference is invisible to the score.

---

## 5. Activity Score alignment — three findings that change the goal

The owner wants the plan, if followed, to max the Activity Score. Reading
`lib/health/activity-score.ts` + `lib/health/daily-goals.ts`, three things matter:

**Component weights (out of 100):**

| Component | Weight | Goal | Lane |
|---|---|---|---|
| `strengthFreq` | **25** | 3 sessions / rolling 7d | rolling 7-day |
| `strengthVolume` | **20** | typical session volume × freq goal | rolling 7-day |
| `steps` | **18** | 8,000/day (or activity-level derived) | **daily** |
| `activeEnergy` | **15** | ~24% of BMR | **daily** |
| `moveHours` | **12** | waking hours less an allowance | **daily** |
| `zoneMinutes` | **10** | **22 min/day** | **daily** |

### Finding 1 — zone minutes is a floor to clear, not a target to optimise

The sub-score is `clamp01(zoneMinutes / 22) × 100`. **Any** 30-minute session in Zone 2+ clears
22 and scores 100. Intervals (42 equivalents) score exactly the same as steady (30). Beyond 22
minutes, extra zone-minutes are worth **zero** additional Activity Score.

*Design consequence:* don't build the progression engine around maximising zone minutes for
score reasons. Clear the floor, then optimise for actual fitness adaptation. The plan should
optimise the score where the score is actually winnable — which is Finding 2.

### Finding 2 — the daily-movement lane resets every day; the strength lane doesn't

Steps, active energy, move-hours and zone-minutes are scored **per day**. Strength is a rolling
7-day window, so a lifting rest day still scores off the last week.

**Cardio has no rolling lane.** 2 runs + 3 walks = 5 active days, and on the other 2 days the
entire 55-weight daily-movement lane collapses to whatever incidental movement happens.

*Design consequence:* **a weekly cardio plan cannot max the Activity Score by prescribing 5
sessions.** It must also answer "what do I do on the other 2 days" — even if that's just a step
target or a short walk. This is the single biggest lever for the owner's stated goal, and it
falls out of the score's structure rather than anything about running.

### Finding 3 — the loop partly closes itself already

`zoneMinutes` is fed in `app/api/readiness-score/route.ts` from the day's continuous HR series
(`todayHrRows`), not from `activity_logs`. So **a run's zone minutes already flow into the
Activity Score automatically**, as long as HR was recording — no new wiring needed. Same
argument for steps if the ring is worn during the session.

*Design consequence:* the "make the plan feed the score" work is mostly about **prescribing to
the goals** and **showing progress against them**, not about plumbing new data in. The
double-counting risk noted in the guided-walk plan's Phase G is largely sidestepped for the
same reason.

---

## 5b. Feasibility check: can 5 × 30-min sessions/week hit the weekly targets?

The owner's stated goal is *"get zone-time/HR/steps required for the week, within 30-minute
sessions."* Worked against the real goal constants — **zone-time yes, steps no.**

Assumptions: 2 runs + 3 interval walks, all 30 min. Walking cadence ~100–120 spm; running
~160–180 spm (standard figures, not measured for this user — the cadence plumbing in §1c would
make this exact).

### Zone minutes — ✅ achievable, almost exactly

| | |
|---|---|
| Weekly need | 22 min/day × 7 = **154 min/wk** |
| 5 × 30-min sessions | **150 min** of session time |
| If all Zone 2+ | ~150 zone-min, plus a bonus wherever vigorous doubles |

So 5 × 30 min lands essentially exactly on target — unsurprising, since
`DEFAULT_ZONE_MINUTES_GOAL = 22` is just the WHO 150 min/week guideline divided by 7. **The
owner's instinct is right.**

**But the score is daily, not weekly.** 5 session days at 100% + 2 empty days at 0% averages
**~71%** on the zone component, despite the weekly total being met. This is precisely why the
adaptive-filler decision (Q-A) matters — it's what converts a met weekly guideline into a met
daily score.

### Steps — ❌ not achievable from sessions alone

| | |
|---|---|
| Weekly need | 8,000/day × 7 = **56,000/wk** (10,000/day at "moderate" → 70,000) |
| 3 walks × ~3,300 | ~9,900 |
| 2 runs × ~5,100 | ~10,200 |
| **Session total** | **~20,100 — about 36%** (≈29% against a 10k/day goal) |
| Shortfall | **~36,000/wk ≈ 5,100/day** must come from daily living |

**Steps carry weight 18 — the largest daily-movement component, nearly double zone-minutes'
10.** So the biggest single Activity Score lever is the one 30-minute sessions can't reach.

*Design consequence:* the program cannot be only a session prescriber. It needs a **daily step
target as a first-class part of the plan**, and the adaptive filler should be driven primarily
by the step gap rather than the zone-minute gap — zone-minutes are nearly handled by the
sessions themselves, steps are not.

---

## 6. Free wins already sitting in the codebase

Worth pulling into the design rather than building:

- **Best efforts** (fastest 1K/5K/10K) — `activity-metrics.ts` already computes them → a PR
  system for free.
- **Splits + elevation + pace series** — computed, unrendered.
- **`ZoneBreakdown`, `ActivityHrChart`, `ActivityRouteMap`** — existing components.
- **Recovery gate's workout-awareness** — the heavy-legs logic the owner asked for exists.
- **`generate-prescription.ts`** — the "re-prescribe in-process at session end" pattern to copy.
- **`StreakCard`** — an existing streak surface to extend rather than reinvent.

---

## 7. Resolved decisions + remaining questions

### ✅ Resolved (owner, 2026-07-26)

| # | Question | Decision |
|---|---|---|
| **Q-A** | Non-session days | **Adaptive filler.** If the week is behind on steps/movement, prescribe a light walk or step target; if ahead, take the day fully off. |
| **Q-B** | Does the time budget grow? | **Goal and time-constraint are separate questions** (owner correction). The goal (pace / distance / zone-time / cadence) decides what improves; the time constraint bounds every session and does not grow. See §3c. |
| **Q-C** | Headline improvement metric | **Composite "cardio fitness" score vs. the baseline anchor**, with the individual metrics visible underneath. |
| **Q-D** | Gamification mechanics | **Beat-your-baseline anchor · PRs / best efforts · streaks + weekly rings.** Explicitly *not* levels/XP/badges. |

### 🟡 Q-E — Does the guided walk progress too?

Do walks have their own goal and get harder (faster intervals, longer, higher zones), or are
they the "fill the activity quota / active recovery" partner to the run's "get better" focus?
Note the walk already has an uplift plan in flight with its own interval-progression ideas.

### 🟡 Q-F — Benchmark re-test rhythm (new, falls out of Q-B)

A time-budget goal measures every session, so progress is continuous. A **distance goal needs
a re-test cadence** — you don't run a 5K time trial every session. How often does the benchmark
get re-tested (every 3–4 weeks? when the engine detects readiness for it?), and does the app
schedule that automatically or prompt for it?

---

## 7b. Grilling decision record (2026-07-26 session)

Resolved one-at-a-time with the owner. These are **decisions, not proposals** — a fresh agent
should treat them as settled.

### D1 — Program shape: one goal, both modalities serve it
One plan row, one goal. Each modality's **role depends on the goal**:
- **zone-time / efficiency goal** → runs *and* walks both accumulate toward it
- **pace goal** → only runs drive the goal; walks become active recovery + step-filler

**Anchors are per-modality** — a walk's pace is not comparable to a run's, so each modality
keeps its own baseline and its own PRs.

### D2 — Weekly activity targets are an always-on FLOOR, not a goal
Every program enforces the weekly zone-time/step targets regardless of which goal is picked
(this is what schedules sessions and drives the adaptive filler). **The goal is purely the
improvement axis.**

*Why this matters:* "hit 154 zone-min/week" is compliance — once met, there's nowhere to
progress, which is exactly the flat feeling the redesign is fixing. Resolved by giving
heart-health a real improvement axis: **efficiency — HR dropping at the same pace/effort.**
Unbounded, and physiologically the truest fitness signal.

| Goal | Improvement axis |
|---|---|
| pace (`speed`) | time over a benchmark distance ↓ |
| distance (`endurance`) | distance covered in the session ↑ |
| heart health | **efficiency — HR-at-pace ↓** |
| cadence | steps/min ↑ at a given pace |
| recovery | HRR1 / resting HR |

### D3 — Targets: adherence by default, beat-it only on push sessions
- **Most sessions carry an ADHERENCE target** — "stay in Zone 2". Hitting it is success even
  if slower than last time.
- **~1 in 4–5 is a designated push / benchmark session** carrying an explicit "beat 4.2 km".
- Progress is **tracked every session but only challenged on push days.**

*Why:* an every-session PR target contradicts the polarized 80/20 model already encoded in
`lib/running/frameworks/`, and chasing a PR 5×/week is the standard overtraining/injury route.
It also manufactures constant "failure" once you plateau.

### D4 — Cadence: Polar H10 PMD accelerometer first, ring fallback
**Owner reaffirmed after the cost was flagged.** This is a substantial new native workstream,
not a wiring job:

- `PolarProtocol.kt` today implements **only** the standard Heart Rate Service
  (`0x180D`/`0x2A37`) — HR + RR intervals. **No accelerometer, no PMD, no RSC.**
- Chest-strap cadence therefore requires: Polar's proprietary **PMD (Polar Measurement Data)**
  GATT service + its control-point protocol, raw 3-axis ACC → cadence DSP, new Kotlin, an APK
  rebuild, and its own on-device accuracy validation.
- **Byte layouts/UUIDs must be verified against the pinned Polar SDK source**, never memory —
  per the CLAUDE.md external-API rule.
- **Ring `stride_frequency` is the fallback** when the strap isn't worn. Note the ring's Hz
  bands are still provisional (sub-plan D-2 open on exact units), so the fallback path needs
  its own counted-walk validation.
- Two gait sources now exist — the design must state precedence explicitly and keep
  `gait-classifier.ts` as the single *classification* authority even if the *signal* differs.
- **No cadence column exists** on `activity_logs` — a migration is required regardless of source.

---

## 8. Design prompt

> **Ready to use.** Q-A–Q-D are resolved and baked in below. Q-E and Q-F are flagged inside the
> prompt as decisions for the design session to make and justify.

```
Design a complete redesign of the cardio (running + walking) system in this app.

## Context — read first
- `docs/superpowers/specs/2026-07-26-running-system-redesign-brief.md` (this brief — current
  state, the workout parallel, the Activity Score findings, and what already exists unused)
- `lib/running/` — the existing deterministic engine (4 frameworks, recovery gate, zone
  targets, cardio goals). KEEP THIS.
- `components/workout-builder/builder-wizard.tsx` + `builder-review.tsx` — the goal/
  time-constraint wizard UX this should mirror
- `lib/ai-periodization/ai-dynamic.ts` + `generate-prescription.ts` — how lifting scores and
  re-prescribes after each session
- `components/guided-walk/` + `lib/walk/` — the existing guided-interval execution model
- `lib/health/activity-score.ts` + `daily-goals.ts` — what the Activity Score actually rewards
- `CLAUDE.md` — hard rules: no hardcoded session names, `todayInTz()` everywhere,
  cache-group invalidation, offline-first local store, FLOORED safe-area utilities,
  one-formula-one-place, deterministic math (no LLM number ever gates an action)

## What's wrong today
The `lib/running/` engine is good but ~95% of what it computes never reaches a screen, and
there is no program to progress through. `/running` is three thin components; "Start run"
pushes to the generic `/activity` recorder; there is no cardio history, no visible
progression, and no VDOT paces, fitness snapshot or progress markers surfaced despite all
being computed. The guided walk is a good standalone tool with no program around it.

## Goals

1. **Information architecture.** The workout screen offers two top-level options: "Gym
   Workout" and "Other Activity". Under Other Activity sits "Cardio · Run/Walk" — a unified
   Cardiovascular Health section owning both the guided walk and the running program, and
   choosing between them to meet the week's activity goals. Target cadence: 2 runs + 3 walks
   per week. Replaces today's flat Run / Log Activity button row.

2. **A cardio program built like a workout program.** A wizard collects, as SEPARATE steps
   (mirroring `BuilderWizard`, which asks `goal` and `timePerSessionMinutes` independently):
   - **Goal** — what you're training to improve: pace, distance, zone-time/HR health,
     cadence, recovery. NOTE: `lib/running/cardio-goals.ts` ALREADY has `speed` (=pace),
     `endurance` (=distance), `heart_health` (=zone-time), `recovery` — with per-goal
     `markers` already declared, which is exactly the wiring the "am I improving?" surface
     needs. Only **cadence** is new; decide whether it's a real goal, a tracked metric under
     speed/endurance, or a form-quality sub-score.
   - **Time constraint** — how long per session (e.g. 30 min). This is NOT the goal.
   - **Frequency** — sessions per week (target: 2 runs + 3 walks).
   AI then generates a program the user reviews before committing; it runs for X weeks. After
   EACH session the AI reviews the result and plans the next — mirroring
   `generate-prescription.ts`, not a fixed pre-baked calendar.

3. **Baseline → anchor → visible progression. This is the heart of the redesign, and the
   part the owner explicitly flagged as needing the most work.**
   - The first session at the chosen constraint is a BASELINE. Record zones hit, distance,
     pace, cadence, HR. It becomes the ANCHOR every later session is measured against.
   - **THE CORE RULE: the goal decides what's held fixed and what improves; the time
     constraint bounds every session regardless.**
     | Goal | Fixed | Improves | Measured |
     |---|---|---|---|
     | zone-time / HR health | session length | zone-minutes, HR-at-pace ↓ | every session |
     | distance | session length | distance covered ↑ | every session |
     | pace | a benchmark distance | time ↓ | periodic re-test |
     | cadence | session length | steps/min ↑ at a given pace | every session |
   - **A fixed session length means none of the four existing frameworks fit** — all four
     progress by ADDING minutes (5–10%/week volume growth). Under a fixed 30 minutes you can
     only grow DENSITY. A density-progression framework is genuinely new work: design it.
     Goals benchmarked by re-test (pace) can largely reuse the existing frameworks.
   - Each session the engine must choose a STRUCTURE (steady / tempo / intervals / long) and a
     specific TARGET NUMBER to beat, and must be able to back off.
   - **Headline improvement metric: a composite "cardio fitness" score vs. the baseline
     anchor**, with the individual metrics (distance, pace, zones, cadence) visible beneath
     it. It must work for every goal type.
   - **DESIGN DECISION NEEDED — benchmark re-test rhythm.** Continuously-measured goals need
     no re-test; a pace goal does (you don't time-trial every session). Decide the cadence,
     and whether the app schedules it or prompts.

4. **Workout-aware scheduling.** A heavy legs session should yield a rest day or a lighter
   cardio load. NOTE: this already exists in `lib/running/recovery-gate.ts` +
   `lower-body.ts` — surface it, don't rebuild it.

5. **A dedicated running execution screen** showing GPS (distance, pace, splits, route), live
   HR with the current zone vs. the prescribed target zone, elevation, cadence and steps.
   Also bring the generic activity screen up to a minimum bar — at least live HR and steps,
   which it lacks today.

6. **Cardio history and progression on the cardio surface** — past sessions with full metric
   detail, and a clear answer to "am I getting better?" against the anchor.

7. **Gamification, heavily — three mechanics, all wrapped around the anchor:**
   - **Beat-your-baseline** — every session scored against the anchor, with a visible trend
     ("12% above baseline"). This is the core mechanic.
   - **PRs / best efforts** — fastest 1K / 5K / 10K, longest distance, most zone minutes.
     `activity-metrics.ts` ALREADY computes best efforts, so this is nearly free.
   - **Streaks + weekly progress rings** — session streaks and per-zone / step rings filling
     through the week. `StreakCard` already exists and could extend.
   - **Explicitly NOT wanted:** levels, XP, badges/achievements. Don't design them in.

8. **Align with the Activity Score, correctly.** Read §5 AND §5b of the brief first — the
   feasibility math there changes what the plan has to do:
   - Zone minutes are a FLOOR (22/day) that any 30-min session clears — do NOT build
     progression around maximising them for score reasons; intervals score identically to
     steady. Alternate structures for physiological adaptation instead, and say so.
   - **5 × 30-min sessions ≈ 150 zone-min/wk vs. the 154 needed — zone-time is essentially
     solved by the sessions themselves.** But **steps are not: sessions supply only ~36% of
     the weekly step goal**, leaving ~5,100/day to daily living. Steps carry weight 18 vs
     zone-minutes' 10, so the biggest score lever is the one sessions can't reach.
   - *Therefore the program cannot be only a session prescriber.* It needs a **daily step
     target as a first-class part of the plan**, and the ADAPTIVE FILLER on non-session days
     should be driven primarily by the STEP gap, not the zone-minute gap.
   - The daily-movement lane RESETS DAILY while the strength lane is rolling-7-day, so 5
     session days cannot max a daily score even when the weekly guideline is met (5×100% +
     2×0% ≈ 71%). Adaptive filler: if the week is behind, prescribe a light walk or step
     target; if ahead, take the day fully off. Define "behind" concretely against the goals.

9. **DESIGN DECISION NEEDED — do guided walks progress too?** Either they get their own goal
   and get harder (faster intervals, longer, higher zones), or they're the activity-quota /
   active-recovery partner to the run's "get better" focus. Decide and justify; note the walk
   has its own uplift plan in flight with interval-progression ideas already in it.

## Constraints
- **Keep the deterministic engine.** The framework→recovery-gate pipeline in
  `lib/running/prescription.ts` stays the source of truth for what to do. AI generates the
  *program structure* (as for lifting) and phrases rationale — it never produces a number that
  gates an action.
- **Reuse before building.** `activity-metrics.ts` (splits, best efforts, elevation, pace
  series), `hr-zones.ts` (all zone math), `progress-markers.ts`, `vdot.ts`, `ZoneBreakdown`,
  `ActivityHrChart`, `ActivityRouteMap`, `StreakCard` all already exist. Check
  `docs/module-map.md` before writing anything new.
- **Offline-first.** Cardio happens away from signal. Every user write goes to the local store
  + outbox; every read site reads local-first.
- **Canonical runtime is the S25 APK.** New full-screen surfaces use the FLOORED safe-area
  utilities (`pb-safe-action-lg` for navless/takeover screens).
- **Steps still need new plumbing** — a windowed raw-frame reader (today's
  `getOuraRawSamplesByTags` reads newest-N only). **Cadence no longer does — shipped 2026-07-27,
  see §1d.** GPS, elevation, splits and best efforts are already captured and merely
  unrendered — treat those as free.
- The guided walk has an uplift plan already in flight
  (`docs/superpowers/plans/2026-07-23-guided-walk-uplift.md`) — reconcile with it, don't
  duplicate or contradict it.

## Deliverable
A design spec covering: the data model (what a cardio program is; how it relates to
`running_plans` / `prescribed_runs` / `activity_logs`; where the baseline anchor lives), the
screen-by-screen UX (IA split → cardio section → wizard → program view → today's session →
execution → summary → history), the progression algorithm in detail (structure selection,
target selection, back-off), the gamification layer, and how the plan maps onto the Activity
Score's real weights. Separate genuinely-new build from wiring-up-what-exists. Split into
independently shippable phases. Flag every device-gated surface.
```

---

## 9. Next step

The prompt in §8 is ready to run. Q-E (walk progression) and Q-F (benchmark re-test rhythm)
are deliberately left inside it as decisions for the design session to make and justify.

Design session → spec → phased implementation plans in `docs/superpowers/plans/` → backlog
entries, per the backlog-driven protocol in `CLAUDE.md`.

**Expected phase ordering** (the design should confirm or revise):

1. **IA split** — Gym Workout / Other Activity → Cardio section. Small, unblocks everything,
   ships alone.
2. **Render what's already computed** — elevation, splits, best efforts, live HR + zone on the
   activity screen, VDOT paces, fitness snapshot. Cheap, high visible payoff, no new engine.
3. **Cardio program data model + setup wizard** — the `BuilderWizard` analogue, plus the
   baseline-anchor concept.
4. **Density-progression framework + per-session re-prescription** — the genuinely new engine
   work, and the heart of the redesign.
5. **Dedicated run execution screen** — prescription-aware, all metrics.
6. **History, composite fitness score, gamification layer.**
7. ~~**Steps + cadence plumbing**~~ **Steps plumbing** — windowed raw-frame reader. Cadence
   shipped 2026-07-27 (§1d), so this phase is now steps-only. Independent, can slot anywhere
   after 2.
