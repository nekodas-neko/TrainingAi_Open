# 2026-09-28 — LA-89: `/api/oura/hr-sync` deleted, with the evidence it was dead

Approved 2026-09-27 on condition the route was proved dead first. The evidence:

- **No caller in code.** In `app/`, `lib/`, `packages/`, `components/`, `android/`, `scripts/` and
  `public/`, the only references were tests and two comments in `complete-workout` recording that its
  POST back to this route was replaced by an in-process call (Q-122).
- **Nothing reaching it in production**, as far as can be seen: zero `error_events` rows name it
  since the table's oldest row (2026-08-30). That is owner-scoped and failures-only, so it is
  supporting evidence, not proof. The code search is the proof.
- **What it wrapped stays.** `syncAndAttributeSessionHr` is still called by `complete-workout` and the
  outbox's `complete_workout` branch.

Removed with it: its cases in `final-backfill-calibration-routes.test.ts` and
`rv55-56-route-input-500s.test.ts`. The module map and `docs/oura-ble-operations.md` §6 now list
five `app/api/oura/` routes.
