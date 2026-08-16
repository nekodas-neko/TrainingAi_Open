## 2026-07-29 — Q-24 §5/§6: the offline food-item push had no schema at all

**Branch:** `fix/q24-food-item-schema-water-limit` · v1.234.5

Another agent had already fixed Q-24 §1–3 (activity plausibility, `body_metrics` bounds, sleep-span
checks). This takes §5 and §6.

### §5 — `food_items`

The `pushMutations` branch type-checked `id` and `name`, then ran every nutrition field through:

```ts
const num = (v: unknown): number => typeof v === 'number' ? v : 0
```

So `calories: "lots"` became **0 kcal and was stored**, `calories: 999999` was stored unchanged, and
`source` was a bare cast to a union — accepting any string at runtime. Meanwhile the web route
(`POST /api/nutrition/food-items`) had enforced a full schema since it was written. Queueing the
same write offline bypassed all of it.

That is the structural theme Q-24 names: the `pushMutations` branches are systematically weaker than
the routes they mirror, despite the SYNC-P3/P4 comments claiming parity.

Fixed by moving the route's schema to `lib/validation/food-item.ts` and having **both** paths parse
it — `FoodItemFieldsSchema` for the route, `FoodItemPushSchema` (same fields + the client row id)
for the push branch. Sharing the object is what stops them drifting again; two copies of the same
caps would just be the same bug deferred.

### §6 — `/api/water-log`

The only write route with no rate limiter. It *increments* a running total, so an unthrottled caller
can drive a day's water arbitrarily high one accepted request at a time, each individually inside
the ≤5000 ml bound. Now 60/min, matching `day-checkin` and `food-logs`.

(§6's other half — `waterMlDelta` bounds in the push branch — was already fixed in the §1–3 pass.)

### Verification

Full suite **2,618 passing** (the 20 failures are the pre-existing `claude_readonly` connection
tests), `tsc`, lint, `check-push-mutations` and `check-reconcile` clean. Seven new tests pin the
cases the old code got wrong: a non-number rejected rather than coerced to 0, impossible values
rejected, negatives rejected, an unknown `source` rejected rather than cast.

Live `pnpm dev`, authenticated:

| request | result |
|---|---|
| `POST /api/water-log {ml: 250}` | 200 |
| `POST /api/water-log {ml: 9999}` | 400 — still bounded after the change |
| `POST /api/nutrition/food-items` normal | 201 |
| same with `calories: 999999` | 400 `expected number to be <=10000` |
| 64 rapid water posts | **58 × 200 then 6 × 429** — the new limiter trips |

The route checks matter beyond the new limiter: they prove the schema *extraction* didn't lose any
of the caps the web route already had.

### Also corrected

The Q-24 backlog entry's "Remaining, unfixed" list still enumerated items 1–3 as outstanding after
they had been fixed, which would have sent the next reader to re-do finished work. The heading now
says which sections are live (§4 and §7).

### Not exercised

The offline push path itself — the schema is unit-tested and the branch is a straight
`safeParse`, but no mutation was pushed through a real outbox. That needs the APK.
