# 2026-08-19 — a half-logged day stops counting as a light one (Q-387, Lane A half)

**Lane A** · branch `feat/tdee-day-completeness` · migrations **201** + **202**, local SQLite **v27**
· no Kotlin, no APK.

The owner asked: *"what is the control in place if I just log breakfast/lunch and skip the rest? does
it assume that's all I had for the day and tune around that?"* Yes, it did.

`adaptive-tdee.ts` decided what a logged day was with a bare non-zero test, so a day carrying one
200 kcal apple was a logged day at 200 kcal. Reproduced here with the real module before changing it
— 14 days at a true 2,600 maintenance, weight flat, `partial` of them stopping after lunch at 1,400:

```
partial   daysLogged   meanIntake   maintenance   confidence   excludedReason
0         14           2600         2600          medium       null
6         14           2086         2086          medium       null
14        14           1400         1400          medium       null
```

Linear at **86 kcal per partial day**, every row passing every gate. At a realistic 6-of-14 the
number was 514 low and looked exactly as trustworthy as a correct one.

**Two partial-day protections already existed and neither covered this**, which is what made it easy
to miss. A day with *nothing* logged is `intakeKcal: null` and excluded from the mean. *Today* is
excluded outright — and the comment there describes this exact trap while solving only the
in-progress half of it. The author saw the version that self-corrects by evening and left the one
that never does.

It is not just a card: the estimate feeds `targetFromMaintenance`, so the **recommended daily target
inherited the whole error** with a cut's deficit on top — the app telling an under-logger to eat
hundreds of kcal below real maintenance.

## The control, as the owner chose it

*"A button at the bottom of the log after the last meal that says 'Complete Today's Logging'"* — the
explicit marker. The two alternatives are closed and worth not re-litigating: a "% below expected"
threshold is **circular** (the expectation derives from the number being estimated) and would discard
genuinely low days, biasing maintenance the other way; silent inference from logging shape cannot be
corrected by the person who actually knows the answer.

## What shipped here

- `day_checkins.food_logging_completed_at` — on that table rather than a new one because it is
  already keyed per (user, day), already synced both ways, and already has an outbox domain. NULL
  means not marked; setting it back to NULL is the Undo.
- `POST /api/food-logging-complete` — `{ date?, complete }` → `{ date, complete, completedAt }`.
- `estimateMaintenance` filters on the flag. **Absent means excluded, not assumed complete**: the
  failure mode has to be "the estimate waits" rather than "the estimate is quietly wrong".
- **No backfill.** A past day has no flag and cannot be given an honest one.

## The clobber that would have undone it silently

`saveDayCheckin` upserts and overwrites every column it is given a value for, and the evening
check-in sheet knows nothing about food logging — so listing the new column unconditionally would
clear "I finished logging today" every time the check-in was saved. The field is optional on the
input and omitted from the `SET` when undefined; the local store does the same with a `COALESCE`.
There is a test that marks a day complete, saves an ordinary check-in over it, and asserts the flag
survived.

## Verified

Five new tests on the module for the case it had **zero** coverage of, including that 4 partial days
still calibrate correctly (10 complete remain) while 6 makes it wait rather than answer 2,086.

An existing service test failed the moment the wiring went in — it seeds 28 logged days and no flags,
so calibration correctly fell back to formula. That failure is the end-to-end proof, and it is now a
pair: *unmarked history → `source: 'formula'`*, *the same days marked → `'calibrated'`*. The day key
is a plain `'YYYY-MM-DD'` string on both sides, checked directly, because a mismatch there would
silently exclude everything and look exactly like correct behaviour.

Live: mark, Undo, a slash-form date normalising to dashes, and an unknown key rejected 400.

Full suite 511 files / 4165 tests green.

## ⚠️ Inert until Lane B ships the button

No day can be marked from the app yet, so every day is excluded and `source` stays `'formula'`. That
is the intended failure mode, and it costs nothing today because **0 of the last 30 rolling windows**
cleared `MIN_LOGGED_DAYS` anyway (Q-302) — but the feature does nothing until the button lands. The
backlog entry now carries the Lane B scope, including the *"N of 10 days"* counter, which ships with
the button rather than after it: the button feeds something invisible, and that invisibility is why
this bug survived.

## Not exercised

Production, and the APK. The outbox path for `day_checkins` was extended by column rather than
rewritten, so it rides an existing route, but a device replay of the new field was not induced.
