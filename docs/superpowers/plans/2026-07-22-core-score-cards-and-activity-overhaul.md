# Core score-cards + Activity overhaul (owner-directed 2026-07-22)

The four home score cards (Readiness / Heart Rate / Sleep / Activity) and their scoring are the
app's central pillars. The owner walked through them on-device and directed a focused upgrade of
**presentation** and **scoring accuracy/achievability**. This is the master plan: **one section per
workstream (W-A…W-D)**, each self-contained enough to be its own implementer PR. Queue entries live
in [`docs/implementation-backlog.md`](../../implementation-backlog.md).

Design was validated live with the owner via two mockups (card visual direction; a "perfect day"
score preview proving each 100 is achievable). Decisions below are **locked**; the numeric anchors
are the **proposed starting values** and are explicitly tunable during implementation.

## Current implementation (verified against `main` 2026-07-22)

- **Card row:** `components/oura-score-chip-row.tsx` renders four `<Chip>` buttons from a single
  `/api/readiness-score` payload (`app/api/readiness-score/route.ts`). Band label + colour come from
  `scoreBand()` (`lib/health/score-band.ts`, ≥70 High / ≥50 Moderate / <50 Low). Each chip
  `router.push`es to `/health/{readiness,heart-rate,sleep,activity}`.
- **Body Battery:** `components/body-battery-card.tsx` ← `/api/body-battery` (separate, expands in place).
- **HR chip bug:** shows `hrCurrent` (last raw bpm) and bands it via `scoreBand(bpm)` — semantically
  meaningless (resting 60 → amber "MODERATE"). `hrMin/hrAvg/hrMax` are computed and returned **unused**.
- **Sleep score:** `lib/health/sleep-score.ts` (`computeSleepScore`). Uses duration/eff/rem/deep/latency/
  timing/restfulness. **Ignores** overnight HRV (`averageHrvMs`), resp-rate, HR, light-sleep, TIB.
- **Readiness:** primary path `computeBlendedScore` (route.ts) blends **frozen** Oura Cloud score + ACWR
  + temp; go-forward path is `computeReadinessComposite` (`lib/health/readiness-composite.ts`, weights
  sum **0.99**). `zToScore = 50 + z×20` → a term only hits 100 at **+2.5σ**. Check-in not a contributor.
- **Activity:** `lib/health/activity-score.ts` (`computeActivityScore`). Only three inputs: steps ÷
  **own trailing-avg**, active-cal ÷ **own trailing-avg**, workout volume ÷ typical. `clamp01` caps each
  at matching your own average → self-referential, no absolute goal, no over-exertion ceiling. Ignores
  active-time, MET-minutes, distance, sedentary, the `meet_daily_targets` signal, and the unused
  `users.stepsGoal`/`calorieGoal` columns. Legacy `blendActivityScore` (`lib/activity/blend-activity.ts`)
  is dead post-re-key.
- **Reusable infra already present:** `lib/health/daily-energy.ts` (Mifflin-St Jeor BMR + MET estimator),
  `hrMaxFromAge` + HR-reserve (body-battery), `computeVolumeAcwr` (ACWR/tonnage), `set_hr_stats` (per-set
  HR), `contributor-guide.ts` (static per-factor "how to improve" text), and the AI-note stack:
  `/api/ai/health-insight` + `components/health/ai-insight-card.tsx` (cached 6h client / server, rate-limit
  10/hr, prompt already ends with an actionable tip).

## Cross-cutting conventions (all workstreams honour)

- Band label/colour comes from the score-band helper — never re-derive 70/50 thresholds; colour always
  ships paired with the band label/icon (no colour-only state). The dot-only card variant stays compliant
  because each card keeps its distinct icon; the full label lives on tap-through.
- No hardcoded session names; timezone via `todayInTz()`; every date param through `normalizeDateParam`.
- **One formula, one place:** any new formula (goals, MET, zone-minutes, taper) lives once in `lib/` and
  is imported by every surface. Grep for an existing implementation before writing one.
- Safe-area: any new anchored control uses the floored utilities (`pb-safe-action`/`-lg`).
- Charts/sparklines reuse existing primitives; never pass `var(--x)` to a canvas paint API (`resolveColor`).
- Component files < ~800 lines; extract into `components/` children.
- **Device gate:** these touch offline reads, safe-area, notifications and real ring data. Green `pnpm dev`
  is necessary, not sufficient — each workstream states its on-device smoke or Known-Issues requirement.

---

## W-A — Score-card visual refresh + HR fix + de-Oura + AI note

**Branch:** `feat/score-card-visual-refresh`

