## 2026-08-18 — Verifying the two recalibrations in production: neither has landed yet (Tuning)

Docs-only. Follows the Sleep (v1.319.0) and Readiness (v1.321.0) recalibrations. Written because
"shipped" and "in effect" are not the same thing, and this session had already claimed the first.

**Production runs 1.321.1**, so the code is deployed. But measured against `claude_ro`:

- **0 of 96 `oura_daily_derived` rows carry a `readiness` model version**, despite the stamp shipping
  in v1.321.0. The 70 rows that carry any `model_versions` carry only `{"bodyComp": "atlas_2_1_0"}`.
- **Every stored sleep and readiness score is still pre-recalibration.** 2026-08-17 stores **78** for
  a 7.58 h / 90 % / 0.75 h-deep night — an old-model value; the new curves put that night far lower.
- Every derived row was **created before the deploy**.

**Why, and the trap in it.** A bulk job at **03:55:01** bumped `updated_at` on essentially every row
**without rewriting a single score** — the upsert is `COALESCE(excluded, existing)`, so a patch that
carries no score leaves the old one and only moves the timestamp. So **`updated_at` is not evidence
of which model wrote a row.** Auditing "did the recalibration land?" by timestamp gives the wrong
answer, which is precisely why the `model_version` stamp matters more than it looks. Added to Q-501
as its second live demonstration, and the more damaging one.

**When it will land.** Stored scores are rewritten only when the readiness route recomputes, which
happens on app open. Placeholder rows already exist through **2026-08-22** with null scores, so the
first row carrying new-model values *and* the `v3:ri5:2026-08-18` stamp will be the next day actually
scored. **That is where the trend step falls** — and unlike sleep, readiness will have a marker on it.

**No code changed.** Also fixed the Tuning baton, which had shipped self-contradictory: it still
called Activity "blocked on the owner" after the decisions were resolved, and carried two items
numbered 2.

**Not exercised.** Nothing on-device. The production API could not be called as the owner (no
session), so "the deployed bundle contains the new constant" rests on the reported version being
≥ 1.321.0 rather than on a scored response. Re-check after the owner next opens the app.
