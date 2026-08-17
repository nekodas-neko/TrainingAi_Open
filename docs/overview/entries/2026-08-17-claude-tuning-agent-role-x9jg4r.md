## 2026-08-17 — Readiness calibration: the Recovery Index anchor, measured (Tuning agent, first session)

**Docs-only.** No code changed, no version bump — the scoring change this proposes is deliberately
not in this diff.

First session in the standing **Tuning** role, so it also creates the role's baton at
`docs/agents/state/tuning.md`. There was no `docs/agents/` directory and no prior baton.

**What it did.** No owner report was in hand, so the target was the standing calibration question
**Q-271** had left open — *"the Recovery Index contributor can never score above ~50; it only ever
subtracts"* — which the 2026-08-15 comprehensive review filed explicitly as calibration work.

**The main result is that Q-271 is substantially wrong.** Re-measured over the full 41-day production
series instead of the eight days that review actually sampled:

- The contributor exceeds 50 on **12 of 41** days and records **exactly 100 on 2026-07-17** in the
  persisted contributor. "Never above 50, on any day, ever" is an 8-day artefact — the eight values it
  quoted (13, 18, 20, 21, 22, 28, 43, 48) are exactly 2026-08-08 → 08-15, the worst stretch on record.
- Its cost against a neutral 50 is **0.71** readiness points/day, not 2.2.
- The shipped argmin estimator is **sound**: r = **+0.712** against Oura's own `recovery_index`
  contributor, beating every stabilisation-style alternative tested (best alternative +0.636). The
  hypothesis that the estimator measured the wrong instant was tested and failed.

**What is real, and is proposed as Q-500 (⛔ owner sign-off):** the 6-hour anchor is about an hour too
high. Fitted against Oura's own contributor over the 15 nights where both exist, the zero-bias anchor
is **4.63 h** (leave-one-out 4.40–5.14; RMSE flat 4.5–5.25). Proposal is
`RECOVERY_INDEX_OPTIMAL_HOURS` 6 → 5, which moves **40 of 41 days**, mean **+0.67** readiness points,
max **+1.44**, and lowers none.

**The calibration window is the reusable find.** Oura Cloud data stops at the 2026-07-07 re-key and
`oura_heartrate` starts 06-22, so 2026-06-23 → 07-07 carries Oura's own score contributors alongside
our raw inputs — the only external ground truth these scores have. It had not been used before.

**Also filed — Q-501.** `oura_daily_summary` rows get recomputed; the `oura_daily_derived` readiness
rows built from them do not follow, so **5 of 33** persisted `recoveryIndex` sub-scores disagree with
the hours they derive from. With `model_versions->>'readiness'` NULL on all 33 rows, a past readiness
score cannot be attributed to inputs or to the model. Same class as Q-273.

**Verification.** The counterfactuals rest on a Python port of
`packages/shared/src/health/recovery-index.ts`, validated against the 41 stored
`recovery_index_hours` values first: median absolute error **0.08 h** (5 minutes), 32/41 within 0.5 h.
The nine outliers are the Q-274 fragment nights and are excluded from every fit by a ≥30-sample floor.

**Not exercised.** Nothing on-device — this is a data analysis over production rows; no APK, native
path, safe-area or WebView surface was touched, and no code changed. Every number is **the owner's**
(`claude_ro` is row-scoped), over the windows named in the review. The 15-night fit is small, spans
the re-key boundary, and uses a different HR source (Cloud, ~2× less noisy) from the data the change
would apply to — §5.1 of the review states what that does and does not permit.

**Docs touched:** new `docs/reviews/2026-08-17-readiness-calibration.md`; new
`docs/agents/state/tuning.md`; `docs/implementation-backlog.md` (Q-271 replaced by Q-500 + Q-501, four
live cross-references re-pointed); `projectOverview.md` (Recovery Index Known-Issues row rewritten, new
Q-501 row, one stale citation corrected); `docs/domains/readiness/README.md`.
