# Handoff — 2026-08-20 · workout energy accuracy: the intake pass

_Domain: `workouts` (also touches `nutrition`, `platform`) · Branch: `docs/session-wrap-workout-energy-intake` · PR: see below_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/workouts/README.md`](domains/workouts/README.md), then
> [`docs/implementation-backlog.md`](implementation-backlog.md) — the queue is the authority on what
> is outstanding. This file covers only what *this* session did and what it leaves behind; three of its
> six entries were built by Lane A within hours of being filed, so read it as reasoning, not status.

## Goal

The owner asked, in their own words, *"how can we make energy usage/burned from excercuse more
accurate. what type of data can we feed to calibrate it over time"*. This was an **intake** session —
the job was to turn that question, plus two screenshot reports either side of it, into backlog
entries good enough to implement from. **No product code was written and none should have been.**

## Current status

- **Build/test:** `pnpm check:rules` — **50 of 50** Custom Rules steps, run before every push. `pnpm
  dev` was **not** run and no route was driven: every PR this session was docs-only.
- **Device-verified:** not applicable — nothing shipped that a device could exercise.
- **All five intake PRs merged.** Nothing left open, nothing mid-triage, nothing received-but-unfiled.
- **The queue moved underneath this doc while it was being written** — Q-391, Q-419 and Q-421 shipped,
  the agent ID scheme changed from bands to `BF-` prefixes, and the doc-size baselines moved into
  `docs/doc-size-baseline.json`. All three are reflected below; anything that still reads as stale is a
  miss, not a deliberate record.

## What shipped

Six backlog entries, five merged PRs — plus Q-424 in this one:

| entry | filed in | state at 2026-08-20 |
|---|---|---|
| **Q-391** — per-session calories on the day screen's Training card | #247 (promotion) | ✅ **shipped** — Lane A, #260 |
| **Q-419** — the day budget ignores the RPE the done screen reads | #249 | ✅ **shipped** — #252 |
| **Q-421** — HR-based workout energy, closed-form only | #250, amended #253 | ✅ **route (a) shipped** — #255 |
| ~~**Q-423**~~ — the per-set RPE prefill is measurably low | #253 | **REFUTED 2026-08-20**, removed from the queue — see below |
| **Q-420** — derive session RPE from the set ratings | #250, amended #253 | queued — **re-measured, #256** |
| **Q-422** — calibrate against the owner's own energy balance | #250 | queued, Tuning → A |
| **Q-424** — a shrink-only ratchet can leave `main` red | this PR | queued |

Q-391 already existed (filed 2026-08-18) and was **promoted rather than re-filed** when the owner
asked a second time — see "Key decisions".

**Three of the six shipped within hours**, while this session was still filing the rest. If you are
reading this to pick up work, the queue — not this table — is the authority; treat everything below as
the reasoning behind the entries rather than a statement of what is outstanding.

## The findings worth not re-deriving

- **`computeActiveEnergy` already calls the estimator once per strength session and throws the split
  away.** `packages/shared/src/health/daily-energy.ts:107-109` loops `input.strengthSessions`, calls
  `est(8, s.durationMin)` for each, sums into one `workoutKcal`. Q-391's whole server-side change is
  returning that breakdown — which also satisfies its consistency requirement by construction.
- **Two live paths disagree about the same workout.** The done screen's
  `GET /api/workout-sessions/[id]/energy` uses `intensityFromRpe(rpe)`; the day ENERGY row, Nutrition
  earned-kcal and the Home budget use a hardcoded `'moderate'`. `done-screen.tsx:130-152` re-fetches
  on every RPE tap, so the owner watches a number change that then fails to apply anywhere. That is
  Q-419.
- **Per-set RPE is prefilled from the planned percentage**, `clamp(floor(pct / 10), 6, 10)`
  (`components/workout/utils.ts:81-84`), from four sites in `components/workout-screen.tsx`
  (856/898/936/1084). So the 625 rated sets are **not 625 judgements** and the 6 floor is a clamp,
  not an opinion. This was discovered *after* Q-420 was written and forced it to be amended.
- **The ONNX energy model is vendored, downloaded at runtime, unit-tested, and has zero production
  callers** — `lib/oura-models/inference/energy.ts`, two heads listed in `model-files.json:9-10`. The
  MET formula standing in for it is documented as Oura's *fallback* path. The gap is feature
  assembly, which the module header names and nobody wrote.
- **HR reserve already exists and is already trusted.** `daily_zone_minutes` carries the profile it
  was computed under (maxHr 187 / restingHr 53 over 62 days); `computeHrZones` and
  `packages/shared/src/health/hr-profile.ts` feed Readiness and Activity. The calorie estimator is
  the only consumer ignoring it. **`running_baselines` is empty in production — do not source
  max/resting HR from there.**

## Production measurements (owner's rows only)

Taken via `POST /api/admin/db-query` over the `claude_ro` views. **Every figure below is row-scoped to
one user and the underlying tables prune at 30 days** — these are "the owner's, recently", never
"the system's". Written that way in the entries too.

| measurement | value |
|---|---|
| completed sessions with a session RPE | **20 of 78** (25.6%) |
| sets with an RPE | **625 of 1,047** (59.7%) |
| sessions with rated sets but **no** session RPE | **24** — deriving takes coverage 20 → 44 |
| sets left at the prefilled value | 360 (57.6%) |
| sets **raised** by hand | **233** |
| sets **lowered** by hand | **32** |
| mean set RPE — changed / unchanged / all | 7.97 / 7.11 / **7.48** (shift **+0.41**) |
| `workout_hr_stats` rows with `avg_bpm` | 42 of 77 |
| `set_hr_stats` / `daily_zone_minutes` | 709 rows / 78 days |

Paired sessions (both a session RPE and rated sets), n = 20:

| owner's session RPE | n | mean set RPE | max set RPE |
|---|---|---|---|
| 7 | 3 | 7.15 | 7.67 |
| 8 | 15 | 7.41 | 8.53 |
| 9 | 2 | 8.25 | 10.00 |

## Key decisions (with rationale)

- **Q-391 was promoted, not re-filed.** The owner's second report described an existing entry
  exactly. Filing a duplicate is the failure this repo has already had (Q-397); promoting it to
  position 1 and appending a reaffirmation note preserved the original tracing and recorded what the
  second ask settled.
- **The owner's own session RPEs are NOT the calibration target for Q-420.** They said they cannot
  judge session RPE well, and the data agrees — across 20 sessions they used only 7, 8 and 9. Range
  compression is what an unjudgeable scale looks like from outside. Fitting a derivation to it would
  be calibrating against noise. Those sessions are a plausibility check.
- **Q-420 derives the plain rounded mean of a session's rated sets, kept in set-RPE units.** A
  weighting that counts hand-changed sets higher is *available without a schema change* — recomputing
  `defaultRpeFromPct(planned_pct)` at read time recovers which sets were touched — and was rejected:
  ~0.2 of a point, at the cost of the one-sentence explanation.
- **No mapping from the 6–10 set scale onto the 1–10 session scale.** Inventing it would be inventing
  precision. `'easy'` being unreachable for strength is the correct outcome, not a bug to engineer
  around.
  > **⚠️ SUPERSEDED the same day, and the correction is the better answer — do not act on the bullet
  > above.** It was reasoned from the only consumer that had been checked, the energy tier. Lane A's
  > re-measure (#256) found Q-421 shipping had gutted that case — HR now takes precedence, so the tier
  > decides the burn on **3** sessions, not 24 — and that the real consumer is
  > `app/api/health-trends/route.ts:172`, which computes Foster's `sessionLoad = sessionRpe ×
  > durationMin` on the **CR-10** scale. A value floored at 6 fed into that **systematically inflates
  > session load**, and the ACWR thresholds downstream are calibrated on the unscaled figure. **There
  > the mapping is not optional; it is the whole item.** The reusable lesson: a decision about a number
  > is only as good as the enumeration of who reads it — grep every consumer before ruling one out.
- **Q-421 keeps the closed-form HR estimator and drops the ONNX route** — owner: *"I dont want to use
  oura models."* Recorded in the entry as rejected so it is not re-proposed. **The decision does not
  extend to `estWorkoutKcal`**, which is a ported formula (MET lookup + Schofield arithmetic, no
  inference, nothing loaded) rather than a model. Ask before widening it.
- **Q-424's fix must not be `push: [main]`.** The workflow comment's cost figure (~11 billed minutes
  per merge) is right and that trade should stand. The defect is that the check is order-dependent.

## Deliberately NOT done

- **No product code.** This role files; the Implementation lanes build. Every PR was docs-only.
- **No migration numbers claimed**, though Q-420 needs one (provenance for a derived-vs-entered
  session RPE). Left for Lane A, per the role contract.
- **The kcal magnitude of Q-419's defect was not quantified.** The real MET table is runtime-only and
  absent from the sandbox; the committed fixture is deliberately scrubbed (strength reads
  `met_moderate: 0.6`, which is Q-312). The entry gives the exact *form* —
  `(met_hard − 1.5) / (met_moderate − 1.5)` — and instructs measuring against the runtime table
  before quoting a number anywhere user-facing.
- **Tiers 2 and 3 were not filed until the owner chose.** They were offered, held, and written only
  after the answer came back.

## Gotchas / what did NOT work

- **`main` was red on Custom Rules before this session touched anything** — 31 lines over its own
  `check-doc-index-size` baseline, from #245 and #246 merging in parallel. It surfaced as an
  unrelated failure on a fresh branch. Filed as **Q-424**; the instance is fixed, the class is not.
- **The baseline collided four times in one session** (#247, #249, #250, plus the pre-existing
  breakage). Working resolution, in this exact order: `git merge origin/main` →
  `git checkout --theirs scripts/check-doc-index-size.js` (keeps main's whole file, preserving checks
  other lanes added) → `node scripts/check-doc-index-size.js` → set the baseline to **exactly** the
  count it prints → re-run `pnpm check:rules`.
  **Note the baselines moved to `docs/doc-size-baseline.json` on 2026-08-19 (#254)**, which removes the
  conflict-frequency half of this — the script had reached 1,091 lines with 955 of them prose. The
  order-dependence it does not remove is Q-424.
- **`wc -l` reports one lower than the check does.** A baseline set from `wc -l` leaves the branch
  red. Cost one resolution before it was noticed.
- **Never edit the baseline by line number.** A `sed -i "902s/…"` targeted the wrong line earlier in
  the session because the baseline had moved to 907. No damage — the pattern did not match — but the
  habit since has been a Python replace on the exact string, and it has not misfired.
- **`get_check_runs` returning `total_count: 0` has two causes, not one.** A stale base *and* checks
  queuing on a fresh push. `git log --oneline HEAD..origin/main` distinguishes them in one command;
  guessing wastes a check-in cycle.
- **A `send_later` check-in can fire after the work is already done.** #247 was merged manually and
  its trigger deleted, and the tick arrived anyway. Verify state before acting on a stale prompt.
- **A stacked PR conflicts after its parent squash-merges.** #250 sat on #249's head; the squash
  rewrote history so both sides looked changed. The backlog hunk was an *added-on-one-side* conflict
  with an empty side from `main` — check that before choosing `--ours`, then verify with
  `grep -c "^### .*Q-NNN —"` that each entry appears exactly once and `git diff --stat origin/main`
  shows insertions only.

## Files to look at

- `packages/shared/src/health/daily-energy.ts:97-132` — `computeActiveEnergy`. Q-391, Q-419 and Q-420
  all land here; one lane visit should take all three.
- `packages/shared/src/health/workout-energy.ts` — `estWorkoutKcal` (`:106-114`), `intensityFromRpe`
  (`:86-91`), and the header explaining that this is Oura's fallback path.
- `components/workout/utils.ts:81-84` — `defaultRpeFromPct`, the prefill Q-423 is about.
- `components/workout/done-screen.tsx:130-152` — the RPE-keyed energy re-fetch that makes Q-419
  visible to the owner.
- `packages/shared/src/nutrition/adaptive-tdee.ts` — the existing calibration Q-422 extends, with its
  gates and the Q-387 partial-day rationale.
- `lib/oura-models/inference/energy.ts` — the model with no callers.

## Open questions / blockers

- **Nothing is blocked on the owner.** Both decisions they were holding (Q-420's derivation, Q-421's
  route) were answered and are recorded in the entries.
- **Q-420 still needs a migration number** for session-RPE provenance — Lane A's to claim.
- ~~**Q-423's exact mapping is unchosen on purpose.**~~ **REFUTED 2026-08-20 — Q-423 is removed from
  the queue and there is no mapping to choose.** It was bracketed against the ratings as this bullet
  asked, and two things came back. The 625-set table was computed over sets of which **312 have no
  `planned_pct` at all** — the column only exists since July 2026 — and were filled from
  `intensity_pct`, the *achieved* intensity, not the planned percentage the prefill reads. On the 313
  that do carry one the split is **288 unchanged / 25 raised / 0 lowered**, +0.125, and
  `floor(pct/10)` is the modal rating at **all sixteen** observed percentages, 313 of 313 sets;
  `round` misses five and turns 25 under-prefills into **82 over-prefills**. The `round(8.5) = 9`
  worry above is moot for a third reason: **no set in the data has a planned percentage above 84**.
  Full working: [`docs/reviews/2026-08-20-rpe-prefill-mapping-fit.md`](reviews/2026-08-20-rpe-prefill-mapping-fit.md).
- **Every remaining entry in this cluster re-scores history**, including the `adaptive-tdee`
  maintenance window, which reads the same active-energy figures. Each carries a "size the blast
  radius first" requirement. Q-423 was the one exception and it is gone, so **there is no longer a
  no-blast-radius starting point in this cluster**.

## Pickup prompt

```
You are the BugFix Intake Agent 🪲 for the TrainingAI repo (nekodas-neko/TrainingAi_Open).
Keep that session title exactly, emoji included — it is how five concurrent sessions stay
tellable apart.

