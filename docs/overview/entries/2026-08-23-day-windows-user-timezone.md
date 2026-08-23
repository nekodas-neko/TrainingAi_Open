# 2026-08-23 — Every day window takes the user's timezone now (LA-19)

**Branch:** `fix/aest-midnight-user-timezone` · **Lane A** · **closes LA-19**

`aestMidnight(y, m, d, tz)` takes a timezone and defaults it to `DEFAULT_TZ`. **9 call sites passed
one; 12 did not** — right for the owner, who is in Brisbane, and wrong for every other account. The
Canonical Runtime amendment is explicit that no user-visible surface should assume the owner's own
device, and other accounts exist today.

Filed by [yesterday's sweep](2026-08-23-utc-offset-fixture-sweep.md), which was looking for
something else and found this instead.

## What changed

| file | what now carries a timezone |
|---|---|
| `adapter.ts` | `getDayLog`, `getDayExerciseNames`, `getDaySessionSummaries` |
| `slices/programs.ts` | `confirmEarlyDeload` |
| `slices/oura.ts` | `getUnsyncedHrSessionsForDay` |
| `shared/workout/log-exercise.ts` | the session-start-of-day anchor |
| `coach/domains/early-deload.ts` | `dayBounds` / `loadState`, threaded through `handlerFor` |

Nine callers pass `session.user?.timezone ?? DEFAULT_TZ` — the pattern `getCalendarData`,
`getRecentTrainedDays` and `getNextSession` already use.

`getUnsyncedHrSessionsForDay` has **no production caller** (only the adapter wrapper, the interface
line and a test), and LA-19 left fix-or-delete to whoever took it. Fixed: it costs three lines and
keeps the soft-delete coverage its test provides, where deleting costs that coverage and a wider
diff for no behavioural gain.

## The proof is the experiment that found it

Threading a parameter is easy to do and easy to get subtly wrong, and the whole suite runs in
Brisbane, so it would pass either way. So the check is the same one that found the defect: shift the
test user's timezone into its own 00:00–02:00 band and re-run.

```
before   oura-workout-soft-delete   1 failed | 17 passed
after    oura-workout-soft-delete   18 passed
```

**And the first attempt did not fix it** — the slice took the parameter, the test still called it
without one, and the default put the window back in Brisbane. That is the trap the entry describes,
demonstrated on the fix for the trap. The test passes `TZ` now, as any real caller must.

Re-sweeping all 14 files leaves exactly one failure: `meal-type-reassign`, which pins both the
instant and the zone deliberately and says so — the method's known blind spot, recorded yesterday.

## The ratchet's baseline is now empty

`scripts/check-aest-midnight-timezone.js` was a debt list; it is a rule. An omitting call site is a
regression rather than a row.

It also **caught its own false positive** on the way here. The first version matched
`aestMidnight (14:00 UTC)` inside a *comment* in `app/api/day-log/route.ts`, putting a file with no
call site into the baseline. Comments and string bodies are blanked before scanning now, and the
stale-row rule is what surfaced it — that row could not survive its own file having none. The count
had by then been wrong in both directions: a `grep | sed` audit said 11, the first scanner said 13,
and the answer was 12.

## Verification

Full suite **545 files / 4,506 tests** green · `pnpm check:rules` → **52 of 52** · typecheck and
lint 0 errors. Swept files restored byte-for-byte after each experiment.

**Not exercised:** the behaviour change itself has no live effect for the owner — Brisbane is the
default, so every window is identical for them. It matters for the other accounts, and none of them
is reachable from here. Not device-dependent.
