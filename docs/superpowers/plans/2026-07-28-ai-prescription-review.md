# AI workout prescription — review findings and remediation plan

**Status:** planned 2026-07-28, implemented in the same PR chain (owner asked for plan-then-build
in-session, which is the CLAUDE.md "small fixes the user explicitly asks to have done in-session"
exemption to the two-PR backlog protocol).

**Trigger:** owner review of the AI prescription pipeline — how it is generated, how it is cached,
whether it can be made time-aware (short / standard / long sessions), and whether the numbers it
produces are actually correct. Production was audited read-only via `POST /api/admin/db-query`
during the review; every number quoted below is from real history, not a fixture.

---

## 0. How the pipeline works today (baseline for the rest of this doc)

Generation is **not** on-demand at screen open. It runs at three moments:

| Trigger | Code | Notes |
|---|---|---|
| Workout completion | `regenerateNextPrescription` ← `lib/workout/complete-workout.ts` | in-process, so the *next* session's plan is queued the moment the user taps Done |
| Screen open, slot `consumed` | `isAiPrescriptionPending` → client POST `/prescribe` + a server fire-and-forget self-fetch | the retry path for a Gemini failure or a program edit |
| Phase transition accepted / baseline complete | `transition/route.ts`, `baseline/complete/route.ts` | |

`generatePrescriptionForSession` is a deterministic sandwich around one LLM call:

```
aggregateSignals (~12 sequential DB waves, ~30 signals)
  → emergency-deload check      (deterministic — can skip the LLM entirely)
  → per-exercise soreness deload (deterministic)
  → Gemini generateObject        ← the only AI step
  → reconcilePrescription        (drop hallucinated ids, backfill omissions, normalise pct)
  → applyAutoregulation          (RPE × 1RM quadrant)
  → fitToBudget                  (trim sets to fit the time budget)
  → phase guards                 (accumulation/intensification/realisation ceilings)
  → storePrescription + 7-day expiry
```

Five caching layers sit in front of it: the `session_periodization.prescription` JSONB with its
status machine; a 30 s in-process dedup cache (`createDedupCache`); HTTP `max-age=30, SWR=60` on
`/api/workout-data` (`no-store` on `?poll=1`); the client cache keys `workout-data:<tab>` /
`workout-card:<id>` / `workout-data:all` (all `TTL_LONG` = 6 h) and `ai-periodization-session:<id>`
(`TTL_MEDIUM` = 30 min); and the offline SQLite mirror.

**Measured cost** (`ai_call_log`, 14 days): 13 prescription calls, 0 failures, p50 **2 571 ms**,
p90 **3 171 ms**, max 3 756 ms, ~3 445 tokens each. The LLM is not the whole latency — the ~12
sequential DB waves in `aggregateSignals` precede it, and the client only discovers the result on a
**3-second poll tick**.

---

## 1. P1 — the prescriptions are inert on 4 of 5 sessions (highest severity)

### Evidence

`prescriptionDrivesLoad` (`lib/ai-periodization/apply-prescription.ts:11-19`) only drives load when
the status is `accepted`/`auto_applied`, or `pending` **and** `phaseAction === 'stay'`. Production
state on 2026-07-28 (program "Shikai", `ai_dynamic`, powerbuilding, auto-apply on):

| Session | `sessions_in_phase` | status | `phaseAction` | stored `phase` | drives load? |
|---|---|---|---|---|---|
| Push | 5 | pending | transition_recommended | intensification | **no** |
| Pull | 4 | pending | transition_recommended | **accumulation** | **no** |
| Legs | 3 | auto_applied | stay | accumulation | yes |
| Upper | 4 | pending | transition_recommended | **accumulation** | **no** |
| Lower | 4 | pending | transition_recommended | **accumulation** | **no** |

Confirmed end-to-end from the owner's device: the done-screen "Next workout" card rendered
Barbell Bench Press **4 × 72.5 kg × 7** while the stored prescription for that session says
**4 × 5 @ 82.5 %**. The card is rendering the static progression style, exactly as
`/api/next-session/prescription/route.ts:82-84` resolves `source: 'static'` when `drives` is false.

### Two distinct defects

