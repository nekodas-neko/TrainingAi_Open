# 2026-08-19 — Q-413: `logged_at` means when you ate, not when you tapped

**Branch:** `feat/resolve-eaten-at` · Implementation Lane A · JS/server only — reaches the device
through a Railway deploy, no APK needed.

## What was wrong

`food_logs.logged_at` was `timestamp notNull().defaultNow()` and **nothing computed it**.
`createFoodLog` passed a client-supplied value straight through when one existed (the offline
replay) and otherwise took the database default. So the column meant "when the row was created",
which is only accidentally when the food was eaten. Log yesterday's dinner over this morning's
coffee and the row said 08:00 while its `date` said yesterday — the two disagreed, and the timestamp
was the wrong one. Back-filling a missed day is the single most common way this log gets used after
the fact, so that is not an edge case.

## The rule, and where it lives

`resolveEatenAt({ date, window, at, tz })` in
**`packages/shared/src/nutrition/eaten-at.ts`** — one formula, one place, per the owner's statement
of it: *"if its logged within the time bucket - then record that as the time. If its added outside
the window; then choose the midpoint of the window."*

- `at` falls on `date` **and** its local hour is inside the window → keep `at`. A real observation
  beats a derived one.
- otherwise → the window's midpoint on `date`, in the **user's** timezone.

Four things decided whether this was right or subtly wrong, and all four are tested:

1. **The midpoint is built with `fromZonedTime`, never `setHours`.** `setHours` resolves in the
   *device's* zone, so the same log would stamp a different instant on a phone set to another
   country — this repo's most-repeated bug class. `lib/meal-reminders.ts` still does the `setHours`
   thing and that is defensible there (a reminder fires on the device); it was not copied here, and
   not "fixed" here either.
2. **It anchors to the log's `date`, never to `todayInTz()`.** That is what makes back-dating work
   and is the entire value of the change.
3. **A wrapping window (22 → 02) is handled, not rejected.** Its span is `end + 24 - start`, so the
   midpoint is `(start + span/2) mod 24` — the naive `(22 + 2) / 2` gives **noon**, the furthest
   point on the clock from the truth. The midpoint is projected back onto the log's **own date**:
   22 → 02 stamps 00:00 on D, not on D+1, because a resolved timestamp landing on a different local
   day than its row would reintroduce exactly the disagreement being removed. `timeEndHour = 24` is
   the ordinary end-of-day case and is **not** a wrap: 21–24 → 22:30.
4. **One call site per layer.** The server resolves inside `createFoodLog`, which is where *both*
   the web route and the offline `pushMutations` branch land — so the two cannot drift, which is
   what this project's paired write paths repeatedly do. The local store resolves in
   `resolveLocalEatenAt`, called from `logFoodEntries` and `logMealItems`.

**A client-supplied `loggedAt` is a candidate, not an answer.** The offline replay carries the
instant the button was pressed — the very thing this exists to stop storing unexamined — so the
server re-resolves it rather than passing it through.

The local store needs its own pass because on the canonical runtime the local row **is** what the
nutrition screen reads: an unresolved local row shows the wrong time until a pull corrects it, and
offline there is no pull. `meal_types` is a synced local table, so the window is already on the
device; only the timezone had to be threaded in, from `useUserTimezone()` at the four call sites.
`updatedAt` deliberately stays the write clock — it is a sync cursor and must keep meaning "when
this row changed".

## Migration 203 — deliberately narrow

`203_food_logs_eaten_at_backfill.sql` recomputes **only rows whose `logged_at` falls on a different
local date than the row's own `date`**. Those were unambiguously logged later and carry no
information about when the food was eaten. Everything else is untouched: where the user logged as
they ate, the stored instant is the *better* datum and overwriting it with a midpoint destroys a
real observation.

**The cost of that choice, stated rather than buried:** a pre-existing row logged on the right day
but outside its window keeps its original time, while an identical new row would be moved to the
midpoint. A handful of historical points therefore sit outside their meal's window. That is the
conservative trade the entry asked for; a broader backfill remains a separate, explicit decision.
Q-414's chart entry now carries this caveat so it is not discovered as a surprise.

Dry-run against the local database inside a transaction, with a wrapping meal type added for the
occasion: Dinner (17–21) back-dated → **19:00**, Breakfast (6–10) two days late → **08:00**,
Overnight (22–02) → **00:00 on its own date**, same-day Lunch → **untouched**. Re-running it
reported `UPDATE 0`, so it is idempotent. All three moved values match what the TypeScript resolver
produces for the same inputs — the SQL and the formula agree, which is the thing worth checking when
the same rule is written twice.

## Verification

`npx tsc --noEmit` clean · `pnpm lint` clean · `pnpm check:rules` **Ran 49 of 49** · full suite
**514 files / 4,211 tests passed**.

- **14 unit tests** on the resolver: inside-window, outside-window, back-dated, `timeEndHour = 24`,
  a wrapping window, and the user's-zone-not-the-process's case. Per the standing rule, the timezone
  regression test **does not wait for the clock**: it computes the `Etc/GMT±N` zone whose local time
  is near 01:00 *right now* and runs the case there, so it fires on every CI run rather than for two
  hours a day.
- **8 DB-backed tests** on `createFoodLog`, because the thing that historically drifts here is a
  write path, not a formula — including that a client-supplied `loggedAt` is re-resolved, and that
  the user's stored timezone is what governs (asserted by flipping the row to `America/New_York` and
  checking the result is *not* 13:30 Brisbane, so a tz-blind implementation cannot pass by accident
  of the server's own zone).
- **Live against `pnpm dev`** at 19:39 Brisbane, which put the clock inside Dinner and outside
  Lunch — four POSTs covering every branch:

  | date | meal | stored (Brisbane) | why |
  |---|---|---|---|
  | today | Lunch 12–15 | **13:30** | outside the window → midpoint |
  | today | Dinner 17–21 | **19:39** | inside → the real instant is kept |
  | 2 days ago | Lunch 12–15 | **17th 13:30** | back-dated → midpoint on the log's date |
  | 2 days ago | Dinner 17–21 | **17th 19:00** | the hour *is* inside, but the day is not |

  That last row is the sharpest of the four: same window, same hour, different date, different
  treatment.

## Not exercised

**The device.** The local-store branch of `logFoodEntries`/`logMealItems` needs native SQLite, which
`getLocalStore` returns null for in the web sandbox — so `pnpm dev` took the API fallback and proved
the *server* half only. The local resolver is covered by the shared unit tests but its wiring is
not, and the on-device check is: back-fill yesterday's dinner on the APK while offline and confirm
the row shows the window midpoint rather than the current time, both before and after it syncs.

**Q-412's reassign** is not in this PR — it is its own queued item, and its entry now points at
`resolveEatenAt` rather than describing the midpoint again.

**Q-414's calories-over-time chart** is not in this PR either. It is now unblocked: the column means
what its name says.
