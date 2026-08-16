## 2026-07-29 — Q-24 §4: the analysis outputs the phone pushes back were unbounded

**Branch:** `fix/q24-oura-summary-bounds` · Q-24 §4 · only §7 now remains

### Why these fields, specifically

`oura_daily_summary` and `oura_daily_derived` accepted any finite number for every field. They are
not raw readings — they are *analysis outputs*, and the summary carries the six rolling EMA
baselines plus the shared `n_history` age counter, which are **carried forward night to night**.

That is what makes them worth bounding ahead of noisier surfaces: a poisoned push is not one bad
day. It sets the state that the next weeks of readiness and illness contributors are measured
against. And `n_history` gates baseline maturity, so an inflated value prematurely un-gates every
derived deviation — the Q-6 failure mode reached from the opposite direction.

### Bounds derived, not picked

- A baseline is **×8 fixed-point** of its metric, so its ceiling is the metric's ceiling × 8 —
  computed from the same constant, so widening a metric bound cannot silently leave the baseline
  bound behind.
- HR and HRV reuse `RESTING_HR_MIN`/`RESTING_HR_MAX`/`HRV_MS_MAX` from `lib/validation/body-metrics.ts`
  rather than restating them.
- `devX8` is floored at 0 — a spread cannot be negative.

### What is deliberately NOT bounded

On the derived side only definitional ranges are enforced: a score is 0-100 because the scale says
so, minutes cannot exceed 1440, hours cannot exceed 24.

`vascularAge`, `pwv`, the resilience family and `bdiDerived` are left **unbounded on purpose**.
Their plausible ranges are not settled anywhere in the codebase, and inventing a ceiling risks
rejecting a legitimate value — which for an analysis output is worse than accepting an odd one. The
schema says so inline, so the next reader knows it is a decision rather than an oversight. Bound
them when their producers pin a range.

Both schemas `.passthrough()`: the branches read the raw payload, so a strict schema would silently
drop fields.

### Verification

Full suite **2,648 passing** (the 20 are the pre-existing `claude_readonly` connection tests),
`tsc`, lint and `check-push-mutations` clean. Thirteen tests covering: an ordinary night accepted, a
genuinely *bad* night still accepted (bounds reject the impossible, not the unusual), poisoned
baselines rejected, negative `devX8` rejected, `nHistory` negative/absurd/fractional rejected,
scores outside 0-100 rejected, and the open-ended metrics explicitly still passing.

### Not exercised

No mutation pushed through a real outbox — the schemas are unit-tested and each branch is a straight
`safeParse` guard, but the offline path itself needs the APK.
