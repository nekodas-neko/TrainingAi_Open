## 2026-09-07 — A confirmed deload week no longer decays the collection, and the rest of LA-76 is a schema decision (LA-76)

**Branch:** `fix/collection-deload-pause` · **Lane A**

### What shipped

`GET /api/collection` now feeds `pausedDays` from **two** sources rather than one: the rest days the
user chose (`listRestDays`, as before) **and** the confirmed early-deload week. New:
`earlyDeloadWeekDays(program)` in `packages/shared/src/phase-engine.ts`, sharing its length constant
with the existing `isEarlyDeloadWeek` so the two cannot drift.

That is six lines, and it is the whole of what LA-76 could correctly do.

### The measurement that changed the entry

LA-76 said a lifter who follows a prescribed deload loses cats for it, and named `isDeloadActive` as
the thing to run per day. Before implementing that, I asked production whether the premise
reproduces. It does not:

| | |
|---|---|
| sessions stamped `phase_type = 'deload'` | **3** — 2026-08-10, 08-17, 09-02 |
| …a contiguous week? | no — 7 and 16 days apart, isolated sessions |
| `is_early_deload = true` | **0 rows, ever** |
| `early_deload_week_start` | **NULL on all five programs** |
| largest trained-day gap, Aug–Sep | **2 days** |
| gaps that decay at all (≥3), all history | **5**, none near a deload session |

A gap of 2 does not decay — `chargeableGap` returns `span - 1 = 1` and `maxCompliantRestGap` is 1
for a rotation. I misread that at first and nearly filed "the workout ladder decays ten times a
month" as a finding; reading the fold rather than the gap distribution is what corrected it.

### Why the phase half is blocked, and on what

Three mechanisms could date a deload. Two cannot:

- **`program_phases` measures a phase in `durationCycles` — cycles, not dates.** There is no
  interval to read, which is why resolving one means replaying the phase engine per day across all
  history: the cost the entry already ruled out.
- **`workout_sessions.phase_type` records the sessions, not the span.** And a deload day you
  *trained* is already a faucet day that needs no pause — a pause exists for the days you did not
  train, and isolated stamped sessions cannot say where those intervals began or ended.
- **`programs.early_deload_week_start` is a dated 7-day span** — the only dated record of a deload
  anywhere in the schema. That is the one that shipped.

So what is left needs a **dated record of a deload span**, rows like `rest_days` rather than a
derivation. That is a migration and an owner call on whether a deload becomes first-class stored
state, so LA-76 keeps its place with `Gate: owner` and the numbers above written into it. Deriving
it instead is the option that loses: the collection replay has no window, so a wrong answer is wrong
forever rather than until it ages out.

### Verification

- `packages/shared` phase-engine + `lib/__tests__/collection-route.test.ts`: **46 passed**.
- **Mutation-checked three ways.** Dropping the early-deload half of `pausedDays` fails the pause
  case; making the window unbounded (400 days instead of 7) fails three cases including "does not
  excuse a deload week that has already ended"; starting the window a day late fails the two that
  hold it aligned with `isEarlyDeloadWeek`.
- The second route test is the one worth keeping: a confirmed deload must **stop** after seven days.
  Pausing on the flag rather than the dated window would excuse every gap after it forever, and
  nothing else in the repo would have caught that.
- `pnpm check:rules` — **Ran 69 of 69**. `tsc --noEmit` clean, ESLint clean.

**Not exercised:** `early_deload_week_start` is NULL on every program, so this code path does not
execute on the owner's live data — it fires the first time `POST /api/confirm-early-deload` is used.
What is verified is the assembly against mocked repositories, not a real deload week. No widget
consumes the route yet either (BF-122b is Lane B's), so nothing here is user-visible.

No version bump: nothing user-visible ships until the widget does.