**(a) No-op transitions.** On Pull, Upper and Lower the model returned
`phase_action: 'transition_recommended'` with `phase: 'accumulation'` — the phase the session is
already in. `resolvePhase` (`reconcile-prescription.ts:39-45`) trusts the model's `phase` whenever
the action is not `'stay'`, and nothing validates that a "transition" actually changes phase.
Accepting it calls `advancePhase('accumulation')`, which resets `sessions_in_phase` to 0 and
regenerates — the loop cannot close. The card additionally mis-labels it: `isCycleRestart`
(`ai-prescription-card.tsx:76`) treats *any* transition targeting accumulation as "the deload block
is finished, start a fresh cycle", so the user is offered "build a new program" while mid-block.

This is **not** the phase-guard ceilings firing: `ACCUMULATION_CEILING` is 6 and the counts are 3–5.
The model is choosing `transition_recommended` on its own. The prompt's own criterion —
*"accumulation→intensification: needs 4+ sessions in phase, RPE delta ≤+0.3, 1RM trending up"* — is
a **floor stated as if it were a trigger**, so the model fires it the moment the floor is met and
keeps firing it every session thereafter.

**(b) A pending transition throws away its own numbers.** The generator does all of
reconcile → autoregulation → `fitToBudget` → phase guards to produce per-exercise sets/reps/pct, then
`prescriptionDrivesLoad` discards all of it because the *phase decision* is unresolved. Those are two
separable questions. The phase decision genuinely needs consent (it resets counters and changes the
intensity zone for the whole block). The per-exercise numbers for *today's* session do not.

### Fix

1. **`resolvePhase` rejects a no-op transition.** When `phaseAction !== 'stay'` and the model's phase
   equals `currentPhase`, downgrade the action to `'stay'` and keep the current phase. Contradictory
   model output must never reach storage. Unit-test the four combinations.
2. **A pending `transition_recommended` drives load.** Add it to `prescriptionDrivesLoad` alongside
   `'stay'`. The phase transition itself still requires explicit acceptance via the transition route —
   only the numbers stop being discarded. `deload_recommended` / `session_swap_recommended` /
   `rest_day_recommended` keep requiring acceptance: those change *whether you train*, not just how.
3. **Tighten the prompt.** Restate the transition rules as "*eligible* from N sessions — recommend a
   transition only when the phase's work is actually complete", and add an explicit
   `phase must differ from current_phase when phase_action is transition_recommended` instruction.
