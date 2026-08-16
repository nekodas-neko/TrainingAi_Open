## 2026-07-21 — Oura decoupling strategy + on-device/own-analysis handover (planning, docs-only)

Brainstorm/planning session, no code changes. Produced two planning docs under
`docs/superpowers/plans/`:

- **`2026-07-21-oura-decoupling-and-own-models-strategy.md`** — the strategy for owning ring-data
  interpretation instead of depending on Oura's cloud/models. Records the decode/interpret/reference
  three-layer split; the "Oura models as a temporary offline oracle, deprecate ~2–3 months" plan
  (reference *observes, never feeds*, so removal is a one-line deletion); the model-ourselves-vs-
  keep-from-Oura table (keep SleepNet for the hypnogram and `step_counter` for daily steps, own
  everything else, drop PPG-based vascular/body-comp and ring activity-type auto-tag); the generic
  comparison-harness design (tolerance tripwire, not sameness; wire a chest strap to escape circular
  validation); the steps over-count diagnosis (flat 30-steps/window heuristic in
  `lib/health/step-estimate.ts`, calibrated on a handful of walks) and its fix (wire
  `steps_motion_decoder` → `step_counter`, backfill via redecode); and the live-only GPS design
  (phone Activity-Recognition trigger, no backfill — ring data backfills, phone GPS never does).
- **`2026-07-21-ondevice-plus-own-analysis-handover.md`** — cross-session handover unifying the
  on-device-first/DB-culling thread with the own-analysis thread around one question: *what data do
  we actually need to keep vs. calculate?* Defines the gating first work item — the **keep/cull/
  calculate matrix** (raw tag → consuming computation/kept-model → retention verdict) — and carries
  a ready-to-use agent prompt for it.

**Verification:** none required — documentation only, no runtime/behaviour change. Not device-verified
(nothing to verify). No version bump (no user-visible change).

**Not exercised:** N/A — no code paths touched.

**Next:** run the keep/cull/calculate matrix (agent prompt in the handover doc), then culling Levers
1–2, then the steps `step_counter` wiring.
