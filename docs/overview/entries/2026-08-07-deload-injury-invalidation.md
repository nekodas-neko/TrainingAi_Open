# 2026-08-07 — Early deload and injury writes now invalidate the plan they change

**Domain:** workouts — v1.267.19, JS-only (no APK rebuild)

## The report

Q-117, found by the 2026-08-07 full-app review (§2.2, §2.3): two separate writes change what the
workout screen should prescribe, and neither invalidated the cache that holds it. Because
`workout-data:all` is read with `freshWithinTtl: true` at `TTL_LONG`
(`session-select-content.tsx`, `workout-select-content.tsx`), the stale entry isn't merely painted
first — no network request is made at all for up to 6 hours.

## Two failure sites, one shared shape

1. **Early deload.** `handleEarlyDeloadConfirm` only called `setReadiness`; the actual server
   effect (`programs.ts` → `phase-engine.ts` → `workout-data/route.ts`) is real, but
   `components/home/early-deload-card.tsx` imported no cache group. The owner taps "Take deload
   week now" and every card keeps showing full-intensity target weights.
2. **Injury.** `invalidateInjuryWrites()` cleared only the `injuries` cache itself — never the
   `workout-data`/`workout-card:`/`ai-periodization-session:` caches that actually reflect an
   injury's effect on the prescription.

## A second, server-side gap the client fix alone couldn't close

`workout-data/route.ts`'s consumption-day re-evaluation has its own skip check —
`reevaluationKey(todayStr, moodLog, morningCheckin)` — that decides whether to re-derive
per-exercise deloads or trust the cached prescription. It never included injuries at all, so even
a forced client refetch (after fixing the cache-group gap above) would still return the pre-injury
prescription, because the server itself thought nothing relevant had changed.

## The fix

- `session-select-content.tsx`: `handleEarlyDeloadConfirm` now calls
  `invalidatePrescriptionChanged().catch(() => {})` before the local state update.
- `cache-groups.ts`: `invalidateInjuryWrites()` extended to clear `workout-data`, `workout-card:`,
  and `ai-periodization-session:` alongside `injuries`, plus `clearLegacyHomeSeeds()` (the same
  B7 gotcha every other `workout-data`-prefix-dropping group already guards against).
- `reevaluate.ts`: `reevaluationKey()` gains a 4th parameter — an array of
  `{ resolvedDate, updatedAt }` — and folds in the max `updatedAt` over unresolved injuries.
  Filtering to unresolved *before* taking the max means resolving the injury with the latest
  timestamp still changes the key (the max shifts to the next-latest, or drops to `'none'`), not
  just adding/editing one. Exact same pattern Q-113 used for the Morning Check-in's illness flag —
  a 3rd/4th optional parameter rather than a redesign.
- `workout-data/route.ts`: `listInjuries(userId)` moved into the initial cheap-lookup batch
  (alongside the two mood reads and the morning check-in) so the fingerprint can be computed
  *before* the skip check, then reused inside the `if` block instead of being fetched a second
  time in the heavier batch. `listInjuries` is an indexed, single-user, small-table query — no
  heavier than the mood lookups it now sits beside.
- Updated the stale proof comment in both `session-select-content.tsx` and its Workout-tab sibling
  `workout-select-content.tsx` (identical comment, identical gap, both missed) — they asserted
  every write invalidating `workout-data:all` was already covered; `/api/confirm-early-deload` and
  injury writes were the counter-examples.

## A type gap the fingerprint needed

The backlog's fix direction specified "max `updatedAt` over unresolved injuries," but the shared
`Injury` type never exposed `updatedAt` — the DB row has always had it (`injuries.updated_at`,
bumped on every `createInjury`/`updateInjury`/`deleteInjury`), but `rowToInjury()` dropped it at
the repository boundary. Added it to the type and the single mapper function, then fixed every
call site `tsc` flagged as a result: `createInjury`/`updateInjury`'s input types now also *exclude*
`updatedAt` (server-stamped, not caller-settable — matching how `createdAt` was already excluded),
and 5 places constructing `Injury`-shaped objects by hand (`api/injuries/route.ts`,
`health-content.tsx`'s local-store→shared-type mapping, `injury-sheet.tsx`'s optimistic
`onSaved` callback, `workout-screen.tsx`'s local-store→shared-type mapping) picked up the field
from the already-available `LocalInjury.updatedAt` or `record.updatedAt` they had in scope. All
mechanical — `tsc` caught every site, none required new logic.

## Verification

`tsc --noEmit -p .` clean (only the pre-existing unrelated `voice-log-button.tsx` error). `eslint`
across all 12 touched files matches the pre-existing baseline exactly (verified via `git stash`
diff on the files that already had warnings). Full suite: 404 files / 3197 tests green (5 new).

Added a `describe` block to `self-reported-sick.test.ts` (the existing home of Q-113's
`reevaluationKey` tests) covering the injury fingerprint: changes on add, changes on edit
(`updatedAt` bump), changes when the only unresolved injury resolves, ignores already-resolved
injuries entirely, and stable when the unresolved set doesn't change. Also updated the one existing
assertion that hardcoded the old 3-segment key format (`'2026-08-07|none|none'` →
`'...|none|none|none'`).

**Live-verified the actual cache mechanics against `pnpm dev`**, not just the type-level plumbing:
1. Confirmed the harness itself observes `freshWithinTtl`'s skip behavior — visiting
   `/session-select` twice in a row fired one `/api/workout-data?tab=all` request on the first
   visit and **zero** on an immediate revisit (cache fresh, network fetch genuinely skipped).
2. Logged a real injury via the Health → Body tab UI (Chest, Mild — confirmed via the "Injury
   logged" toast and the muscle diagram highlighting red), then revisited `/session-select` and
   confirmed a genuine network request fired this time (**1**, not 0) — proving the invalidation
   actually closes the gap rather than merely making it less likely.

Test injury deleted from the local dev DB afterward so the seed is unchanged going forward.

**Not exercised:** the early-deload confirm path itself — forcing `earlyDeloadRecommended: true`
requires synthesizing a low-readiness/high-load state that wasn't already present in the seed, and
the fix there is a one-line addition of an already-proven-correct function call (the exact same
`invalidatePrescriptionChanged()` already used and verified at three other call sites in this
codebase), so it was verified by code review and the passing type/lint/test gates rather than a
live repro. No on-device S25 verification — pure cache-invalidation/server-logic fix, no
native/safe-area/gesture involvement.
