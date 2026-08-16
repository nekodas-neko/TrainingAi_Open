# Recommended-workout card: round average reps down

> Design: `docs/superpowers/specs/2026-07-05-avg-reps-round-down-display.md`.
> One tiny, independent display fix — one PR.

## Task 1 — Floor instead of round in `avgReps()`

`components/workout/pre-workout-screen.tsx:40-44`:

```ts
function avgReps(reps: (number | null)[]): number | null {
  const valid = reps.filter((r): r is number => r != null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}
```

Change `Math.round(...)` → `Math.floor(...)`. No other lines in this function
change. Do not touch `modalWeight()` or the call site at `:283-284`.

Do not touch `estimated1rm`/`target80` (`app/api/workout-data/route.ts`) or the
stored 1-dp `avg_reps` column path (`lib/workout/log-exercise.ts`,
`app/api/workout-entry/route.ts`) — confirmed independent in the design doc.

## Task 2 — Lock the rounding direction with a test

`components/workout/pre-workout-screen.tsx` currently has no test file. Add
`components/workout/__tests__/pre-workout-screen-avg-reps.test.ts` covering
just the exported behavior needed here — export `avgReps` (named export is
fine; it doesn't need to leave the module's public surface beyond that) and
assert:
- `[8, 8, 8, 10]` → `8` (was `9` under `Math.round`; this is the case that
  motivated the change)
- `[5, 4, 4, 5]` → `4` (was `5`)
- `[10, 10, 10, 10]` → `10` (exact mean, unaffected either way)
- `[12, 13, 15]` → `13` (already floors the same under both — mean 13.33)
- `[]` / all-null → `null`

This is the regression guard for backlog #2's Task 4 (see coordination note
below) and #11/U9's export — both must keep these assertions passing.

## Task 3 — Amend backlog #2's Task 4 wording (already done this session)

`docs/superpowers/plans/2026-07-04-acwr-formula-consolidation.md` Task 4
previously said the display helper should "reuse the same `avgReps` (1-dp)
rather than its own integer version." Updated in the same PR as this plan to
instead say: the log/edit-path trio (`volume`, `intensityPct`, stored 1-dp
`avg_reps`) gets extracted into `computeSetAggregates()`; the pre-workout
display copy keeps computing its own integer, floored value (Task 1 of this
plan) — it must not be replaced by the 1-dp stored figure. This avoids the
two backlog items fighting each other whichever lands second.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`.
- `pnpm dev`: open the Pull session pre-workout screen for a user/date with
  ragged set reps (the local seed's 28 June-equivalent data, or any session
  with a non-integer mean) and confirm the card now shows the floored value,
  not the previously-rounded one. Confirm `est 1RM` text is unchanged (same
  value as before this change).
- Patch bump + changelog entry (user-visible number on a card changes).
  Display-only bug-style tweak on an already-shipped feature → exempt from
  the merge-confirmation gate per CLAUDE.md.
- Remove this backlog entry in the same PR that completes it.
