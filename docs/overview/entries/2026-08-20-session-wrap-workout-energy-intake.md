# 2026-08-20 — workout energy accuracy: an intake pass, and a red `main`

_Branch: `docs/session-wrap-workout-energy-intake` · BugFix Intake Agent 🪲 · docs-only throughout_

Six backlog entries across five merged PRs (#247, #249, #250, #253, and this one), from one owner
question — *"how can we make energy usage/burned from excercuse more accurate. what type of data can
we feed to calibrate it over time"* — plus two screenshot reports either side of it. No product code:
this role files, the Implementation lanes build.

The full narrative, every production measurement, and the gotchas are in
[`docs/handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md`](../../handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md).
What follows is the short record.

## The cluster, in dependency order

**Q-391** (promoted to the top, not re-filed) · **Q-419** · **Q-423** · **Q-420** · **Q-421** ·
**Q-422**. Queue position is priority, and these are ordered by what depends on what rather than by
when they were filed — Q-423 is fourth by age and third by position because Q-420 averages the pool it
is about.

## Three things found by reading rather than assuming

- **`computeActiveEnergy` already computes the per-session figure and throws it away.**
  `daily-energy.ts:107-109` calls the estimator once per strength session, sums into one
  `workoutKcal`, discards the split. Q-391's server-side change is returning the breakdown — which
  also makes its consistency requirement hold by construction instead of by a second calculation.
- **The done screen re-estimates on every RPE tap; nothing else reads the rating.** The day ENERGY
  row, Nutrition's earned kcal and the Home budget all use a hardcoded `'moderate'`. So the tap
  visibly moves a number that then fails to apply. That is Q-419, and it breaks an invariant
  `energy-summary.ts`'s own header states.
- **The ONNX energy model is vendored, downloaded at runtime, unit-tested, and has zero production
  callers.** Its only caller anywhere is its own test file. The MET formula standing in for it is
  documented as Oura's *fallback* path. The owner has since ruled the model out, so Q-421 keeps the
  closed-form HR estimator — which needs no model, no runtime and no new dependency.

## An aside that invalidated an entry already written

The owner mentioned in passing that set RPE *"auto prefills anyways"*. Checking it against the code
found `defaultRpeFromPct(pct) = clamp(floor(pct / 10), 6, 10)`, filling every set from the planned
percentage before the owner sees it. Two assumptions in Q-420 fell over: the 625 rated sets are **not**
625 judgements, and the 6 floor is a clamp rather than an opinion.

Measured against each set's own `planned_pct` (the owner's rows): **233 raised by hand against 32
lowered**, mean 7.97 where changed versus 7.11 where not, a **+0.41** shift overall. The prefill is
low, and it is the pool every derived effort number will average — filed as **Q-423** and placed above
Q-420 for that reason.

The lesson is the general one: an owner's incidental remark can carry more than the report it came
attached to.

## `main` was red, and nothing was looking

A branch cut from pristine `origin/main` failed `pnpm check:rules` on a change that could not have
caused it. `docs/implementation-backlog.md` stood **31 lines over its own baseline** at `39e948b`:
**#246** tightened the baseline to a zero-slack value while **#245** was already open against the
looser one. Each was genuinely green when its own CI ran; their sum was not.

CI has no `push: [main]` trigger — deliberately, and the workflow comment gives the reasoning: *"`main`
is protected and only reached through an already-green PR, so re-running is pure redundancy."*
**That premise does not hold for an order-dependent check.** Filed as **Q-424**, with the explicit
caveat that the fix must *not* be adding `push: [main]` (~11 billed minutes per merge, and the trade
was made deliberately) — the defect is that the ratchet is order-dependent at all, and the same
argument applies to every shrink-only baseline in Custom Rules.

The instance is fixed. The class is not.

## Cost, recorded so it is not paid again

Four separate baseline resolutions in one session. The working procedure — merge `main`, take its
whole copy of the check script with `--theirs`, re-measure from the script rather than `wc -l`, set
exactly, re-run the gate — is in the handoff and in the role's baton.
