# 2026-09-29 — BF-220: the set he just logged can move the next one

**Branch:** `chore/bf220-rpe-reaches-nothing` · v1.486.0.

Owner, mid-rest on Pull: *"This was too heavy for me … would be nice to be able to tell coach then
and there if thats on the list of possibilities."* He had already told it — `13.75 kg × 6` at **RPE
10** against a prescribed 7 — and the next card still read `13.75 kg × 7`.

## The diagnosis, verified rather than inherited

`computeRpeAdjustment` has exactly **two** non-test call sites, checked by export name: its own
definition and `autoregulation.ts:141`, which runs at prescription-generation time. Nothing in a live
session reads RPE at all. The rule that would fire already agrees with him — his set trips the
back-off branch (`rpeDelta ≥ RPE_DEAD_BAND` **and** the reps fell short) the moment it is logged.

## It calls the engine instead of restating it

`RPE_DEAD_BAND` is **not exported**, so a threshold copied client-side is exactly the divergence the
one-formula rule prevents — and the in-session answer could then contradict next week's on the same
set. `rpe-load-suggestion.ts` builds an `AutoregSignal` and reads `pctMultiplier`.

**The number matches what the entry predicted independently:** 6 of 7 reps ⇒ completion 0.857 ⇒ a
6.86% cut ⇒ 12.81 kg ⇒ **12.5 kg** at the 1.25 step. The entry's worked example says *"Drop set 2 to
12.5 kg?"*. Pinned, because an arithmetic slip would still have produced *a* lower number and looked
right.

## Two narrowings

**`rm1Trend` is passed as `'flat'`** — the real trend needs history this screen has not got. It can
only ever *withhold* a suggestion, never invent one, and the reported case turns on the reps.

**An untouched RPE picker cannot fire it.** `rpeValues` is seeded with `defaultRpeFromPct(pct)`, so a
set he never rated reads back as exactly the expected RPE and fails the dead band. The morning
check-in's neutral `3` class — here the arithmetic makes it inert, pinned across four percentages.

## ⚠ The browser render earned its place: the offer was mounted where it could never be seen

The first wiring put the pill inside `ActiveSetCard`. That component is mounted
`{workoutPhase === "set" && …}` — and **logging a set moves the phase to `"rest"`**, where the same
zone renders the `RestTimer` instead. So the offer never mounted in the one window it exists for: the
rest between a hard set and the next, which is exactly when he is looking at this screen, as the
entry itself says (*"a rest timer running"*).

Neither the eleven unit tests nor reading the props could show that. The render did. The pill now
sits **above the phase switch**, so it appears during rest and persists into the set, and
`active-set-card.tsx` reverts to what `main` had — a smaller diff than the first attempt.

## Two false leads, unwound

**It looked like this change broke the workout loop.** The first e2e runs failed with no `Start Set 2`
at all. The control — `workout-set-loop.spec.ts`, untouched — **failed the same way**, and failed
against `origin/main` too. Local database state, not any change: `LB-178`'s standing lesson that CI
seeds a fresh database and a persistent local one has been mutated by every previous run.
`pnpm db:rebuild` restored it and the control passed 3/3.

**And this spec was what polluted it.** Unlike its sibling it had no cleanup, so each run left
sessions behind for the next to resume into. Added, with the measurement in its docstring.

One of my own probes was invalid and its result discarded: `test.afterAll.skip` is not real API, so
the run collected nothing and returned only seeded rows.

## Verified

- `bf220-rpe-load-suggestion.test.ts` — **11 tests**, including the reported set and the pinned
  12.5 kg.
- `e2e/bf220-rpe-load-suggestion.spec.ts` — **2 passing**: one test drives a hard short set and
  checks the pill appears on the next set card, carries the engine's own sentence and moves the dial
  when taken; the other checks that dismissing it leaves the session untouched.
  **⚠ Corrected 2026-09-30 (LB-189): this said 4.** The file holds **two** `test()` blocks — 4 was
  Playwright's run total, which counts the `auth.setup.ts` and `zero-data.setup.ts` projects
  alongside the specs, so every spec run here reports two more than it has. Quote
  `grep -c '^test('`, not the runner's last line.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 84 of 84** · `pnpm lint` 0 errors · `pnpm test`
  **11,059 passed** · `pnpm build` · memo-stability and size gates clean.

Two gates caught real mistakes: `check-memo-prop-stability` found inline arrows on the memoised pill
— the rule its own docstring cites — and RV-209's type floor found a `text-[10px]` below the floor
plus two 11px literals where the scale has a token.

## Not exercised

- **The device**, which is filed rather than claimed:
  [`known-issues.md`](../known-issues.md) carries the entry's own pass/fail (the suggestion must not
  shift the layout or compete with `Start Set 2`) **plus a second reading the entry does not name** —
  the pill sits above the card, so on a short viewport it may arrive off-screen and be missed
  entirely, the opposite failure from crowding and equally invisible from a container.
- **A deload session.** The suppression is asserted at the unit level; no sandbox session is in a
  deload week, so the `isDeload` prop's real value has never been anything but `false` in a browser.
- **The next exercise.** Deliberately out of scope per the entry — one exercise feeling heavy is weak
  evidence about the next.