4. **Minimum 2 working sets at generation.** `PrescriptionSchema` allows `sets: min(1)` and
   `fitToBudget`'s `SET_FLOOR` of 2 only governs *trimming*, so a model-authored 1-set exercise
   passes straight through. Live examples: Legs Hip Thrust 1×9, Legs RDL 1×9, Pull Preacher Curl
   1×10, Lower Cable Crunch 1×10. `time-budget.ts:58` already states the rule ("a single working set
   is too little stimulus for any role"); enforce it in `reconcilePrescription` where every other
   model-output correction lives.

### Not doing (deliberately)

Plausibility ranking of sets across roles (Upper currently has Skull Crusher 5×7 @77.5 % against
Incline Bench 4×7). Real, but it needs a role-ordering rule that does not exist yet, and the
autoregulation/effort-floor layer already partially governs it. Recorded as a Known Issue instead.

---

## 2. P2 — the duration model is systematically short

### Evidence

Stored estimates vs the 51-min working budget (60-min session budget − a measured ~9-min warmup):

| | Push | Pull | Legs | Upper | Lower |
|---|---|---|---|---|---|
| `estimatedSessionDurationMin` | 39 | 44 | 35 | 49 | 42 |

Actual working windows (`completed_at − warmup_ended_at`), last 10 completed sessions:
**52, 41, 45, 61, 46, 47, 41, 46, 58, 62 min**. Wall-clock against the 60-min budget: **10 of the
last 20 sessions ran over** (61, 64, 65, 67, 67, 69, 70, 71, 75, 82 min).

### Root cause

`estimateExerciseDurationSec` (`lib/workout/duration-model.ts:101-105`):

```ts
return ex.sets * effectiveSetWorkSec(ex.reps, ex.measuredSecPerRep)
  + Math.max(0, ex.sets - 1) * (ex.measuredRestSec ?? ex.restSec)   // ← drops one rest per exercise
  + ex.transitionSec
```

`sets - 1` assumes the inter-exercise transition *replaces* the last set's rest. Production says they
are separate clocks. On 2026-07-28 Push:

| component | measured |
|---|---|
| set work (`Σ set_time_sec`) | 11.1 min |
| per-set rest (`Σ rest_time_sec`, all 14 sets) | 26.0 min |
| inter-exercise gaps (`Σ inter_exercise_rest_sec`) | 13.2 min |
| **total** | **50.3 min** vs a 52-min measured window |

The three sum to the window, so `rest_time_sec` and `inter_exercise_rest_sec` do **not** overlap —
the model is dropping one full rest per exercise, ≈7–8 min on a 5-exercise session. A backtest of the
model against 24 real sessions (charging every logged rest plus a 240 s transition) lands within
±15 % with no systematic bias; the shipped `sets - 1` form is short on every one.

### Fix

Charge every set's rest, and keep `transitionSec` as the separate between-exercise cost:

```ts
ex.sets * effectiveSetWorkSec(...) + ex.sets * (ex.measuredRestSec ?? ex.restSec) + ex.transitionSec
```

Consequences to handle in the same change, because this is One-Formula-One-Place and four callers
share it:

- `fitToBudget` will now trim harder for the same budget. That is the point — but re-check that a
  5-exercise 51-min session does not floor out at all-2s and trip the "more exercises than the budget
  fits" note. Verified against the five live prescriptions during implementation.
- `lib/ai-periodization/prompt.ts:135` states the formula verbatim to the model. It must be updated
  in the same commit or the AI plans on one formula while the deterministic guard enforces another.
- `app/api/generate-program` and `app/api/builder-chat` consume the same estimator for program
  planning; their session sizing shifts slightly, which is correct.

The `MIN_WARMUP_MIN`/`MAX_WARMUP_MIN` clamp and `warmupBudgetMin` are untouched — the measured
warmup median (~9 min) is already accurate.

---

## 3. P3 — the mood/soreness check-in does not reach the prescription

### Evidence

`components/mood-checkin-sheet.tsx:161` calls `invalidateReadinessInputs()`, which clears
`readiness-score`, `weekly-stats`, `progress-summary`, `muscle-recovery`, `body-battery`. It does
**not** clear `workout-data:*`, `workout-card:*`, `workout-data:all` or `ai-periodization-session:*`
— all of which cache the prescription at a 6-hour TTL — and it fires no `/prescribe`.

Second defect: the server-side re-evaluation that *would* apply fresh soreness without re-running
Gemini (`reevaluatePrescriptionForToday`) is gated at `app/api/workout-data/route.ts:412` on
`generatedDay !== todayStr`. A prescription generated **today** — precisely what the
completion-time regeneration produces after a morning session — never re-evaluates against soreness
logged later the same day.

### Fix

1. New cache group `invalidateCheckinAffectsPrescription()` in `lib/cache-groups.ts` (never a
   hand-rolled key list, per CLAUDE.md) covering `workout-data`, `workout-data:all`, `workout-card:`,
   `ai-periodization-session:`, plus the existing readiness keys. Called from the mood check-in save
   path *after* the local write, *before* the refetch callbacks (session-164 ordering rule).
2. Drop the `generatedDay !== todayStr` condition. The `reevaluatedForDate === todayStr` stamp
   already makes it once-per-day idempotent; the generated-day check is redundant *and* is what
   creates the same-day hole.
3. Because the re-evaluation is a cheap, LLM-free, deterministic pass, that is the whole fix — no
   `/prescribe` needs firing from the check-in. Soreness lands on the next `workout-data` read, which
   the cache invalidation now guarantees is a real network read.

---

## 4. P4 — short / standard / long session duration

**Depends on P2.** Building this on today's estimator would ship a "30-minute" mode that takes ~38–40
minutes.

### What already exists

`fitToBudget` already trims by **muscle-overage-against-weekly-MAV** priority
(`time-budget.ts:99-155`), reading `signals.weeklyTargets` / `signals.weeklyLogged`. A short session
therefore already cuts the muscles that are ahead of their weekly target first — the behaviour the
owner asked for is built, it just has no way to be given a smaller budget.

### What is missing

- **No per-day override.** `time_budget_minutes` lives on `program_sessions` (all five = 60) and is
  only editable in Config. Nothing threads a request-scoped budget into `aggregateSignals`.
- **No expansion.** `fitToBudget` only removes sets. Given 90 minutes it returns the same plan and
  hands back the surplus.

### Design

**Storage: none.** The choice is per-day and ephemeral — a query param, not a column. This keeps it
out of the sync/outbox surface entirely (no new domain, no `pushMutations` branch).

- `PRESET_BUDGETS`: `short` = 30 min, `standard` = the session's own `timeBudgetMinutes`, `long` = 90
  min. Standard carries no param, so the existing behaviour is byte-identical when unused.
- `aggregateSignals(..., budgetOverrideMin?)` → `effectiveTimeBudgetMin =
  workingBudgetMin(budgetOverrideMin ?? programSession.timeBudgetMinutes, measuredWarmup)`.
- `POST /prescribe` accepts `{ durationPreset }`; `/api/workout-data?tab=…&duration=short` passes it
  through. The generation dedup key gains the preset so a short and a standard plan never share a
  cached result.
- **`expandToBudget`** — the new counterpart, living beside `fitToBudget` in `time-budget.ts` so the
  two share `estimateSessionDurationSec` and the muscle-volume model. It adds sets one at a time to
  the exercise whose most-affected muscle is **furthest below** its weekly MAV (the exact inverse of
  `trimPriority`), stopping at a per-exercise ceiling and at MRV headroom so a long session cannot
  push a muscle past its maximum recoverable volume. Role bias inverts too: primaries gain first.
- UI: a three-way segmented control on the pre-workout screen, `standard` preselected. Changing it
  invalidates the prescription cache group and re-fires generation, reusing the existing
  `aiPrescriptionPending` → poll → swap machinery.

### Found during implementation (built, beyond the design above)

- **Trimming alone cannot reach a short budget.** `fitToBudget` never drops an exercise, so five
  exercises floored at two sets each still cost ~43 min — a "30-minute" session was impossible, and
  cutting every exercise to two token sets is worse training than doing fewer properly. Added
  `dropToBudget`, used only for the `short` preset: it drops whole exercises in trim-priority order
  (most over weekly MAV first, accessories before compounds), re-trimming after each drop and always
  keeping at least one. Dropped ids ride out on the prescription's existing `droppedExerciseIds`,
  which `workout-data` already honours. The AI-prescription card did **not** honour them (it listed
  an exercise the session wouldn't load) — fixed in the same change.
- **`/prescribe` was rate-limited at 10/hour**, sized when generation was automatic-only. The picker
  makes it user-initiated — comparing all three presets is three calls before any automatic ones.
  Raised to 20/hour (~3.4k tokens a call, well inside the free tier) and the client now reports a 429
  distinctly instead of a generic failure.
- **The periodization GET is HTTP-cached for 60 s**, so *every* post-write refetch — accept, dismiss,
  transition, the regeneration poll, and now the duration switch — was answered from that window with
  the pre-write state. The card repainted stale and the duration switch appeared to do nothing even
  though the write had landed. `loadPeriodization({ afterWrite: true })` sends `cache: 'no-store'`.
  This is the same class as the `?poll=1` → `no-store` fix on `workout-data` (v1.173.4) and was a
  **pre-existing bug** on the accept/dismiss/transition paths, not something the picker introduced.
- **`expandToBudget` runs only for an explicit `long` request**, never on a standard session. The
  duration model is deliberately conservative and that under-fill *is* the finish-early margin the
  owner's on-time sessions depend on; expanding by default would spend exactly that margin.
  Consequence to accept: a `long` session fills only up to the per-role set ceilings (primary 6,
  secondary 5, accessory 4), so a 3-exercise session tops out well under 90 min. Deepening the
  existing shape is the intended bound — adding exercises is a different feature.

### Explicitly out of scope

Re-balancing the *rest of the week* after a short session (telling Pull to absorb Push's lost chest
volume). It needs a cross-session planner that does not exist, and the weekly-MAV trim priority
already gives most of the benefit implicitly: whatever a short session skips is under-target next
session, so the next session's trim protects it. Recorded as a follow-up, not built here.

---

## 5. P5 — the done screen has no instant paint

`components/workout/done-screen.tsx` and its children fire **six bare `fetch` calls** on mount —
`/recap` (AI, avg 3.3 s, 1 failure in 2 calls over 14 days), `/energy`, `/oura/hr-data`,
`/hr-profile`, `/next-session/prescription` (`next-workout-card.tsx:19`) and
`/workout-sessions/<id>/timing` (`time-summary-card.tsx:28`). None uses `cachedFetch` /
`readCacheSync`, so there is no cache seed, no instant paint and nothing works offline — and they all
fire while `complete-workout` is still doing HR sync and the prescription regeneration. This is a
direct violation of the CLAUDE.md instant-paint rule ("a skeleton flash on a repeat visit is a bug").

Fix: convert each to `cachedFetch` with a `readCacheSync` seed in a `useEffect` (never a `useState`
lazy initializer — session-165 hydration rule), keys registered in `lib/cache-ttl.ts` with one
canonical TTL each and added to `invalidateWorkoutSummaries()` in the same commit. Per-session keys
(`workout-recap:<id>`, `workout-timing:<id>`, `workout-hr:<id>`) are immutable once the session is
complete, so they take `TTL_LONG`; `next-session-prescription` is shared with the pre-workout surface
and takes `TTL_SHORT`.

---

## 6. P6 — HR recovery is reported per set, and mis-signed

Owner request: aggregate per exercise rather than per set. There is also a rendering defect:
`done-screen.tsx:485` hardcodes the arrow —

```tsx
{s.hrr1 != null ? `↓${s.hrr1} bpm/min` : '—'}
{s.adequate === true ? ' ✓' : s.adequate === false ? ' ✗' : ''}
```

— so a negative recovery renders as **"↓-9 bpm/min ✓"** (observed on the owner's device, Bench S3):
a down-arrow and a green tick on a set where heart rate *rose*.

Fix: a shared `aggregateHrRecoveryByExercise` helper (`lib/health/hr-recovery-by-exercise.ts` — one
place, used by both the done screen and `day-overlay-sheet.tsx`, which had the identical rendering)
returning a per-exercise **median** recovery rate plus a `sampleCount/totalSets` ratio, so a 1-of-4
reading is visibly weaker than a 4-of-4 one. The median is what blunts the known `set_hr_stats` noise
(audit #2: 79 % `coverage_ok = false`, 67 % null `peak_bpm`) — one wild set can no longer carry the
exercise. `formatRecoveryRate` picks the arrow from the sign, and a non-positive median can never
report ✓.

---

## 7. Sequencing

P1 and P2 ship together — they are the two changes that make the AI numbers both *reach the bar* and
*be correctly sized*, and P2's harder trimming is only safe to judge once P1 has the numbers actually
driving load. P3 is independent and small. P4 depends on P2. P5 and P6 are independent UI work.

All of it lands as **ordered commits on one branch / one PR**
(`claude/ai-workout-prescription-review-xwxnfo`), since the session is pinned to a single designated
branch. Commit order is the dependency order — each commit is independently reviewable and reverts
cleanly:

| Commit | Contents |
|---|---|
| 1 | P1 + P2 (+ this plan doc) |
| 2 | P3 |
| 3 | P4 |
| 4 | P5 + P6 |

---

## 8. What this review could NOT verify

Production Postgres shows nothing about the surfaces this app most often breaks on. Not exercised:
native SQLite / the mutation outbox, safe-area insets, Samsung WebView rendering, gestures,
notifications, live BLE. `docs/device-smoke-checklist.md` remains the authority for all of it, and
every item above is web-verified only until the owner runs the on-device pass.

One anomaly is **unconfirmed**: for the 2026-07-28 Push session the device reported 5/5 exercises and
14 sets, while a `deleted_at IS NULL` query returned 4 exercises and 12 sets — one exercise log
appears soft-deleted server-side. Production began returning 502s and connection timeouts before it
could be confirmed, so it is recorded as a Known Issue to re-check, not asserted as data loss.