**Locked design** (owner-approved mockup — B×C "circle" direction):
- Four **white-bordered circles** spanning the screen width, **white icon + white number**, a single
  **colour dot + small band word** under the number (MODERATE / GOOD / HIGH / LOW). Flat fill.
- **Circles must never intersect:** size responsively with an enforced minimum gap — shrink the diameter
  before they'd touch. Cap the diameter so 4 circles + 3 gaps always leave breathing room at the S25 width
  **and** narrower. Verify at ≤640px per CLAUDE.md. The band word sits *inside* the circle under the number
  so it can't collide with a neighbour.

**Tasks:**
1. Rebuild `oura-score-chip-row.tsx` to the circle design (rename file/component off the `Oura*` prefix,
   e.g. `score-chip-row.tsx` / `ScoreChipRow` — internal only, keep the import site updated). Keep the
   existing tap-through to `/health/*` and the low-wear dimming/warning behaviour.
2. **HR card → resting HR** (see also W-A note): the HR circle shows **average resting HR (bpm)** with a
   small "bpm" cue and a **high/low indicator vs the 28-day baseline** (↓ good / ↑ elevated), *not*
   `scoreBand(hrCurrent)`. Resting HR + baseline are already computed (`/api/body-battery` uses the 28-day
   RHR mean; surface it on `/api/readiness-score` or read the existing source). HR is a **value, not a
   0–100** — no band-into-100 conversion. Update the HR detail screen hero to match.
3. **De-Oura strings** (user-visible only — internal names/keys unchanged): `app/health/sleep/sleep-content.tsx:78`
   ("once your Oura Ring syncs"), `components/body-battery-card.tsx:167` ("your Oura heart-rate data"),
   `components/health/health-score-detail.tsx:211` ("not Oura's score"), `components/health/readiness-breakdown.tsx:44`
   ("Oura base" → e.g. "Baseline"). Leave the ring-*connection* card (`oura-section.tsx`) as-is (it's about the
   hardware). Lowercase "ring" wording is owner's-taste — leave unless the owner asks.
4. **AI note on the card:** surface the existing `AiInsightCard` ("how to raise this") when a card is opened.
   Reuse `/api/ai/health-insight` + the client cache/rate-limit exactly — **do not** build new AI. If the
   card row itself stays minimal (no expand), the note lives on the tap-through detail screen (already there);
   if the owner wants an in-place expand, mirror the Body-Battery expand pattern. **Decision to confirm on
   build:** minimal-row-only vs expand-in-place. Default: keep the four circles minimal, note stays on detail.

**Verify:** `pnpm dev` home row renders four non-intersecting circles at 360/390/412px widths; HR shows resting
bpm + baseline arrow; no user-visible "Oura" string remains on the four surfaces. **Device gate:** circle
sizing + safe-area at the real S25 width, Samsung-WebView border/anti-alias rendering — on-device smoke or a
Known-Issues row before merge.

---

## W-B — Activity Score v2 (goal-anchored, two-lane, over-exertion-aware)

**Branch:** `feat/activity-score-v2`

The largest workstream. Replaces the self-referential `computeActivityScore` with a **goal-anchored** model
where "100" means an objectively good day. Evidence base: WHO 2020 physical-activity guidelines (150–300
min/wk moderate + muscle-strengthening ≥2×/wk), MET-minutes as the unifying currency, Paluch 2022 (steps
plateau ~7–8k), ACSM zone/MET references.

### Single source of truth for goals (build FIRST)
New `lib/health/daily-goals.ts` → `getDailyGoals(user)`, the **only** place daily targets are defined,
imported by the activity score, the AI prescription, and nutrition (grep for existing goal reads —
`users.stepsGoal`/`calorieGoal` are currently unused; reconcile with wherever the AI already prescribes steps
so the prescribed number == the number the card scores against). Derived from profile (weight/sex/age/height):

| Goal | Default | Basis |
|---|---|---|
| `stepGoal` | 8,000/day (adjustable; ~6k for 60+) | Paluch 2022 plateau |
| `activeEnergyGoal` | `round(0.24 × BMR)` (~400 kcal for 70 kg / 179 cm / 30 y) | Mifflin-St Jeor via `daily-energy.ts` |
| `zoneMinutesGoal` | 22 min/day (=150/wk moderate; **vigorous counts ×2**) | WHO / ACSM |
| `moveHoursGoal` | (waking hours − 1) with ≥1 movement each | Oura "move every hour" |
| `strengthFreqGoal` | 3 sessions / 7 days | WHO ≥2, rewarding beyond |

