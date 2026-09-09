## 2026-09-09 — the plan card's per-meal answer, covered — and a decline that could revert (LB-51, Lane B)

**What was owed.** LB-51 shipped `plan-rescale.spec.ts` and left a `Keep:` naming three uncovered
plan-card actions: the log-all action, the per-meal log and decline, and save-to-My-Foods. Two have
since been covered by other work — log-all by `plan-day-fill.spec.ts` and the copy by
`plan-meal-to-saved-meal.spec.ts` — so what was genuinely left was the **per-meal log and decline**.
That is now `e2e/plan-meal-log-decline.spec.ts`, and the LB-51 entry is removed from the queue.

**The coverage found a bug, which is the point of it.** Declining a meal reverted on **two runs in
three**. The decline flips the row optimistically and writes behind it; `loadAnswers` re-runs while
the card is on screen, and a read already in flight when the user taps returns the state from
*before* the tap. `setDeclinedMealIds(new Set(serverIds))` applied it verbatim and the answer was
gone — the optimistic-write rule this repo learned from the mood-checkin re-prompt, in the one place
nothing else can reveal it: a decline writes no food and moves no total, so the only symptom is the
meal asking again. Fixed in `app/nutrition/use-plan-meal-logging.ts` with a small map of answers this
device has made that a read has not yet agreed with; an override is dropped the moment a read
matches it, so it converges rather than pinning the value against the server. **3 of 3 runs green
after, 1 of 3 before.**

**What the spec asserts, and why it is on rows rather than labels.** Both buttons report themselves
instantly, so a control wired to nothing paints the same screen. What only passes if the write
happened is a `food_logs` row for the logged meal — and, for the decline, its *absence* plus a live
`plan_meal_answers` row. The decline is also re-read after a full reload, which is the only evidence
it persisted at all. The fixture is built in Postgres rather than stubbed because
`plan_meal_answers.plan_meal_id` is a foreign key onto `meal_plan_meals`: a stub's invented ids
cannot be declined.

**One guard is reasoned, not exercised.** The override map is keyed by day as well as by meal,
because a plan meal keeps the same id on every day it is planned for. Nothing currently reaches the
hook with a second date — the plan card renders only on today, which an attempt to assert it through
the day switcher established — so this is belt-and-braces against a future change rather than a bug
that was happening, and the comment says so rather than claiming a fix.

**Mutation-checked.** Removing the declined filter from `fillableMeals` fails the offer-count
assertion; making the decline never reach the server fails the persistence half. Both were run.

**Two gotchas worth carrying.** `scrollIntoViewIfNeeded()` scrolls *every* ancestor scroll
container, and on the tab shell one of those is the horizontal carousel holding all five tab trees —
scrolling a control into view slid the shell off Nutrition and the tap landed on the Workout tab.
`scrollIntoView({ block: 'center', inline: 'nearest' })` is the fix. And reading the database
straight after the optimistic flip finds it empty: the write has to be waited for
(`page.waitForResponse`), not assumed.

**Not exercised.** The device path. The browser has no native SQLite, so `getLocalStore` returns null
and both writes take their web fallback — the local-store mirror, the outbox mutation, and the
`store.getPlanMealAnswers` branch of the fix are owed an on-device check. The fix's reconcile logic
is shared by both branches, but only the web one ran here.

**Version.** 1.443.4 — patch; the reverting decline was user-visible.
