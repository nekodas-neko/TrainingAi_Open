# Workout Timing Fidelity — warmup cap, session anomaly flags, monitoring baseline

**Status:** Design spec (planning session). Implementation plan:
`docs/superpowers/plans/2026-07-06-timing-fidelity-warmup-cap-anomalies-baseline.md`.

**Origin:** User raised this after a real session where they stepped away for ~10 minutes
*before logging their first set*, producing a 22-minute "warmup" in the admin Time Audit.
They asked how unaccounted time works, whether outliers are discarded from averages, and
proposed (a) a hard warmup cap with the overflow treated as unaccounted, (b) keeping the raw
value but flagging it as a reviewable outlier, and (c) starting accurate monitoring from a
chosen "first viable day". This spec resolves all three at the highest fidelity the current
data model allows.

---

## Background — how timing works today (grounded against `main`)

All timing derivation is **read-time only** (`lib/workout/time-audit.ts`); nothing is stored
except the raw timestamps (`workout_sessions.started_at/completed_at/warmup_ended_at`,
`set_logs.set_time_sec/rest_time_sec/set_start_ms`, `exercise_logs.inter_exercise_rest_sec`).
The admin Time Audit (`/api/admin/time-audit`, `components/admin/time-audit-card.tsx`) is the
only consumer that surfaces the decomposition; `lib/data/postgres/slices/periodization.ts`
(`getAvgSetDurationPerExercise`) is the only consumer that feeds measured set durations into
planning (the AI prescription prompt).

**Session decomposition** (`decomposeSessions`): each completed session's wall-clock is split
into five buckets — `warmup`, `work` (Σ set time), `rest` (Σ inter-set rest), `transition`
(Σ inter-exercise rest), and **`unaccounted` = total − the other four**. Unaccounted is a pure
residual: whatever wall-clock no timer captured.

**Warmup is defined as `started_at → first set`** (`warmup_ended_at`, falling back to the first
`set_start_ms`). So any dead time *before the first logged set* is attributed to warmup — this
is why the 10-minute absence became a 22-minute warmup rather than unaccounted time.

**Outlier handling today** (`robustStats`): a value outside **[median × 0.25, median × 4]** is
excluded as a tracking error. This is applied to **set / rest / transition** durations, both in
the admin medians *and* in `robustAvgSetDurationsByExercise` (which feeds planning). So the
timing averages that matter for planning **already discard outliers**. Rep *counts* are real
data, never outlier-filtered.

### The two gaps the user's scenario exposes

1. **Warmup and unaccounted are shown raw — never averaged, never anomaly-checked.** A 22-minute
   warmup is inert to planning (warmup uses a flat `SESSION_WARMUP_MIN = 10` constant, not
   measured warmup) but looks alarming and un-annotated in the audit.
2. **`robustStats`'s relative band cannot catch these two buckets.** Warmup isn't averaged, so
   there's no median to band against; and even if there were, a 22-vs-12-minute warmup is only
   ~1.8×, comfortably inside the `[0.25×, 4×]` window. Unaccounted is a residual with no natural
   median at all. **Both need absolute thresholds, not the relative outlier logic.** This is the
   central design constraint.

---

## Design principles

- **Raw timestamps are sacrosanct.** Nothing in this feature mutates a stored timing value. The
  warmup cap and anomaly flags are *read-time reinterpretation*, consistent with the existing
  time-audit derivation and the CLAUDE.md Stored-Counters rule. (The one stored value added — the
  monitoring baseline date — is user *input*, not a derived counter.)
- **Relative bands for per-exercise medians; absolute ceilings for whole-session buckets.** Keep
  `robustStats` exactly as-is for set/rest/transition medians. Add absolute thresholds only for
  warmup, unaccounted, and per-set runaway detection — the cases the relative band structurally
  can't see.
- **Cap for readability, flag for review, never silently discard.** The capped warmup keeps the
  bucket plausible; the raw overflow is surfaced as an explicit anomaly so it can be reviewed, not
  hidden.
- **Admin audit is the review surface.** This is a single-user app; the user is the admin. The
  Time Audit card is the natural home for anomaly review — no new user-facing notification surface
  is in scope (see Non-goals).

---

## The design

### 1. Warmup cap with overflow → unaccounted

New constant `MAX_PLAUSIBLE_WARMUP_SEC = 900` (15 min — the user's suggested ceiling; generous
headroom over the planner's 10-min assumption for a legitimate mobility + ramp-set warmup, while
still catching a stepped-away gap).

In `decomposeSessions`, compute `rawWarmupSec` as today, then:
- `warmupSec = min(rawWarmupSec, MAX_PLAUSIBLE_WARMUP_SEC)` — the reported bucket.
- Because `unaccounted = total − warmup − work − rest − transition`, capping `warmup` in that
  subtraction **automatically** rolls the overflow into `unaccounted` (no separate addition
  needed). The excess lands in the honest "time I can't attribute to training" bucket.
- The `SessionDecomposition` retains **both** `rawWarmupSec` and (capped) `warmupSec`, plus a
  derived `warmupOverflowSec = max(0, rawWarmupSec − cap)`, so nothing is lost and the anomaly
  detector and UI can show the real number.

### 2. Session anomaly flags (absolute thresholds)

