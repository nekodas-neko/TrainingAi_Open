# RPE-Based Autoregulation — Design Spec / Implementation Plan

**Date:** 2026-07-01
**Branch:** `claude/ai-periodization-trainer-overview-ss1ukn` (spec only — docs, low-risk)
**Status:** SPEC — design decisions taken with the user (see below). Ready to build layer-by-layer.

## Decisions taken with the user

1. **The trigger is RPE *combined with* 1RM direction, not RPE alone.** The last set is
   usually +1/AMRAP, so it is *meant* to be higher RPE than the mid-sets — that alone is
   fine. What matters: *"if 1RM increases with higher RPE it's okay; but if RPE is higher
   than recommended **and** 1RM goes down, then something needs to happen — possibly a
   larger (5–10%) weight decrease next session for that exercise."*
2. **Auto vs suggest follows the existing `autoApplyPrescriptions` program setting** — same
   as prescriptions today. Auto-apply on → adjust silently with a "why" note; off → surface
   as a suggestion the user accepts. No new toggle.
3. **Lever is the author's call, research-backed** → **load (weight) is the primary lever**
   (RPE-based load autoregulation is the best-evidenced approach for %-based strength work —
   APRE / RTS / Helms), with **volume flex (reps/sets) as the secondary lever for
   accessories**, where absolute load matters less than accumulated stimulus.
4. **Both responses are *graduated*, not flat.** Back-off scales the 5–10% cut by how badly
   you missed (rep-completion): miss by ~a rep → 5%, miss badly (≤70% completion) → 10%. The
   push side is the **inverse and symmetric**, but constrained by a key fact — *the engine
   can't raise your 1RM, only you can by lifting.* So when a lift is easy (RPE below expected)
   **and** you beat it, the engine raises the **demand** (target reps, then sets) and lets you
   earn the higher 1RM — **RPE-modulated double progression**. Easy sessions ratchet reps up
   the goal band; hitting the band ceiling converts to a load step and resets reps.

---

## Problem

Today the RPE slider barely does anything. It's stored per set, averaged program-wide
into one `rpeTrend`, and the **only** thing it mechanically triggers is an *emergency
deload* when the program-wide average runs more than 2.0 points above expected
(`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts:83`). Progression is
driven entirely by **reps × weight vs the target** (the `prescriptionFactor` self-referencing
1RM math in `lib/1rm.ts`). So:

- If a lift prescribed at 70% (expected RPE ~7) is actually hitting **failure (RPE 10)**,
  the engine does nothing about that specific lift — it keeps prescribing 70% of an
  estimated 1RM that is clearly **too high**. The "%" is lying.
- Conversely, hitting the target reps at a trivially easy RPE (headroom) doesn't make
  the engine progress any faster.

**The user's insight:** an RPE mismatch is a *calibration* signal, not just fatigue. "If
something is meant to be at 70% but you're hitting 100% failure, it should be adjusted —
either weight or reps/sets." That's autoregulation.

---

## The signal we already have

`set_logs` (migration 077) stores per set: `rpe` (5–10), `intensity_pct`, `reps`, `weight`.
No new migration is needed to *read* the signal. `expectedRpeForPct()` already exists in
`lib/ai-periodization/signals.ts:50`.

**Delta = actual RPE − expected RPE.**
- Δ > 0 → harder than the load implies (fatigue, or 1RM estimate inflated).
- Δ < 0 → easier than the load implies (headroom, or 1RM estimate deflated).

### ⚠️ Refinement required: the expected-RPE model must be reps-aware

The current `expectedRpeForPct` buckets on **% alone**, which is wrong — RPE depends on
**% *and* reps**. 70% × 3 reps is RPE ~4; 70% × 12 reps is RPE ~8. Autoregulation needs a
monotonic, reps-aware expected-RPE so the delta is meaningful.