Read, in this order:
  1. projectOverview.md — status and the live Known Issues tables
  2. docs/agents/README.md and docs/agents/state/bugfix.md — your role contract and the baton
     your predecessor left
  3. docs/domains/workouts/README.md — the pillar most of the current queue sits in
  4. docs/handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md — this file
  5. docs/implementation-backlog.md — the first six entries are one connected cluster and are
     ordered by dependency, not by when they were filed

Your role: turn owner reports into backlog entries good enough to implement from, land them in
docs-only PRs, merge on green, wait for the next. You do NOT fix code — the Implementation
lanes do.

Constraints that would otherwise be re-discovered:
  - Entry IDs are `BF-<n>` now, not a reserved band — the scheme changed on 2026-08-19 (#254),
    mid-session. Find your next number with
    `grep -rhoE '\bBF-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`. Legacy Q- numbers stay
    valid; this role's last band entry was Q-424.
  - Never claim a migration number. Hand any entry needing schema work to Lane A.
  - pnpm check:rules is the only custom-rules gate. It is 50 of 50 right now; quote the count
    the runner prints, never a remembered number.
  - Every intake PR trips check-doc-index-size, because intake adds an entry per report. Raise
    the baseline in the same PR — it lives in docs/doc-size-baseline.json now, with the
    reasoning in docs/doc-size-baseline-history.md. Take the number from
    `node scripts/check-doc-index-size.js`, NOT from `wc -l`, which reads one lower.
  - Expect the baseline to conflict; it did four times on 2026-08-19. Resolve with
    `git merge origin/main`, then `git checkout --theirs scripts/check-doc-index-size.js`, then
    re-measure and re-run the gate.
  - POST /api/admin/db-query over the claude_ro views is row-scoped to one user and prunes at
    30 days. Write every finding as "the owner's, recently" — never "the system's".
  - Escalate loudly, don't just file, if a report reveals something destructive already
    happening in production.

First action: there is no outstanding report. Do the session-start reads above, then read
error_events and the database size per CLAUDE.md's standing instructions, and file anything new
the same session. Then wait for the owner. If they raise the workout-energy work again, the
cluster is already three-sixths built (Q-391, Q-419 and Q-421 shipped on 2026-08-19); what is
left — ~~Q-423~~ (refuted 2026-08-20), Q-420, Q-422 — is fully specified and needs an Implementation lane, not more
intake. Read Q-420's re-measure banner before repeating anything this handoff says about it.
```
