# 2026-08-08 — Closing the cross-user phase-set leak

**Domain:** workouts / platform — v1.270.6, JS-only (no APK rebuild) · **Security**

## The chain

Q-129, from the 2026-08-07 full-app review (§3.4). `programs.phase_set_id` is a client-writable FK
into a strictly user-scoped table (`phase_sets.user_id` is `NOT NULL`, and `listPhaseSets` is
user-scoped — there is no shared or global set that would make a foreign id legitimate). Three links
trusted it:

1. **`POST /api/workout-templates`** wrote `body.program.phaseSetId` straight into
   `programs.phase_set_id` (`saveProgram`, and `updateProgramPhaseSettings` below it) with **no
   ownership check** — so a caller could mount someone else's phase structure onto their own
   program.
2. **`listProgramPhases(programId)`** then resolved that FK and read `program_phases` with **no user
   scope**, so the other user's phase names, types, durations and cycle structure rendered in
   `workout-data`, `program-week`, `readiness-score`, `weights-summary` and `daily-digest`.
3. **`deletePhaseSet`'s in-use probe** was also unscoped, and its thrown message reaches the client
   verbatim (`phase-sets/[id]/route.ts:61-63`) — disclosing another user's **program name** and
   blocking a delete of the caller's own set.

Exploiting it needs another user's UUID, which is why it was not top-of-queue — but production now
holds several real accounts, so it stopped being hypothetical.

## The fix

- **`listProgramPhases(userId, programId)`** — takes the caller and scopes the program lookup to
  them, the same shape `removeSessionExercise` already uses. Signature change rippled through the
  repository interface, the adapter, the internal `getActiveProgramWithPhases` caller and six
  routes; all already had `userId` in scope, all mechanical, all caught by `tsc`.
- **`deletePhaseSet`** — the in-use probe gains `eq(s.programs.userId, userId)`.
- **`POST /api/workout-templates`** — validates `phaseSetId` against `listPhaseSets(userId)` and
  400s otherwise, copying the pattern `phase-sets/[id]/route.ts:20-37` already uses for style ids.
  Placed before `saveProgram`, so the rejection happens before any write, and it covers the
  `updateProgramPhaseSettings` call below it too (same value, same request).
- **`saveProgram`** — explicit rowcount guard after its user-scoped UPDATE. It already failed
  closed, but by accident: `pRow` is `undefined` on a 0-row match and `pRow.id` throws inside the
  transaction. Now it throws `Program not found` on purpose.

## Verification

`tsc --noEmit` clean · `eslint` unchanged from baseline · `check-push-mutations.js` OK · full suite
407 files / 3223 tests, one failure (`scale-ble-multi-reading.test.ts`) that **also fails on a
stashed clean tree** — needs a second user row the local seed lacks. Pre-existing, unrelated.

**New DB-backed test** (`phase-set-ownership.test.ts`) builds two real users: B owns a phase set
with a phase and a program using it. It asserts (1) `listProgramPhases` returns B's phase for B and
`[]` for A, (2) `POST /api/workout-templates` as A with B's `phaseSetId` returns 400
`Invalid phaseSetId` **and writes no program row carrying that id**, (3) `deletePhaseSet` of A's own
set succeeds even while B's program references it.

**Confirmed all three fail against the pre-fix code** (stashed the four source files and re-ran:
3 failed / 3), so they test the fix rather than the harness. Skips cleanly without `DATABASE_URL`,
so CI's Tests job is unaffected.

**Not exercised:** no live cross-user reproduction against production data — the leak needs two real
accounts and the local seed has one, so the second user is synthesized by the test rather than
observed in the wild. No on-device verification — server-side authorization only, no
native/safe-area/gesture surface.
