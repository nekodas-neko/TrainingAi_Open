# 2026-09-28 — RV-183: one of two More keys takes the TTL gate, and proving it found a live cache bug

**Lane B.** Branch `fix/more-seasons-ttl-gate-and-title-invalidation`. No version bump — nothing
user-visible changes today (see *Why no bump*).

## What shipped

- **`app/more/more-content.tsx`** — `more-seasons` now carries `freshWithinTtl: true`, with the written
  RV-67 proof at the call site. A More re-show inside the 30-minute TTL costs **one GET instead of two**.
- **`components/more/title-picker-sheet.tsx`** — equipping a title now calls `invalidateUserProfile()`.
  This is a live cache-group omission, found while proving the above.
- **`app/__tests__/rv183-more-seasons-ttl.test.ts`** — 5 cases, following the shape of the existing
  `rv67-nutrition-targets-ttl.test.ts` precedent.

## The proof for `more-seasons`

`RV-183` warned that the RV-67 purity check *"has disqualified every other candidate here"*, so the
expected outcome was a close. This one passes:

- **Purity.** `listSeasonsWithResults` (`lib/data/postgres/slices/social.ts:105`) is two plain selects —
  every `seasons` row, then this user's `season_results` — mapped straight to the payload. No `now()`,
  no derivation, nothing that decays with the clock. That is exactly what disqualified the others:
  `body-battery` drains with the clock, `readiness-score` is fed by server-side rollup writes, and
  `more-user-profile` carries a `countWorkoutSessions()` derivation.
- **Writers: none exist.** No insert, update or delete against either table anywhere in `lib/`, `app/`
  or `scripts/`, and `/api/seasons` is GET-only. So the "every writer's group holds the key" half of the
  proof is **vacuous rather than unproven** — a materially different thing, and the reason this
  qualifies where nothing else on the screen does.
- **A cleared entry still fetches.** `cachedFetchCore` short-circuits only when a cached value exists
  *and* is fresh (`lib/sqlite/cache.ts:373-386`), so a future group that starts clearing this key needs
  no change here.
- **Residual risk, stated rather than hidden:** a season result written server-side appears up to 30
  minutes late. `pullDelta` does not carry seasons either, so that delay is already the status quo for
  anything short of a cold start.

The guard fails on the **appearance of a writer** rather than waiting for the stale symptom — which is
the only useful shape when the proof rests on there being no writers to forget.

## The live bug this turned up

`handleEquip` PATCHes `/api/user/equipped-title`, which writes `users.equipped_title` — part of
`/api/user/profile`'s payload — then called `onEquip(titleId)` and nothing else. **It never cleared
`more-user-profile`.**

Today that is masked: `cachedFetch` always revalidates, so the next re-show corrects it. But
`/more/details` reads the same key through `useCachedValue`, so its seed was already serving the old
title until its own revalidate landed, and the moment any read path took `freshWithinTtl` this became
**30 minutes of a wrong title**. It is the exact class CLAUDE.md's cache-group rule exists for — a write
that affects a key, not registered in a group that clears it — and it was a real omission independent of
any optimisation.

## Why `more-user-profile` did NOT get the flag

Its payload is `{ user, hasPassword, workoutCount }`, and `workoutCount` is `countWorkoutSessions()` — a
derivation, so every workout completion is a writer of the key, and no group a completion calls clears
it (`invalidateWorkoutSummaries()` does not contain it; only `invalidateUserProfile()` and
`invalidateGoalRecommendations()` do).

**That field has zero consumers anywhere in the repo.** So the fix is to delete it, not to widen the
proof — filed as **`LB-180`, Lane: A** (the route is theirs). It sits at Lane A position 11, one row
below `next-item.js`'s default cut, which is deliberate: `LB-179` at 10 is the consequential one, and
LB-180 blocks only a one-GET optimisation. `RV-183` now carries `Needs: LB-180` and parks.

## Why no bump

Nothing observable changes. The seasons flag removes a request; the title fix prevents a staleness that
revalidation currently hides. Per the standing rule, no user-visible change means no version or
changelog entry.

## An existing tripwire fired, and satisfying it was the point

`lib/supplements/__tests__/rv183-local-first-reminders.test.ts` asserted that **neither** More fetch
passed `freshWithinTtl`, with the stated reason that *"CLAUDE.md wants a written invalidation proof
before that happens"*. The full suite caught it: 1 failed, 931 passed.

That is a tripwire doing its job on exactly the change it was watching for. The proof now exists, so the
condition was **satisfied rather than bypassed**, and the test narrows to the half still unproven —
`more-user-profile` must keep revalidating until `LB-180` lands — rather than being deleted. Bounded by
the next call, and that file's `code()` helper already strips comments, so the slice reads code and not
prose. Control-run: flagging `more-user-profile` fails it.

## Verified

- 5/5, **control-run five ways with each mutation asserted as applied**: removing the seasons flag,
  flagging `more-user-profile`, dropping the equip invalidation, making the payload clock-dependent, and
  adding an aggregate to it each fail exactly one case. Restored 5/5.
- **Two rounds of the guard were wrong before this held, both caught by controls, not by review.**
  First, a fixed 260-character window after the profile key did not reach its `opts` — four lines of
  RV-150 comment sit in between — so a control that flagged that very key passed. Bounding the slice by
  the *next call* fixed that and broke the baseline, because my own proof comment names
  `freshWithinTtl` several times and fell inside the region. The answer was `stripComments`, which the
  sibling `workout-completion-surface.test.ts` already uses for this reason.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

**Not exercised:** not run on the device, and **the seasons tables were not read in production** — the
proof is about who can write them, which is a source property, but it means I cannot say whether the
owner has any season rows at all. If the tables are empty the saved GET returns an empty array either
way, and the optimisation is still real but smaller than it sounds. The 30-minute staleness window was
not observed, only derived from `TTL_MEDIUM`. No offline-first, native, safe-area, gesture or
notification surface is touched.