All overridable in Profile. `kcal/min = MET × 3.5 × kg / 200`; zones off `hrMaxFromAge` + resting HR (Karvonen),
moderate = 64–76% HRmax, vigorous ≥77%.

### The two lanes (daily score, rolling strength)
Reconciles "scored every day" with intermittent workouts: daily-resettable movement + a rolling 7-day strength
window (a rest day still scores via recent training).

**Daily-movement lane (~55%):**
- `steps`: `clamp01(steps/stepGoal)×100` — weight 15
- `activeEnergy`: `clamp01(activeKcal/activeEnergyGoal)×100` — weight 15
- `zoneMinutes`: `clamp01(zoneMin/zoneGoal)×100` (vigorous min ×2) — weight 10
- `moveEveryHour`: `(daytimeHoursWithMovement/moveHoursGoal)×100` — weight 15

**Strength lane, rolling trailing-7-day (~45%):**
- `frequency`: curve on sessions in last 7d `[0→0, 1→45, 2→70, 3→90, 4→100, 5→100]` — weight 25
  (rewards beyond 2/wk, saturates ~4–5)
- `volume`: `clamp01(trailing7dTonnage / (typicalSessionVol × strengthFreqGoal))×100` — weight 20

Composite = weighted mean over present lanes (renormalise missing). Reuse `computeVolumeAcwr` for tonnage;
per-hour movement + zone-minutes computed from the HR/step series (new `lib/health/zone-minutes.ts` +
`lib/health/hourly-movement.ts`).

### Over-exertion taper
Past the ACWR optimal band **and** with movement/strength well above target, apply a multiplicative taper
(`score × (1 − penalty)`, penalty scaled by how far ACWR exceeds `optimalMax`, capped ~0.15) so a genuine
over-reach dips **below 100**. **100 = optimal, not maximum effort.** The optimal band is wide so a normal
hard workout stays at the top.

### Feeds readiness / body battery — without double-counting
Readiness's activity contributors read the **pre-taper movement/goal-completion** sub-scores (ACWR stays the
single home for load-fatigue in readiness — see W-D). The taper affects only the **Activity card's displayed
number** and its Body-Battery influence. The "today" activity term in readiness is **floored to neutral early
in the day** so a quiet morning can only *lift* readiness, never drag it (this is the "readiness starts higher"
fix the owner asked for — it raises the Body-Battery morning anchor).

### Display
- **Home circle = yesterday's completed Activity score** (a stable, comparable 0–100 like Sleep shows last
  night — fixes the "always 0 all morning" complaint).
- **Live "today" goal-fill** (movement lane progress) lives on the **Activity detail screen** (and can nudge
  Body Battery), not the minimal home circle.

### Move-every-hour nudge
Sedentary detection per daytime hour from the step counter / HR series; when the current hour has no movement,
fire the hourly "time to move" heads-up via the **existing** notification channel (reuse `health-alerts` /
`LocalNotifications` — no-op on web, native-gated). Feeds `moveEveryHour` in the score.

**Verify:** unit-test `daily-goals`, `zone-minutes`, `hourly-movement`, the taper, and the two-lane composite
(boundary + renormalise cases); dev-server exercise of `/api/readiness-score` activity block + the new goals
route. **Device gate:** real step/HR series for zone-minutes + hourly movement, the native move nudge, and the
offline-first read path are APK-only — on-device smoke required (or Known-Issues rows). Mirror any new write in
the `pushMutations` branch if goals become user-editable synced data.

---

## W-C — Sleep score recalibration (+ overnight HRV)

**Branch:** `feat/sleep-score-recalibration`

**Problem proven in the preview:** the live formula's `latency` sub caps at **98** and `timing` at **97** (can
never reach 100), `totalSleep` needs **10 h** for 100 and `deep` needs **2 h** — so even a physiologically
perfect night maxes ~98, and an excellent 8.3 h night computes ~92. The top of the scale is unreachable.

**Recalibrate `computeSleepScore`** so a genuinely excellent (not superhuman) night reaches high-90s/100, and
**fold in overnight HRV** (the biggest unused recovery signal, `sleep_sessions.averageHrvMs`). Proposed anchors
(tunable):

- **Weights** (sum 100): totalSleep 28, deep 12, rem 12, efficiency 10, latency 8, timing 8, restfulness 10,
  **hrv 12** (total reduced 35→28 to make room).
- `TOTAL_SLEEP` (h): `[4→30, 5→52, 6→72, 7→90, 7.5→96, 8→100, 9→100, 9.5→98, 10.5→94]` — 100 at 8 h, gentle
  over-sleep taper.
