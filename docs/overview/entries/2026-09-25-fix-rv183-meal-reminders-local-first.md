# 2026-09-25 — RV-183's meal half, and the "join" that did not exist

**Branch:** `fix/rv183-meal-reminders-local-first` · **Lane B** (LB-147)

Yesterday I shipped RV-183's supplement half and deferred the meal half, writing that
`reconcileMealReminders` "needs a join this PR did not build". **That was wrong, and reading the
function rather than assuming is what found it.**

It takes `Pick<FoodLog, 'mealTypeId'>[]` — not a joined food log — and reads exactly six fields off a
meal type: `id`, `name`, `emoji`, `remindersEnabled`, `timeEndHour`, `required`. `LocalFoodLog` and
`LocalMealType` already carry every one. There is no join anywhere in it.

What actually blocked the local read was the **declared parameter type**. Both functions said
`MealType[]`, which demands `userId`, `sortOrder`, `timeStartHour` and `createdAt` that neither
function touches — so the on-device row could not be passed without inventing four fields. Inventing
a field is how BF-112 shipped a dose prompt that worked in the browser and never fired on the APK.

## What shipped

`MealTypeForReminders`, a `Pick` of the six fields the module reads, on both `computeMealReminderActions`
and `scheduleEndOfDayReminder`. The local row then satisfies it directly, with no mapping layer at
all — which is better than the supplement half, where a mapping was unavoidable.

`sync-provider.tsx` now reads meal types and today's food logs from the local store, API as
fallback. Same correctness point as the supplements: food logs are an offline-first domain, so
reconciling reminders from the server meant **a meal logged offline kept nagging you to log it**
until the next pull. It also drops two more GETs from every launch and every resume.

**The two empty cases are deliberately not symmetric.** An empty meal-type table falls through to the
API — that is an unhydrated store, not a user with no meals, and treating it as the latter would
cancel every reminder on a cold device. Zero *food logs* does not fall through, because that is
precisely the state the reminder exists for.

## Found on the way out — filed, not fixed

The three reminder modules time every notification in **Brisbane or in the phone's zone, never the
user's**: eight sites across `meal-reminders.ts`, `supplement-reminders.ts` and
`workout-reminders.ts`. Four are bare `todayInTz()` (the "already notified today" key, so the day
rolls at the wrong hour) and four are device-local `setHours` (the scheduled instant, so an 08:00
reminder fires at the phone's 08:00).

**RV-176 fixed exactly this class and missed these, because that sweep scanned `.tsx`.** Filed as
`LB-148` rather than folded in here: it changes *when notifications fire*, on a daily surface, and
needs the user's timezone threaded into three modules that currently take none. That is its own
change with its own verification.

It is invisible for the owner — his phone and his profile are both Brisbane — which is why the class
keeps surviving.

## Verification

7 tests in `lib/__tests__/rv183-meal-reminders-local-first.test.ts`. One is a compile-time guard: a
`LocalMealType` is assigned to `MealTypeForReminders[]` with no mapping, so widening the parameter
back to `MealType` stops the file compiling. **Control run:** with the call sites reverted, 3 of 7
fail.

`pnpm lint` clean · `tsc --noEmit` clean · `check:rules` 78 of 78.

**Not exercised: the device.** `getLocalStore` returns null in the web harness, so the branch this
PR adds never executes here — as with the supplement half, the behaviour that changed is offline
behaviour on a native build.
