# 2026-09-29 — LB-180: `/api/user/profile` is a pure read of the users row

**Lane A · `app/api/user/profile/route.ts`.**

- **Removed:** `workoutCount` from the GET, and the `countWorkoutSessions` query that computed it on
  every profile read. A repo-wide search found no reader in `app/`, `components/`, `lib/`,
  `packages/` or `e2e/`; the only mention is a comment in `app/more/more-content.tsx` explaining why
  RV-183 waited on this.
- **Why it mattered:** the count was a derivation, so every workout completion was a writer of
  `more-user-profile`, and no completion group clears that key. It was the one thing keeping the key
  off `freshWithinTtl`. **RV-183's `Needs: LB-180` now clears**, and Lane B can add the flag with its
  proof.
- **Kept:** `repo.countWorkoutSessions`. It has its own soft-delete test, and removing an unused
  repository method was not this entry's job.
- **Verified:** a route test that the body has no `workoutCount` and the count is never queried;
  `pnpm dev` GET → 200 with keys `user,hasPassword` and no hash.