**Proposed model (reps-in-reserve):** at a given `pct`, the max reps to true failure is the
inverse of the 1RM formula — `maxReps(pct) = repFactor⁻¹(1/(pct/100))`. If you did `reps`,
then `RIR = maxReps − reps` and `expectedRPE = 10 − RIR`. This ties directly to the same
`repFactor` curve already in `lib/1rm.ts`, so the two stay consistent. Replaces the coarse
bucket function; keep the old one as a fallback when reps are missing.

---

## Design — the RPE × 1RM quadrant (primary mechanism)

Per exercise, over the last 2–3 program-scoped sessions, combine two signals we already
compute in `signals.ts`:

- **RPE-vs-expected** — average of `actualRPE − expectedRpe(pct, actualReps)` across that
  exercise's sets (reps-aware model below). "Higher than recommended" = avg Δ ≥ **+1.5**.
- **1RM direction** — the per-exercise `rm1Trend` (`up` / `flat` / `down`) already in
  `signals.ts:120`.

| | **1RM up / flat** | **1RM down** |
|---|---|---|
| **RPE *lower* than expected** | **⬆️ Push quadrant.** You beat the target easily → *demand more next session* (graduated rep/set bump — see below). | Rare (easy but regressing) → treat as noise; reps-driven math handles the load. No RPE action. |
| **RPE ≈ expected** | Progressing on-plan → **no action**, let normal progression run. | Rep miss / off day → **existing reps-driven** 1RM math already lowers next prescription. No extra RPE cut. |
| **RPE *higher* than recommended** | **Working hard *and* progressing → fine. No action.** (The +1/AMRAP-heavy session the user called out — high RPE here is healthy.) | **⬇️ Back-off quadrant.** Load miscalibrated / overreaching → **graduated 5–10% weight cut next session** (see below). |

Two rules in one: high RPE only bites when the lift is *also* regressing (back-off); low RPE
only fires when you're *also* progressing (push). Either signal alone → no action.

---

## Graduated magnitude — both directions

A flat number is wrong; the size of the response scales with how far off you were.

### ⬇️ Back-off cut (5–10%) — driven by how badly you missed

