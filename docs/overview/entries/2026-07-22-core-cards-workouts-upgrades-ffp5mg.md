## 2026-07-22/23 — Core score-cards + Activity overhaul (planned + implemented, v1.201.0)

Owner-directed work on the app's central pillars: the four home score cards (Readiness / Heart Rate /
Sleep / Activity) and their scoring. The session first designed the change with the owner (two mockups)
and wrote the plan, then the owner asked to build it in-session — so this one PR carries **both** the
plan and the implementation of W-A, W-C, W-D in full plus the W-B scoring core.

**What was produced (docs):**
- Master plan [`docs/superpowers/plans/2026-07-22-core-score-cards-and-activity-overhaul.md`](../../superpowers/plans/2026-07-22-core-score-cards-and-activity-overhaul.md)
  — four self-contained workstreams (W-A…W-D), each with pinned (tunable) anchors/weights.
- Backlog queue section "▶ Core score-cards + Activity overhaul" (`docs/implementation-backlog.md`),
  updated with what shipped vs the device-gated W-B remainder.

**What shipped (code, v1.201.0):**
- **W-A** — home score cards redesigned as white-bordered circles (white icon+number, colour dot+band
  word, full-width in equal flex lanes so they can't intersect); HR card now shows **average resting HR +
  a baseline low/steady/elevated cue** (new `restingHr`/`restingHrBaseline` on `/api/readiness-score`),
  retiring the `scoreBand(rawBpm)` bug; 4 user-visible "Oura" strings removed.
- **W-C** — sleep score recalibrated so an excellent night reaches high-90s/100 (normal-good still <90,
  session-245 guard preserved), latency/timing peaks raised to a true 100, **overnight HRV folded in**
  (opt-in via a trailing-baseline threaded from the readiness route).
- **W-D** — readiness recalibrated: softened z-scaling (100 at +1.5σ), **mood/energy check-in** added as a
  contributor, weights fixed to sum 1.00, temperature closer-better mapping fixed to peak at baseline.
- **W-B (core)** — new single-source `lib/health/daily-goals.ts` (reuses the canonical Mifflin BMR +
  activity-level step map), goal-anchored two-lane `computeActivityScore` (daily movement + rolling 7-day
  strength, graded workout curve), over-exertion taper; wired into the route (pre-taper → composite,
  tapered → display).

**Decisions locked with the owner (validated via two live mockups — card visual direction + a "perfect
day" achievability preview):**
- **W-A visual:** four **white-bordered circles**, white icon+number, colour demoted to a **dot + small
  band word** under the number, full-width, **non-intersecting** (responsive shrink). Retires the coloured-number
  look for a calmer Oura-like read.
- **HR card:** shows **average resting HR (value) + a high/low baseline indicator** — retires the
  `scoreBand(hrCurrent)` bug (raw bpm was being banded as if a 0–100 score). HR is a value, not a 0–100.
- **De-Oura:** remove the 4 user-visible "Oura" strings on these surfaces (internal names/keys unchanged).
- **AI note:** reuse the existing `/api/ai/health-insight` + `AiInsightCard` ("how to raise this") — no new AI.
- **Activity v2:** goal-anchored (new single-source `getDailyGoals` shared with AI prescription + nutrition,
  evidence-based defaults: 8k steps / ~0.24×BMR kcal / 22 zone-min / move-every-hour / 3 sessions-per-7d),
  **two lanes** (daily movement + rolling 7-day strength so a rest day still scores), **graded workout curve**
  (rewards beyond 2/wk), **over-exertion taper** (100 = optimal not maximum), **move-every-hour + sedentary
  nudge**, home circle shows **yesterday's completed** score (fixes "0 all morning"), feeds readiness/body-battery
  **without double-counting** (readiness reads pre-taper goal completion; ACWR stays the single load-fatigue home).
- **Sleep recalibration:** proven in the preview that the current curves cap an excellent night ~92 (latency
  sub caps 98, timing 97, total needs 10 h). Retune anchors so ~8 h excellent → ~100, and **fold in overnight
  HRV** (biggest unused recovery signal).
- **Readiness recalibration:** current `zToScore` needs +2.5σ on every axis + weights sum 0.99 → caps ~86.
  Soften to 100 at +1.5σ, **add the mood/energy check-in** contributor, fix weight sum to 1.00, floor the
  today-activity term to neutral early (raises the morning readiness/body-battery anchor).

**Verification:** `tsc` clean (only the pre-existing `onnxruntime-web` optional-dep error remains); full
suite **1876 passing** (8 new: sleep-HRV/achievability, readiness z-softening/check-in/temp, activity
two-lane/taper, daily-goals) + 138 skipped, the one failing suite being the pre-existing `onnxruntime-web`
import. Dev-server round-trip on the seeded user: `/api/readiness-score` 200 returning the new
`restingHr`/`restingHrBaseline`, recalibrated sleep (82) and readiness (88, composite path), and the
goal-anchored activity score; home + `/health/{heart-rate,activity,sleep}` all SSR 200.

**NOT verified (device-gated) — carry to the smoke run:**
- Samsung-WebView render of the four circles (non-intersection at the real S25 width, safe-area, border
  anti-alias) — web sandbox can't confirm the on-device look.
- Real ring-data scores: the seed lacks ≥14-night baselines / overnight HRV / a mature composite, so the
  sleep-HRV contributor, the +1.5σ readiness terms, and a real "great day → ~100" are unproven on real data.
- **W-B device lanes still OPEN** (not in this PR): zone-minutes + move-every-hour lanes, the hourly move
  nudge, and the yesterday-completed home display (the circle currently shows today's goal-anchored score).
  They need the intraday HR/step series — follow-up PR `feat/activity-score-v2-device-lanes`.

Anchors/weights are starting values, explicitly tunable. Reconciliation note: the sleep recalibration was
tuned to keep a normal-good night <90 (preserving the deliberate session-245 compression) while letting a
genuinely excellent night reach ~100 — both intents hold, verified by the existing guard test.