- `EFFICIENCY` (%): `[80→45, 85→65, 88→80, 90→88, 92→95, 94→99, 96→100]`.
- `REM` (h): `[0.5→40, 0.9→68, 1.2→85, 1.5→95, 1.8→100, 2.4→100]`.
- `DEEP` (h): `[0.5→48, 0.8→72, 1.1→90, 1.4→100, 1.9→100]` — 100 at 1.4 h (was 2 h).
- `LATENCY` (min, U-curve, peak raised to 100): `[0→82, 5→94, 12→100, 18→97, 25→88, 35→72, 50→52, 100→14]`.
- `TIMING` (dist hrs from 03:00, peak raised to 100): `[0→100, 0.75→94, 1.5→84, 2.5→64, 3.5→44, 5→22]`.
- `RESTFULNESS`: base tracks efficiency (drop the −6) so a high-eff / low-restless night can top out; keep the
  restless/awake penalties.
- **`HRV` (new)**: `averageHrvMs` vs personal 28-day baseline (ratio anchors `[0.7→40, 0.85→65, 1.0→90, 1.1→100]`
  — at/above your norm scores high). Provisional neutral (~75) until ≥14 nights of baseline; render provisional
  like the readiness composite does.

**Temperature stays out of the sleep score** — it's a recovery signal, kept in readiness (avoids double-count).
Confirm with owner if they want a small temp term here instead.

**Verify:** unit tests for every anchor + the recalibrated composite, including the "excellent 8.3 h night → ~99"
and "perfect night → 100" cases and the provisional-HRV path. Grep for every reader of `computeSleepScore` (home
card, sleep detail, readiness `previousNight` term, body-battery sleep anchor) — all inherit the recalibration
automatically; confirm no reader hardcodes the old ceiling. **Device gate:** none for the math (deterministic);
real overnight HRV values need the S25 to confirm sane sub-scores (seed has sparse HRV).

---

## W-D — Readiness recalibration (achievable 100 + check-in)

**Branch:** `feat/readiness-recalibration`

**Problem proven in the preview:** `zToScore = 50 + z×20` only reaches 100 at **+2.5σ** (needing 2.5-sigma on
every axis simultaneously), weights sum to **0.99** (max 99), and the check-in isn't a factor — so a genuinely
great recovery day caps ~86.

**Recalibrate `computeReadinessComposite`** so perfect HR/sleep/activity + a good check-in reach ~98–100:

- **Soften z-scaling:** `zToScore = clamp(50 + z×33.3, 0, 100)` → 100 at **+1.5σ**, 0 at −1.5σ.
- **Add the subjective check-in** (`mood_logs` energy/mood) as a contributor mapping to 0–100
  (e.g. drained→30, low→50, ok→70, good→88, energised→100). Neutral (~70) when no check-in that day.
- **Rebalance weights to sum 1.00** (proposed): rhr .15, hrv .15, previousNight .16, sleepBalance .10,
  temperature .10, prevDayActivity .09, activityBalance .06, recoveryIndex .09, **checkin .10** (= 1.00).
- `previousNight` inherits the **recalibrated** sleep score (W-C) — build W-C first or land together.
- `activityBalance` (today) reads the **pre-taper movement/goal completion** from W-B and is floored to neutral
  early in the day (the "readiness starts higher" fix). ACWR/`loadScore` remains the single home for
  load-based fatigue — the activity taper does **not** feed readiness (no double-count).

**Note on the display path:** the go-forward readiness IS the composite (Cloud is frozen post-re-key). If the
blended-Cloud path is still reachable for pre-re-key days, leave `computeBlendedScore` intact; the recalibration
targets the composite that actually renders today.

**Verify:** unit tests proving the "perfect day → ~98–100" and "average day → ~mid" cases, the check-in mapping,
the +1.5σ ceiling, and the 1.00 weight sum. Dev-server `/api/readiness-score` composite path with seeded signals.
**Device gate:** real baseline/z data needs the S25 (seed lacks ≥14-night baselines) — the math is deterministic
and sandbox-testable, real-value sanity is device/real-data gated.

---

## Sequencing

W-C and W-D are coupled (readiness reads sleep) — build W-C first or together. W-B is independent and largest.
W-A (visual) is independent of the scoring work and is the fastest visible win. Suggested order: **W-A → W-C →
W-D → W-B**, but any can proceed alone. Each ships user-visible changes → version bump + `lib/changelog.ts` entry
per PR. All four are **device-gated** (real ring data / notifications / Samsung WebView) — none is "done" on green
`pnpm dev` alone.
