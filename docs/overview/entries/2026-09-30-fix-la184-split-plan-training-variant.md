# 2026-09-30 — LA-184: a split meal plan always said "Rest day"

**Branch:** `fix/la184-split-plan-training-variant` · v1.486.5.

`MealPlanSection` has taken `isTrainingDay?: boolean` since it was written and **no caller ever
passed it**, so `pickVariant` saw `undefined` every day and fell to the rest variant. `ActivePlanCard`
is the only call site — confirmed by grep *and* by `tsc`, as the entry said.

**The bug was on screen the whole time, which is what made it assertable.** The card renders
`variant.dayType` as a badge, so a split plan read **"Rest day"** on a training day. The entry
described it as a wrong prop; it was a wrong label and wrong macro targets.

## The entry's stated fix had nothing to read, and production is what said so

> *"pass today's training-day flag from the user's schedule, the same source the rest of the app
> uses for is today a training day"*

Measured against production `claude_ro`, not inferred:

| program | active | schedule type | `rest_after_n` | `schedule_days` rows |
|---|---|---|---|---|
| Bankai | ✅ | `rotation` | 3 | **0** |
| Strength + Hypertrophy | | `rotation` | 3 | **0** |
| AI-Phase1 | | `rotation` | 3 | **0** |
| Shikai | | `rotation` | 3 | **0** |
| Main | | `rotation` | 3 | **0** |

**All five of the owner's programs are rotation schedules with zero `schedule_days`.** So there is no
day-of-week map anywhere to read, and the weekly branch of `getNextSession`
(`schedule?.type === 'weekly' && schedule.days?.length`) has never once been taken for him. A
rotation's day type for a given date is a function of **workout history** — where the
rotate-3-then-rest cycle has got to — which only the server holds.

**And `getNextSession(userId, timezone?)` takes no date.** The whole recommendation is about today,
which is exactly why the `next-session` cache key is `cachedFetchToday` at every read site. There is
no per-date answer to pass.

## So today shipped, and the per-date half is filed

`components/nutrition/plan-variant-day.ts` answers **three** values, not two — `true`, `false`, and
`undefined` for *unknown*. `undefined` falls through to precisely the rest-variant behaviour that was
already there, which is what makes a today-only fix safe rather than half-done: no date behaves worse
than before, and today behaves correctly.

**⛔ The trap, and a bare `!rec.isRestDay` would have walked into it.** With no active program
`getNextSession` returns `{ isRestDay: false, reason: 'No active program configured' }` and **no
session** — a claim about nothing. Only a recommendation that *names a session* says today is a
training day. That case has its own unit test and its own browser test.

The per-date half is **`LB-195`** (`Lane: A`), and it carries the thing that has to be decided before
anyone builds it: **"is date D a training day" is two different questions.** For a past date it means
*did he train*, which is a fact already in `workout_sessions`. For a future date it means *would the
rotation put a session there*, which is a projection a single unplanned rest day falsifies. One
boolean answering both is how a card ends up confidently wrong about last Tuesday.

## `useCachedValue`, not a fetch-once effect

This card lives in the **persistent tab shell**, which never unmounts, so a
`useEffect(() => { cachedFetch(…) }, [])` would hold its first answer until the app was killed — the
Q-402 shape the owner reported as *"requires a restart of the app"*. `today: true` because
`next-session` is a `cachedFetchToday` key everywhere else and the variant is a property of the key,
not of the call site. `NEXT_SESSION_TTL` because that key has one canonical TTL. `onError` is a
deliberate no-op: an unknown day type already renders correctly, and a meal plan is not the surface
to report a workout recommendation's failure on.

## Verified

- `components/nutrition/__tests__/la184-split-plan-variant.test.ts` — **8 tests**.
- `e2e/la184-split-plan-variant.spec.ts` — **3 passing** at 412 px dark: a scheduled session shows the
  training variant and its meals, a rest day shows the rest variant, and no-active-program shows rest
  rather than claiming a training day.
- **Control-run three ways, and each reddens exactly one assertion.** Removing the prop from
  `ActivePlanCard` reddens only the training-day case — the defect's own signature, with the rest-day
  and no-program cases still green because `undefined` already fell to rest. Replacing the derivation
  with `!rec.isRestDay` reddens only the no-program case. Removing the `logDate !== today` guard
  reddens only the other-days case.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 84 of 84** · `check-memo-prop-stability` clean
  (96 memoised components, 0 defeated).

**⚠ A gate caught a real time bomb in my own fixture.** `check-e2e-stub-dates` failed on
`lastReviewedAt: '2026-09-29T00:00:00.000Z'`: `isPlanStale` compares it against `Date.now()` over a
**28-day** window, so one side was a literal and the other the real clock — the fixture would have
passed until it silently started rendering the plan-review banner instead. Derived from the clock
now. This is the `scale-ble-day-keying.test.ts` class that went red on every branch including `main`,
and the rule refuses it outright rather than waiting for the detonation date.

## Not exercised

- **A real split plan, anywhere.** The local database holds **zero `meal_plans` and zero
  `meal_plan_variants`** (`count(*)`), and so does production — the owner's only plan was
  soft-deleted on 2026-08-11. Both payloads are stubbed, and that is the only way to reach this
  surface at all. The logic is proven; no split plan has existed on any database this harness can see.
- **Any date but today**, by design and now by entry: `LB-195`.
- **The device.** Nothing is filed as owed, because there is no split plan for a phone to look at.
  When the owner next makes one, the day-type badge is the thing to glance at.
