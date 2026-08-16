## 2026-07-23 — HR recovery curve on the card + Recovery Profile spec (v1.201.2)

**Branch:** `claude/hr-workout-data-recording-ij3kwh` (fresh from `main`). Owner asked (a) whether to add
a 2-minute recovery mark and (b) to explore a cross-activity recovery-by-intensity profile.

### Shipped (cheap win)
The per-exercise "Heart & Recovery" card now shows the **full recovery curve — 30s / 1m / 90s / 2m** —
instead of only the 60s figure. The data was already there: `set_hr_stats` stores `drop_30s/60s/90s/120s`
per set (migration 139); only `avgDrop60` was surfaced. Added `avgDrop30/90/120` to
`aggregateExerciseHrTrend` (`lib/workout/exercise-hr-trend.ts`) and a compact 4-point curve row to
`exercise-hr-trend-card.tsx` (reusing the `↓/↑` arrow formatter; points past the rest actually taken —
e.g. 2m on a 90s rest — show "—"). `tsc`/lint clean; aggregator unit test extended and green.

### Written up (spec, not built)
The bigger idea — **HR Recovery Profile: recovery curve keyed by the HR you're recovering *from*, across
all activity (lifting rests + run cool-downs + the 1-min/1-min interval protocol), trended over time** —
is a validated intensity-normalised fitness marker and effectively a cardio-fitness tracker. It's a
net-new Health-screen feature (recovery-episode detector + peak-HR-band aggregation + card), so it's a
spec, not in-session code: [`docs/superpowers/plans/2026-07-22-hr-recovery-profile.md`](../../superpowers/plans/2026-07-22-hr-recovery-profile.md),
queued in `docs/implementation-backlog.md` as **HRP-1/2/3** (phased: aggregate from `set_hr_stats` first
→ add run/interval detection → trend + AI tool). The substrate all exists (`oura_heartrate` for every
activity, `set_hr_stats` for lifting rests, `resolveHrProfile`, the running system); the genuinely new
piece is the episode detector for non-set sources. Key caveats captured in the spec: posture/source
confound (standing rest vs walking cool-down), low-intensity episodes are noise, detection is the hard
part (prefer the controlled interval protocol).

### Verification
`tsc` + `eslint` clean; aggregator test green; full gate (build/test) via CI. UI curve is web-verified
by construction (same card path already Playwright-checked); on-device paint remains the standing gate.