Add an `anomalies: SessionAnomaly[]` field to `SessionDecomposition`, each entry
`{ type, sec, detail }`. Detected per session:

| Type | Condition | Constant |
|---|---|---|
| `warmup_over_cap` | `rawWarmupSec > MAX_PLAUSIBLE_WARMUP_SEC` | 900s |
| `excessive_unaccounted` | `unaccountedSec > MAX_PLAUSIBLE_UNACCOUNTED_SEC` | 600s (10 min) |
| `runaway_set` | any single `set_time_sec > SET_TIME_SANITY_CEILING_SEC` | 600s (10 min) |
| `runaway_rest` | any single `rest_time_sec > REST_TIME_SANITY_CEILING_SEC` | 900s (15 min) |

`runaway_set`/`runaway_rest` are the whole-session mirror of the per-exercise robust-median
exclusion: the median already *ignores* these, but the session view had no way to say "this
session had a timer left running." Absolute per-value ceilings are the right tool because they're
independent of any exercise's median.

The admin card renders a compact ⚠ badge on flagged sessions with the reasons, e.g.
`⚠ 22m warmup (7m over cap → unaccounted)`. Reads as: accurate raw value, plausible bucket,
explicit note — exactly the user's "keep it accurate and flag it for review" outcome.

**Averaging is unaffected:** medians stay `robustStats`-based. The anomaly flags are a review
signal, not an input to any average. This keeps the two concerns cleanly separated.

### 3. Monitoring baseline date

New nullable column `users.timing_baseline_date` (date). Semantics:
- **Null (default):** behave exactly as today — the audit's rolling N-day window and planning's
  full history apply, protected by the existing outlier exclusion.
- **Set:** used as a *lower bound*. The audit window becomes
  `max(now − days, timing_baseline_date)`, and planning's `getAvgSetDurationPerExercise` gains the
  same lower bound — so pre-baseline "learning period" sessions never pollute either the review
  numbers or the planning medians.

Control lives in the admin Time Audit card: a one-line "Monitoring baseline: `<date>` · [Set to
today] · [Clear]" row, backed by a tiny `GET/POST /api/admin/timing-baseline` route (admin-gated,
mirrors the time-audit route's `requireAdmin` shape).

**Why it's worth adding despite the rolling window + robust medians:** those protect *averages*
statistically, but they don't let the user consciously declare "my timing habits weren't dialed
in before day X — ignore it." The baseline is that explicit line. It directly serves the user's
"start accurate monitoring from the first viable day" intent.

**No deadline.** Nothing about the data requires this to land by any particular calendar day — the
rolling window + robust medians already keep today's messy session from corrupting anything. Once
this ships, the user sets the baseline to whichever day they judge "first viable"; earlier is
simply cleaner.

---

## Chosen constants (all centralized in `time-audit.ts`, one place)

| Constant | Value | Rationale |
|---|---|---|
| `MAX_PLAUSIBLE_WARMUP_SEC` | 900 (15m) | User's cap; > planner's 10-min assumption, < any stepped-away gap |
| `MAX_PLAUSIBLE_UNACCOUNTED_SEC` | 600 (10m) | A real session rarely has >10 min truly untracked |
| `SET_TIME_SANITY_CEILING_SEC` | 600 (10m) | No real single set runs 10 min; beyond = timer left running |
| `REST_TIME_SANITY_CEILING_SEC` | 900 (15m) | Longest plausible programmed rest ≈ 5 min; 15 min = runaway |

These are judgment calls, not formulas — chosen conservatively so a real (if unusual) value is
never flagged. They live beside the existing `MIN_TRUSTED_SAMPLES` / `MIN_SESSION_SEC` constants
and are trivially tunable once real data accrues.

---

## Non-goals (explicitly out of scope)

- **No user-facing anomaly notification.** No done-screen banner, push, or home note saying "your
  warmup was long." The admin Time Audit card is the review surface for this single-user app.
  (Could be a future extension if the user wants an active nudge — noted, not built.)
- **No change to `robustStats` or the per-exercise/equipment median logic.** It's correct; this
  feature only adds the absolute-threshold layer the relative band can't cover.
- **No mutation of stored timing values, and no backfill.** Purely additive read-time derivation
  plus one new input column.
- **No new outlier filtering of rep counts.** Reps are real data, not tracking errors.
- **Not feeding measured warmup back into the planner.** The planner keeps `SESSION_WARMUP_MIN`;
  replacing it with a measured warmup median is a separate, larger duration-model calibration
  effort already noted in `duration-model.ts`.

---

## Verification surfaces (for the implementer)

- **Pure functions** (`decomposeSessions`, anomaly detection) are fully unit-testable — the core
  of the work needs no device and no DB (the existing `lib/__tests__/time-audit.test.ts` harness
  covers `decomposeSessions` already).
- **Admin card + baseline route** verify against the local dev DB via `pnpm dev` (seed a session
  with a 22-min pre-first-set gap and a runaway set; confirm the cap, the unaccounted overflow,
  the ⚠ badge, and the baseline lower-bound all behave).
- **Not exercised in-sandbox:** on-device Samsung WebView rendering of the admin card (low risk —
  admin tooling, not a hot user path). State this in the PR per CLAUDE.md.
