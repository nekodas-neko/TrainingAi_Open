# 2026-09-08 — the nutrition goal → target → adherence loop gets tests (PS-39)

**Branch:** `test/nutrition-targets-adherence-routes` · **Lane A** · PS-39, coverage ratchet **92 → 87**.

## What shipped

`lib/__tests__/nutrition-targets-adherence-routes.test.ts` — 26 cases across
`GET/PUT /api/nutrition/targets`, `GET /api/nutrition/adherence`,
`GET /api/nutrition/weekly-summary`, `PATCH /api/nutrition-goals/[id]` and
`POST /api/nutrition-goals/touch-review`. No product change; the five routes were already right.

Batched because they are one loop rather than five endpoints: a recommendation is reviewed,
accepting it writes the targets, and adherence is how you find out whether the targets were
livable. The decisions their response shapes hide, now pinned:

- **Saving a calorie target mirrors it into the denormalised `users.calorie_goal`** the Health tab
  and Home tiles read — converted back through `dailyKcalToGoal` into the user's chosen daily or
  weekly unit, so the mirror never flips their display preference or writes a daily number into a
  weekly-typed field. A weekly user saving 2,000 kcal/day gets 14,000 written, not 2,000.
- **A `null` calorie target means "leave it alone", not "clear it"** — it reaches the upsert as
  `undefined` and skips the mirror entirely, which is what keeps the two from disagreeing.
- **Zero required meal types is no signal, not zero adherence.** A user who configured no required
  meals has not failed to log them, so the ratio is `null`.
- **A recommendation that is not the caller's answers 404**, and the review timestamp is stamped
  only when a status actually changed.
- **Both windows are built with `shiftDateStr`** and anchored to the caller's timezone.

## Mutation pass — 35 mutations, 3 survivors, all three real

All three were the same shape: a fixture that could not tell the right behaviour from the wrong one.

1. **Two timezone survivors, one cause.** The adherence and weekly-summary windows both read
   `session.user.timezone ?? DEFAULT_TZ`, and replacing that with a bare `DEFAULT_TZ` changed
   nothing — because the fixture user's timezone *is* `Australia/Brisbane`, the default. Both cases
   now compare `Etc/GMT-14` against `Etc/GMT+12`: twenty-six hours apart, so their local days always
   differ and the assertion cannot hold by coincidence at any hour.
2. **The ownership check was never asserted.** `getGoalRecommendation(userId, id)` *is* the scoping
   for `PATCH /api/nutrition-goals/[id]` — there is no second check — and swapping `userId` for
   another id survived, because the test only asserted the call happened. It now asserts the
   arguments.

The first is a variant of what the body/health batch found a few hours earlier: a timezone fixture
that agrees with the default proves nothing about which one the route read. There it was a zone that
agreed for part of the day; here it was one that agreed always.

## Not exercised

Web/Node only. No device run: these are server routes with no native, safe-area, gesture or
notification surface, and the tests mock the repository, so no Postgres path, no drifted production
data and no Samsung WebView rendering were exercised.