The user's framing: *"fail at RPE 10 by 1 rep → small 5% decrease; fail by more → up to the
10% max."* Driver is **rep-completion rate** for that exercise last session (`actual reps /
prescribed reps` — already computable, cf. `repCompletionRate` in `signals.ts:202`):

```
completion ≥ 0.95  (missed by ~a rep)      → 5%   (floor)
completion ≤ 0.70  (missed badly)          → 10%  (ceiling — the user's "7/10 or under")
in between                                 → linear 5→10%
cut% = 5 + 5 × clamp((0.95 − completion) / (0.95 − 0.70), 0, 1)
```

So completion 0.95 → 5%, 0.825 → 7.5%, ≤0.70 → 10%. Gated on the back-off quadrant (RPE high
**and** 1RM down); the 1RM drop is the corroborating signal, rep-completion sets the size.

### ⬆️ Push demand — graduated *reps/sets*, because the engine can't fake a 1RM

Key constraint the user raised: **the engine can't raise your 1RM — only you can, by lifting.**
So on the easy-and-progressing side it can't just declare a heavier weight; it raises the
**demand** and lets you *earn* the higher 1RM. This is **RPE-modulated double progression**:

- Each goal/phase has a rep **band** (e.g. powerbuilding accumulation 6–8). Beating the target
  at a low RPE bumps the **target reps** up the band, scaled by how far under expected you were:
  - Δ ≈ −1 (a bit easy) → **+1 target rep**
  - Δ ≤ −2 (very easy) → **+2 target reps**, or **+1 set** for accessories
- When target reps hit the **band ceiling**, the extra reps you then hit push the estimated
  1RM up via the existing self-referencing math → next prescription's **weight** steps up and
  target reps **reset to the band floor**. Classic double progression, RPE sets the climb rate.
- This is the "if you're easily increasing weights it should scale accordingly" ratchet: reps
  climb → 1RM earned → load climbs → reps reset → repeat, faster when RPE says you have room.

**Lever split still applies:** compounds prefer the load step once at the band ceiling;
accessories prefer adding a set. Never let reps drift **outside** the goal's band (that would
leave the intended intensity zone) — surplus converts to load instead.

### ⏱️ Adding a set must respect the time budget (steal time, don't overrun)

A whole extra set costs real time and can push the session past its `timeBudgetMinutes`.
The engine **already** models this — `estimateSessionDurationSec` / `fitToBudget`
(`lib/ai-periodization/time-budget.ts`) price each set (10s setup + reps×4s + rest
transition) and trim accessories-first when over budget. The push-side set-add must route
through it, with one addition: the **earned set is priority-protected**.

Order of operations when the push logic wants to add a set to exercise X:

1. **Prefer reps over a set.** A rep bump costs ~4s/rep on one set; a set costs a full
   setup + reps + rest block. Exhaust the rep-band climb first — only add a set when reps
   are already at the band ceiling (or it's an accessory whose stimulus wants frequency).
2. **Price it.** Re-estimate the session with the extra set. If it still fits the budget →
   done.
3. **If it overruns, steal time — don't overrun.** Re-run `fitToBudget` with X's new set
   marked highest-priority so it trims the session's **lowest-value** set instead (a
   redundant accessory set elsewhere). Net effect: volume is *redistributed* toward the lift
   that earned it, session length unchanged.
4. **If nothing can be trimmed without harming priority work, don't add the set.** Fall back
   to the rep bump only (double progression still carries the gain via load at the ceiling).
   Explain it: *"Would've added a set but the session's at its time limit — pushed reps instead."*

This makes the set-add self-funding within the existing time guard rather than a way to
silently blow the session over.

### Why the +1/AMRAP last set doesn't false-trigger

The reps-aware `expectedRpe(pct, reps)` (below) *expects* a near-max RPE when you grind out
AMRAP reps: high reps → RIR ≈ 0 → expected RPE ≈ 9–10. So a hard last set produces Δ ≈ 0,
not a false "too hard" flag. The old %-only bucket model could **not** do this — which is
why the reps-aware model is a prerequisite, not a nice-to-have.

### Applying the adjustment (auto vs suggest)

- `autoApplyPrescriptions === true` → bake the 5–10% cut straight into the next prescription
  for that exercise, with an `explain.ts` line: *"−7.5% — RPE ran high while 1RM slipped."*
- `autoApplyPrescriptions === false` → surface it as part of the pending prescription the
  user reviews/accepts (same flow as today).

### Secondary lever — accessories flex volume, not load

For **accessory** role in the action quadrant, prefer trimming a set / reducing target reps
over cutting load (absolute load matters less for accessory stimulus). **Compounds** always
adjust load to stay on-percentage. (Research-backed default per decision 3.)

### Optional later layer — within-session live nudge

Not in scope for v1 (the user's framing was entirely next-session). A future add: after a
mid-set logs far above expected RPE, offer to drop the *next set* this session. Deferred
until the cross-session quadrant is trusted on-device.

**The existing `rpeTrend.delta > 2.0 → emergency deload` stays** as the program-wide systemic
safety net above the per-exercise quadrant.

---

## Guardrails (load-bearing)

- **Dead-band ±1 RPE** — back-off needs avg Δ ≥ +1.5, push needs avg Δ ≤ −1.5; nothing
  fires on a single point of subjective noise.
- **Both signals must agree** — back-off only when RPE high *and* 1RM down; push only when
  RPE low *and* reps/1RM beaten. Either signal alone → no action. Core anti-overreaction guard.
- **Min data:** need **≥3 RPE-tagged sets** for that exercise across the window, *and* a
  valid `rm1Trend` (current + previous PR to compare). Missing either → no action.
- **Back-off clamped to 5–10%** of working load, once per session — never compounds on top of
  the reps-driven decrease.
- **Push clamped to +2 target reps or +1 set per session**, and **never past the goal band
  ceiling** — surplus converts to a load step (via earned 1RM), keeping the lift in its zone.
- **A set-add never overruns the time budget** — it routes through `fitToBudget` with the
  earned set priority-protected, funding itself by trimming the lowest-value set elsewhere;
  if it can't fit without harming priority work, it falls back to the rep bump. Session length
  is preserved, volume is redistributed.
- **No double-counting:** reps stay the primary progression signal — RPE only sizes the cut
  (down-and-hard) or accelerates the double-progression climb (easy-and-up); it never
  overrides what reps already justify, and never *raises* the 1RM directly.
- **Phase-aware:** in intensification/realisation, expected RPE is naturally 9–10; the
  reps-aware model handles this, but keep an explicit phase guard so peak grinds don't read
  as "too hard," and don't push reps in a low-rep peak block.
- **Skip when RPE absent** — degrades gracefully to today's reps-only behaviour.

---

## Touch points (where the code changes)

| Area | File | Change |
|------|------|--------|
| Reps-aware expected RPE | `lib/ai-periodization/signals.ts` | Replace `expectedRpeForPct` (%-only bucket) with a RIR-based `expectedRpe(pct, reps)` off the same `repFactor` curve as `lib/1rm.ts`; keep the old fn as a no-reps fallback |
| Per-exercise RPE × 1RM | `lib/ai-periodization/signals.ts` | Group set logs by exercise; emit `perExerciseRpeDelta` and pair it with the existing per-exercise `rm1Trend` |
| Per-exercise rep completion | `lib/ai-periodization/signals.ts` | Emit `repCompletionRate` **per exercise** (today it's a single program-wide aggregate) — it drives the back-off cut size |
| Quadrant + graduated magnitude | `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` | Apply the quadrant; **back-off:** `5 + 5×clamp((0.95−completion)/0.25,0,1)` % load cut (compounds) / set trim (accessories); **push:** +1/+2 target reps (or +1 accessory set) up the goal band, load step at the ceiling; branch on `autoApplyPrescriptions` |
| Goal rep bands | `lib/ai-periodization/goal-ranges.ts` | Expose each goal/phase's rep **band** (floor/ceiling) so the double-progression climb knows its bounds |
| Time-budgeted set-add | `lib/ai-periodization/time-budget.ts` | Extend `fitToBudget` to accept a priority/protected set so an earned set steals time from the lowest-value set instead of overrunning; push logic re-prices via `estimateSessionDurationSec` before committing a set |
| AI prompt context | `lib/ai-periodization/prompt.ts` | Surface per-exercise RPE-vs-expected, 1RM direction, and rep-completion so the model agrees with the deterministic adjustment |
| Explain / transparency | `lib/ai-periodization/explain.ts` | "−7.5% — RPE ran high while 1RM slipped" / "+1 target rep — that felt easy, earning the next jump" |
| Changelog / version | `lib/changelog.ts`, `package.json` | Minor bump (new feature) |

**No new DB migration** — `set_logs.rpe` + `intensity_pct` already exist. Everything is
computed on the fly from recent set logs; no stored calibration offset needed for v1.

---

## Rollout / testing

- Build behind the existing `ai_dynamic` gate; degrades to reps-only when RPE is missing.
- Unit tests:
  - reps-aware expected-RPE monotonicity; **AMRAP set produces Δ ≈ 0** (key false-positive guard).
  - back-off fires *only* in down-and-hard; cut size = 5% at completion 0.95, 7.5% at 0.825,
    10% at ≤0.70; clamped to [5,10].
  - push fires *only* in easy-and-up; +1 rep at Δ≈−1, +2 (or +1 set) at Δ≤−2; never exceeds
    the goal band ceiling (surplus → load step, reps reset to floor).
  - **time-budget:** an earned set that fits is added; one that overruns trims the
    lowest-value set elsewhere (session duration unchanged); one that can't fit without
    harming priority work falls back to the rep bump.
  - both-signals-required; graceful skip on missing RPE / no prior PR.
- Local dev-DB runtime checks: seed high-RPE + declining-1RM + poor completion → verify a
  ~10% cut; seed high-RPE + rising-1RM → verify **no** cut; seed low-RPE + beaten reps →
  verify target reps climb one step (and roll to a load bump + rep reset at the band ceiling).
- Ship as one PR (cross-session quadrant is self-contained); the optional live within-session
  nudge is a separate later PR.
