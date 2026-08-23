# 2026-08-23 — the contract half of Q-362a (LA-15)

**Branch:** `chore/day-log-drop-legacy-durations` · **Lane A** · **closes LA-15**

Q-362a keyed `/api/day-log`'s workout durations by `workout_sessions.id`, because a session **name**
is not an identity and two `Push` sessions on one day collapsed to a single key holding only the later
window. It shipped **additively**: the id-keyed record went in beside the colliding name-keyed one, so
the three Lane B surfaces reading the old field kept working while Q-362b moved them.

This is the contract step. The legacy record is gone.

## The precondition was verified, not assumed

`next-item.js` treats an absent `Needs:` target as shipped — the protocol removes a completed entry —
so LA-15 read as READY the moment Q-362b left the queue. **That is an inference, and the entry's own
warning was "do not do this before Q-362b merges", so it was worth one grep:**

| consumer | reads |
|---|---|
| `app/session-select/components/week-day-sheet.tsx` | `workoutDurationsById` ✓ |
| `components/health/day-overlay-sheet.tsx` | `workoutDurationsById` ✓ |
| `components/health/day-detail/day-sections.tsx` | `workoutDurationsById` ✓ |

Zero readers of the name-keyed record outside the route itself. The entry's acceptance criterion was
*"`grep -rn 'workoutDurations\b'` finds only `workoutDurationsById`"*, and it now does.

## The test asserts the absence

The case that used to pin *"still emits the legacy record, unchanged"* now pins *"no longer emits the
colliding name-keyed record"* — `expect(data.workoutDurations).toBeUndefined()`. Mutation-verified:
putting the field back turns it red.

Asserting the absence is the point. A field removed with nothing watching is a field a future merge
quietly reintroduces, and the whole reason this one existed was that two lanes could not land in
lockstep.

## Expand, migrate, contract — completed

| | |
|---|---|
| **expand** | #281 — `workoutDurationsById` added beside the legacy record |
| **migrate** | Q-362b (Lane B) — three surfaces moved to it |
| **contract** | this PR — legacy record removed, absence pinned |

No regression window at any point, and neither lane ever had to wait on the other's merge timing.

## The gate

`tsc` clean · `pnpm lint` **0 errors** · **Ran 51 of 51** Custom Rules steps · `pnpm build` clean ·
full suite green.

## Not exercised

The S25 APK. This is a server route shape change with no Capacitor, safe-area or gesture surface —
and nothing on device reads the removed field, because Q-362b moved every consumer before this landed.
