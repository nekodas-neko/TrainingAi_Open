# The daily digest stops giving corrective nutrition advice off one logged day (Q-303)

**Branch:** `fix/ai-qualify-sparse-nutrition` · **Lane A**

## What was wrong

The daily digest once told a user *"let's focus on bumping that protein closer to your 150g
goal tomorrow"* on a day where the surrounding 14-day window had only 4 logged days. The advice
wasn't false — the day's own numbers were real — but it was delivered with the same confidence as
the workout data next to it, which was complete. A single logged day looks identical to a
representative one from inside the prompt; nothing told the model the history behind it was thin.

## Sibling sweep

The entry asked to check every AI surface reading nutrition data: `weekly-digest` and
`health-insight` don't read nutrition data at all, and the Coach's nutrition tools
(`lib/coach/domains/goals.ts`) only read/write *targets*, never coach off logged macros. The
exposure is confined to `app/api/daily-digest/route.ts`.

## What shipped

`daily-digest/route.ts` now queries `repo.listFoodLogsSummary` over the same 14-day window and
`MIN_LOGGED_DAYS` floor Q-302's adaptive-TDEE gate already uses
(`packages/shared/src/nutrition/adaptive-tdee.ts`) — reusing the existing threshold rather than
inventing a second one. Below the floor, a `Nutrition logging coverage: N of 14 days logged in
the last two weeks (sparse)` line joins the context, and the system prompt gains one sentence:
*"If a line below flags a domain's logging coverage as sparse, do not give corrective advice for
that domain."* Today's real numbers still render as before — this doesn't hide the data, it tells
the model not to over-read it.

## Verification

- `app/api/daily-digest/__tests__/nutrition-coverage-qualifier.test.ts` (3 cases, mocked
  repository/auth/`generateText`, capturing the actual prompt sent to the model): sparse coverage
  produces the qualifier line and instruction; adequate coverage produces neither; today's real
  totals still render regardless.
- `pnpm check:rules` — Ran 55 of 55.
- Full suite: 4693 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode` in this
  sandbox).
- `tsc --noEmit` clean.

## Not exercised

**No real end-to-end run against the live route.** The local dev DB has no seeded `food_items`
rows, so a realistic multi-day logging fixture couldn't be built to drive the route through actual
Postgres — verification is the mocked-repository test above, which uses the real repository method
signatures but not the real adapter or SQL. `listFoodLogsSummary`'s query (group-by-date, inner
join on `food_items`, `deleted_at IS NULL`) was read, not run, against real data. The model's own
compliance with the new instruction — whether it actually withholds corrective advice — was never
observed either; only the prompt it receives was verified.
