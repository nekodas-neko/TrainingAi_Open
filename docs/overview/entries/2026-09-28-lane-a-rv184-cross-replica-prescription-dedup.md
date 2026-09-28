# 2026-09-28 — RV-184: one generation per workout open, across replicas

Opening a workout fires two plain prescription generations: `workout-data`'s server-side one and
the client's POST. The 30 s dedup that should collapse them is per process. Production's
2026-09-15 pair shows it failing: identical input (3,089 tokens each), with the second starting
5.4 s after the first had finished. One process would have answered that from its cooldown, so the
two ran on different replicas.

`generatePrescriptionForSession` now reads the stored row, which every replica sees. A plain call
(no preset, no completion exclusion, status pending or auto-applied, standard length) returns a
plan generated under 30 s ago instead of calling the model. Everything else falls through as
before. `rv184-just-generated-guard.test.ts` uses a repository double that throws if generation is
reached: 7 cases, 7 of 7 mutants killed, control green. The 200 neighbouring test files are green.

**Correction to the entry's morning re-verification.** It said completion no longer generates a
prescription. The server doesn't, but the client fires `/prescribe` 2–4 s after each completion,
and production shows it every time. That call sends no `excludeSessionId`, so the plan for the
next session is built as if the lifter had trained 0 hours ago. That trips the emergency deload's
`<36 h` arm whenever three muscles were logged sore. Filed as **LA-177** for Lane B (a one-line
body on a `components/` call).

RV-184 is closed. Its last line, a fingerprint that could name its trigger, was an "if ever
wanted" and would need a schema column; it is not carried forward.
