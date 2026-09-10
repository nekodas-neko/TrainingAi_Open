# Session journal — batch folded 2026-09-10

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-08-19-partial-night-manual-bedtime"></a>

# The owner's fix was better than mine, and smaller

**Date:** 2026-08-19 · **Branch:** `tuning/manual-bedtime-entry` · **Agent:** Tuning 🎶
**Type:** docs-only — design proposal from an owner report · **Filed as:** Q-519, Q-520

The owner forgot to put the ring on before bed and fitted it at ~4 am. The session reads
**4:23–8:03 am, 3h 5m, 84% efficiency, 30m latency** against trailing averages of 8h and 92%. Their
concern was specific: *"I don't want it to change estimated bed time values."*

## The night has two kinds of data, with opposite validity

**Wrong** — time asleep, efficiency, latency, bedtime, restless periods. They measure when the *ring*
was on, not when the owner slept. **Right** — HRV 61 ms, lowest HR 53, avg HR 57, breathing 9.1. Real
measurements of real sleep in the window observed, and they look it: HRV 61 against a 59 ms trailing
average, lowest HR 53 which is *exactly* the trailing average.

So deleting the night is the wrong instinct — it throws away good physiology the EMA baselines need,
and Q-506 showed how fragile those already are. Keeping it as-is is worse.

## The concern, quantified

The bedtime estimate averages sleep starts over 14 days. `minutesFromNoon(04:23)` = **983** against
~**660** for an 11 pm bedtime, so one such night moves the mean to 683 — **the estimate reads ~23
minutes later for two weeks**. `nightSessions()` can't help: it reassembles a night split by a wake-up
and needs an earlier fragment, which doesn't exist when the ring was off.

## The owner proposed the better fix

I had proposed a partial-night flag. They asked whether manual bedtime entry could work instead, and
it is the smaller and better-targeted answer.

`health-source.ts` merges **per field, not per row** — its own comment says a manual weight *"must not
stop the ring's HRV… from"* being kept. `manual` is rank 5, `oura_ble` rank 3. So writing **only
`sleep_start`** sets the real bedtime at rank 5 while duration, efficiency, HRV, HR and breathing all
stay at `oura_ble`, untouched. No new schema, no new merge logic.

**The invariant it rests on:** `duration_hours`, `time_in_bed_hours` and `efficiency` are **stored
columns, not derived from the start/end span**. That is the only reason it is safe — recompute either
from the span later and this silently produces a 9-hour night at 34% efficiency. Written into the
entry as a comment-beside-the-write requirement.

It deliberately does **not** stop the 3h 5m reaching the sleep score, readiness, resilience or the
Body Battery anchor. That is Q-520, sequenced second so it can be judged after the timing noise is
gone — and specified as **manual, not auto-detected**, because an automatic "looks partial" rule would
eventually suppress a genuinely bad short night, which is what the recalibrated score exists to show.

## Not exercised

**Nothing was written to production** — `claude_ro` is read-only, enforced by the Postgres role, so
this night could not be and was not edited by me. **The per-field merge was read from the source and
its comments, not demonstrated** — no test was run proving that writing `sleep_start` at `manual`
leaves `average_hrv_ms` at `oura_ble`, and that is Q-519's load-bearing assumption. **Whether any
consumer recomputes duration or efficiency from the span was not audited** — the entry states the
invariant the design needs, not that it currently holds everywhere. The ~23-minute figure assumes 13
otherwise-normal nights; the owner's actual window was not pulled. And **no sleep-session delete or
edit path exists**, which is why the answer is a proposal rather than an action.

<a id="2026-08-19-resolve-eaten-at"></a>

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

## Q-325, found while shipping this: the corrected timestamps would not have reached the device

`applyDelta`'s `food_logs` upsert (`lib/local-store/sqlite-backend.ts`) had an `ON CONFLICT DO
UPDATE` arm setting **only** `quantity_multiplier`, `updated_at`, `deleted_at` and `sync_status`. A
row the device already held could therefore never learn a server-side change to `date`,
`meal_type_id`, `food_item_id` or **`logged_at`** — so migration 203's corrections would have landed
in Postgres and stopped there, silently, on the one runtime that matters. The same gap is what
Q-412's reassign is about to walk into: `meal_type_id` is exactly the column it moves.

Fixed here rather than filed for later, because it is the sync half of this change — a correction
that does not reach the device is not a correction. The four columns are added to the update arm and
the `WHERE food_logs.sync_status='synced'` guard is untouched: that guard is what protects a pending
local edit, and the narrow SET was never the protection. Pinned by a test that asserts each column
appears in the conflict arm **and** that the guard survives; it was confirmed to fail against the old
statement before the fix went in.

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

<a id="2026-08-19-sandbox-energy-constants"></a>

# 2026-08-19 — `pnpm dev` can render the energy screens again (Q-361)

**Branch:** `fix/sandbox-energy-constants` · **Lane:** Implementation A

## What was wrong

`GET /api/nutrition/energy-balance` and `GET /api/body-metadata` returned **500 in every sandbox
session**, every time:

```
Error: ENOENT: no such file or directory, open
  '.../lib/oura-models/constants/energy-expenditure-features.json'
```

`lib/oura-models/constants/*` is gitignored — it left the tree in the public-repo cut (Q-49) and now
arrives at boot from object storage, which no session can authenticate to. The loader throws by
design (*"a missing constant is a wrong number, not a missing feature"*), which is right in
production and simply means "never present" here.

The cost was not a broken feature but a **broken verification surface**: the Energy card on day
detail, the energy bar on Nutrition and anything else reading those routes rendered nothing at all
locally. Any session that claimed a `pnpm dev` pass on those screens was claiming something it could
not have done.

A second, independent blocker sat behind it: the seeded user had no `date_of_birth`, so
`computeEnergyBalance` had no age and returned a null balance even once the constants were readable.
Both had to go or the fix was worthless.

## The entry's open question, now answered

Q-361 asked — correctly — whether CI hits this, and said to establish it before fixing. **It does
not, and here is each reason separately:**

- **Build** — the constants read moved off module scope to first use (deliberately,
  `workout-energy.ts:31`), so `next build`'s page-data collection never opens the file.
- **Tests** — `vitest.config.ts` already points `OURA_CONSTANTS_DIR` at
  `lib/oura-models/__fixtures__/constants` whenever the real set is absent.
- **E2E** — no spec navigates to either screen (`grep -rl 'energy-balance\|body-metadata' e2e/` is
  empty). Playwright's `webServer` runs `pnpm dev`, so its server had the same defect; nothing ever
  asked it for those routes.

Green in CI, dead locally — exactly the shape that trains sessions to stop believing local runs.

## What shipped

**The fix is smaller than the entry proposed, because the substitute already existed.** Q-361's
preferred option was for `scripts/local-db/setup.sh` to write a labelled stub. That would have been a
*second* fake constants set — hand-written, kept in step with nothing, living in a gitignored path
indistinguishable from the vendor's own files, and only on machines that ran the remote-session hook.

`scripts/generate-test-constants.js` already produces exactly the needed thing and commits it: every
key real, every **number** synthetic, derived from the loader's own file list, and the suite already
runs against it.

- `lib/oura-models/constants-delivery.ts` — `ensureConstantsAvailable()` now wraps the real delivery
  and, **outside production only**, falls back to those committed fixtures. The gate is `NODE_ENV`,
  not "did the bucket answer", for the same reason `instrumentation-node.ts`'s `fatalOrLoud` uses it:
  gating on credentials would substitute invented MET numbers in precisely the case that must fail —
  a production deploy that lost its storage variables. The fallback sits *after* the bucket attempt,
  so a machine with real constants or real credentials is unaffected.
- `instrumentation-node.ts` — the fixtures branch **warns** rather than informs. It is the one source
  whose numbers are wrong on purpose, and a boot line reading like a real delivery is how a session
  comes to quote a sandbox figure as if it meant something.
- `scripts/local-db/seed.sql` — the demo user gets a fixed `date_of_birth` (1993-06-15). Fixed rather
  than derived from `now()`: a moving value would make any energy figure computed from it drift
  between sessions for no reason.
- `lib/oura-models/__tests__/constants-delivery.test.ts` — two cases. One asserts the fallback serves
  the fixtures **and says `SYNTHETIC` in the boot detail**; the other asserts production never
  substitutes them. The second is the fail-closed half and is the point of the `NODE_ENV` gate.

## Verified, not assumed

Measured on `pnpm dev` against the local DB, running the full revert/restore cycle:

| | `/api/nutrition/energy-balance` | `/api/body-metadata` |
|---|---|---|
| `constants-delivery.ts` at `origin/main` | **500** | **500** |
| with the fallback | **200** | **200** |

Same database and same profile on both rows, so the difference is the delivery change alone. The
200 response carries `"missingProfileFields": []`, which is the seed's half — before the
`date_of_birth`, that list named `date of birth` and the balance was null.

Boot line now reads:
`[instrumentation] model constants: fixtures — SYNTHETIC test fixtures — every number is fake. could not list the bucket: SignatureDoesNotMatch (403)`

`seed.sql` was re-applied to a throwaway database built from all 203 migrations to confirm it still
parses and produces the new column.

**Not exercised:** nothing on-device, and nothing in production. This change cannot reach either — the
tree branch wins where the vendor's files exist, and the fixtures branch is unreachable under
`NODE_ENV=production`, which the second test pins.

**One thing worth knowing for the next session:** the numbers those screens now show locally are
**arbitrary**. The MET table is synthetic, so an energy figure from `pnpm dev` verifies *shape and
plumbing* and nothing else. Never quote one as a value.

<a id="2026-08-19-square-label-canvas"></a>

# 2026-08-19 — every label draws square, and the round constraint was costing 64% of the area (Q-411)

Lane B. v1.325.5. Canvas geometry only — no schema, no route, no APK.

## The owner's call

> *"could we just have this as a generic square? it will auto fit in the circle template when I need
> to print it - so they could all start as squares."*

## What the round assumption cost

The renderer reserved a centred **130 × 137** usable box — what survives a round crop once the
corners are given up — against a square **171 × 171**. That is 17,810 square units against 29,241:
the assumption was costing **64% of the area**, and three prior entries (Q-393, Q-397, Q-399) each
spent their effort designing around it. Q-399 in particular had to trim the header's type and gaps
just to get three ingredient lines onto the default.

`squareOnly` is gone as a concept — the type, the spec field, the picker's amber badge and the
"Square dies only" warning all with it. Nothing draws a circle, a die guide or a vignette; the round
die is a print-time consideration now.

## What the area bought

Every style's code grew, and the default gained a line at the same time:

| style | before | after |
|---|---|---|
| `band` — the tightest | 0.369 mm/module | **0.497** |
| `inlineCentred` — the default | 0.401 | **0.561** |
| `editorial` | 0.481 | 0.513 |
| `ticket` | 0.417 | 0.537 |
| `plaque` | 0.520 | 0.633 |
| `square` | 0.561 | **0.609** |

The centred stack's header drops from 86.5 units to **69.5** (the margin falls from 26 to 9), so the
default now draws **four** ingredient lines where it drew three — *and* a code 40% larger. The
budget was re-derived rather than left at its round-era numbers, which is what the entry asked for:
leaving them would have reserved the extra area and never used it.

`square` is the exception in that table and the exception is the interesting part. It was **already**
drawing on a square canvas before this change — it carried the `squareOnly` flag the change retires —
so it is the one style that gained no area here and had nothing to spend. The first draft raised it
from 70 to 90 anyway, reflexively, because every other style was being raised; the 20 units came
straight out of its ingredient list, taking three of the fixture's eight ingredients down to **one**
on the style whose own picker note promises the breakdown. That is the Q-399 failure shape exactly.
It is capped at 76 now — the largest code that still leaves three lines — which is 0.609 mm, ahead of
main's 0.561 on both axes rather than trading one for the other.

The E2E caught it by accident and now catches it on purpose. The assertion read
`/Printing \d+ ingredients — …/` and failed only because the sheet's copy pluralises: it saw
"1 ingredient", not "1 ingredients". Had the count been two the regression would have shipped. The
regex now carries an explicit `[2-9]` floor with the reason written beside it.

## ⚠ The gain is expected, not proven, and one print decides it

*"It will auto fit in the circle template"* has two readings that point opposite ways:

- **The template CROPS the corners** (circle inscribed in a 50 mm square) → the artwork keeps its
  50 mm width and the table above holds.
- **The template SCALES the square to fit inside the circle** → it lands at 50 ÷ √2 = **35.4 mm**,
  every module shrinks by 29%, and the default falls to **0.397** — *fractionally worse than the
  0.401 it replaces.*

So this ships described as **a simplification that is expected to improve scannability**, not as a
scannability improvement. If the template turns out to scale, the follow-up is to keep the square
canvas anyway — it is simpler and the content still benefits — but design the critical content
(name, calories, code) to sit inside the inscribed circle. The print is the same one Q-400 already
owes, and Q-400's delivery fix should land first since its saved PNG currently declares no physical
size at all.

## Two test thresholds raised, because they had stopped being tests

The entry asked for this and it was right: on a square canvas the old assertions could no longer
fail for any style.

- *"no style's module is smaller than the tightest shipped one"* — **0.36 → 0.52**. The tightest
  moved from 0.369 to 0.521, so the old floor was clear by 45%.
- *"the default draws the lines its picker copy promises"* — **3 → 4**, matching what it now draws.

The picker copy stays *"as much of the ingredient list as fits"*, and the overflow summary stays.
A bigger canvas does not make the list finite, and Q-399's lesson was that a style silently printing
**none** of it went unnoticed for a release.

### These are smaller than the entry predicted, and the reason matters

Q-411's entry derived a per-style table straight from the 64% area gain — `band` 0.52, `ticket` 0.61,
`plaque` 0.68. **Taking those figures directly does not fit.** `codeUnits` is bounded by where the
content stops, not by the area freed: the code is bottom-anchored while the name, calories, macros
and rule flow down from the top, so the binding constraint is vertical clearance.

Measured with the entry's numbers in place:

```
band       content ends 100.0   code starts 103.0   clearance   3.0
editorial  content ends  98.0   code starts  94.0   clearance  -4.0   ← code drawn OVER the text
ticket     content ends  95.0   code starts  92.0   clearance  -3.0   ← code drawn OVER the text
plaque     content ends  95.0   code starts  95.0   clearance   0.0
```

**Two styles were drawing the code straight through the macro line.** Each value is now the largest
that leaves 6 units of clearance, and a note above `StyleSpec` says to re-derive them if
`caloriesSize`, `macroSize`, `rule` or `writeOnLine` changes, since those four decide where content
ends. The gains are smaller than advertised and they are real.

## Plaque's rings broke, and the E2E caught it

Growing every code was not free. `plaque`'s "double ring" was two concentric **circles** at radius
`SHEET/2 − 6` and `− 9`, which cleared its 60-unit code and did **not** clear its 85-unit one: the
outer circle crossed the code's bottom edge at x ± 22.8 against a code spanning ± 42.5. The E2E's
decode of the rendered canvas failed on plaque alone — the one style whose framing is drawn *over*
the content area.

Circles were coherent while the inscribed circle was the binding constraint and are arbitrary on a
square canvas, so they became **two inset rounded rectangles**. They frame the same way, clear the
content by construction (the content box is inset 9; the frames sit at 5 and 8, outside it), and
match the shape the label now is.

Worth naming because it is the failure mode this change invites: enlarging every code moves content
into space something else already occupied. **And the E2E only caught one of the three collisions** —
it decodes four of the six styles, and `editorial` and `ticket`, both overlapping, are not among
them. Those were found by modelling the vertical flow, not by a test. A guard that covers two thirds
of the surface reports a third of the problem.

## What was NOT exercised

- **No print, which is the acceptance criterion.** Everything above is arithmetic and a browser
  render. The crop-versus-scale question is unanswered and it is the one that decides whether this
  helped or very slightly hurt.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- **Overlap was checked by the E2E's decode, not by eye** — and it caught one (plaque, above). Four
  styles have their rendered code decoded from canvas pixels, which fails if something overruns it.
  But a collision landing on the **ingredient text** rather than the code would not be caught, the
  other two styles are only checked for ink, and nobody has looked at all six at the new sizes.
- **The module grid is no longer fractional** — Q-358 landed here rather than waiting its turn, and
  the reason is that it had to. Resizing every code changed every module width, and the decode flake
  Q-399 thought it had bought margin against came straight back: `plaque` failed one run at 14.94
  device pixels per module, `square` the next at 17.02. A decode E2E that passes on a coin flip
  cannot gate the change that caused it. `drawCode` now paints in device space with a whole-pixel
  cell, and all four decoded styles passed on the first run afterwards.

<a id="2026-08-19-tuning-score-audit-trail"></a>

# 2026-08-19 — Can each score be re-audited later? (Q-525, Q-526)

**Agent:** Tuning 🎶 · **Branch:** `tuning/score-audit-trail` · **Docs-only.**

Every calibration review this month **reconstructed** contributor sub-scores from raw inputs instead
of reading them. This checks whether that was necessary. Over 96 `oura_daily_derived` rows:

| score | scored rows | trail stored | re-auditable? |
|---|---|---|---|
| sleep | 36 | 10 real sub-scores | ✅ |
| readiness | 35 | sub-scores **+ `provisional` flags** | ✅ |
| illness | 46 | all 4 biomarker z-scores, every scored row | ✅ |
| **activity** | 23 | **`{base, adjustment, trained}`** — the blend wrapper | ❌ Q-526 |
| resilience | 13 | — | Q-508 (dormant) |
| **chronic stress** | **0** | — | ❌ Q-525 — never produced a value |

## Q-526 — activity stores the wrapper, and it has already cost a measurement

`readiness-payload.ts` persists the blend wrapper into `activity_contributors` rather than
`computeActivityScore`'s six components — **which are in memory on the same request** as
`activityResult.components`, and are served to the client. They are just not written.

The cost is concrete rather than theoretical. Yesterday's contributor audit had to rebuild all six
from raw inputs, and could only do so **at today's goals** — `strengthFreqGoal` went 3 → 5 and the
volume target changed basis on 2026-08-11. So *"what did `strengthFreq` score on 2026-08-02?"* is
**unanswerable**, and the audit had to report a predicted sd ceiling instead of the real historical
spread. Sleep and readiness had no such problem on the same days. **Illness is the counter-example
that proves the point:** its stored biomarkers are exactly what let Q-506 diagnose a poisoned
temperature baseline from history rather than from a live capture.

**Sequenced before Q-505**, and Q-505 now says so. The redesign changes the contributor set; land it
first and the old model's history is gone permanently, along with the before/after comparison that
would show whether the redesign worked. The fix is one line at the existing persist site — merge,
don't replace, since `base`/`adjustment`/`trained` is real information.

## Q-525 — chronic stress has never produced a value

`chronic_stress_score` is NULL on all 96 rows. Third dormant score, after the illness radar (Q-506)
and resilience (Q-508).

The gate is stricter than it reads: `computeChronicStress` needs 21 complete nights of granular BLE
signals in a trailing 31-night window, and the step's own comment records the binding part — *"the
intermediate history is built from THIS pass's stashed signals"*. **Twenty-one good nights existing
is not enough; they must be present in one pass**, so a nightly incremental rollup can never satisfy
it however long it runs.

First action is deliberately a check, not a fix: confirm whether 21 qualifying nights exist at all.
If they do, this is a trigger problem needing no code. If they don't, it is coverage, and belongs
with Q-510. **A dormant score is not automatically a broken one** — the gate may be correctly
refusing to score on insufficient data, and relaxing it before knowing which would be the worse
error.

**Not Q-507.** That is `STRESS_HIGH_DAY_THRESHOLD_MIN`, *daytime* stress minutes driving the session
override, which does fire — on the wrong days. This is the separate vendored cumulative model. Noted
in both entries because the shared word invites a merge.

## A correction made before it shipped

The first pass of this review claimed illness stored no contributors, from a column grep filtered on
`%contributor%`. Illness stores them as `illness_biomarkers` — 46 of 46 scored rows. Caught by
reading the persist site instead of trusting the column-name pattern, which narrowed the finding from
"two scores keep no trail" to the correct "one score keeps the wrong one".

## Files

- `docs/reviews/2026-08-19-score-audit-trail.md` (new)
- `docs/implementation-backlog.md` — Q-525, Q-526 filed; Q-505 gains the Q-526-first constraint
- `docs/domains/activity/README.md`, `docs/domains/readiness/README.md`
- `scripts/check-doc-index-size.js` — backlog baseline 10916 → 10983
- `docs/agents/state/tuning.md`

## Not exercised

Docs-only; no code path changed. All measurement is `claude_ro`, **row-scoped to the owner** — 96
rows, one athlete. **Not checked:** whether the local SQLite mirror of these columns matches
Postgres (a device question), and whether the 25 rows lacking `model_versions` predate stamping or
lost it to the Q-518 clobber — that belongs to Q-518.

---

# Same PR — three owner decisions answered, and two asks withdrawn

The owner answered the open decisions. Two of their answers turned out to resolve questions I had
filed as needing *more* input from them, so the asks were withdrawn rather than carried forward.

## Q-523 — "use current recorded high and set a % off it, dynamically"

I had said this needed the owner to label "active days" before a Zone 2 floor could be fitted. **It
did not.** Following their instruction led to a larger defect that fits itself.

`resolveHrProfile` already computes what they asked for, and deliberately splits it in two:
`maxHr` refuses to drop below the age prediction (correct for %-of-max effort — a soft month must not
make ordinary efforts read as maximal), while **`targetAnchorMax` uses the corroborated observed max**
for reachable targets. Measured: age-predicted **187**, observed **167**. Active-minutes should use
the second. Dynamic by construction — it is a rolling 90-day order statistic.

**That alone only takes zero-minute days from 53/59 to 38/59.** The real defect:
`activeMinutesFromZoneSeconds` documents itself as implementing the WHO convention and is **one band
off it** — it calls Zone 2 (≥60% reserve) "moderate", but WHO/ACSM moderate is **40–59%** and 60% is
where *vigorous* starts. **Moderate intensity — brisk walking, stairs, carrying things — maps to no
zone and has been earning nothing by construction.**

Proposed: moderate `[0.40, 0.60)` ×1, vigorous `≥0.60` ×2, off `targetAnchorMax` (99–121 bpm ×1,
≥121 ×2 today). Zero days **53/59 → 6/59**, sub-score **~6 → 63.8 mean, sd 38.7** — which would make
it **the highest-variance contributor in the Activity Score**, above `steps` (33.4). The threshold is
published, not invented, and the sweep is smooth around 0.40 so a small max-HR error doesn't swing it.

## Q-524 — one step goal, AI-defined, manually overridable

`users.steps_goal` becomes the single source; `getDailyGoals()` reads it instead of deriving from
`activity_level`. **The AI half already exists** — `/api/nutrition-goals/recommend` computes a
recommended steps goal and `goal-recommendation-sheet.tsx` writes it to that exact column, with manual
entry beside it. So this is a read-side change plus a fallback, not a feature.

## Q-276 — Body Battery is "energy left"; Readiness is a morning starting number

Resolves to outcome (1): different questions. **Readiness needs no model change to match that
definition** — checked rather than assumed: all nine `READINESS_WEIGHTS` contributors are overnight or
previous-day measures, and nothing reads today's activity. So this is **a presentation change and
therefore Lane B's**, and the "wait for Q-272 before deciding" instruction no longer applies — the
owner decided what each score is *for*, which doesn't depend on where the correlation settles. The
+0.12 end-of-day figure stops being a defect: two numbers answering different questions need not agree.

## Q-72 — the sleep-rating ask, withdrawn

The owner explained the flat ratings: *"upon waking I don't feel instantly super rested or not
rested… generally it's a mid."* Measurement backs them completely. `sleep_quality_feel` is the **most**
variable self-report in the app (sd ~0.8, 5 values used); `perceived_recovery` is 0.36 across 2
values. **(Corrected 2026-08-19 — see the retired-scales note below; `resting_soreness` is a fossil,
not a live field.)** It also tracks
sleep better than the alternatives (vs efficiency **+0.316**).

Objective outcomes were tested too: steps **+0.210**, training volume **+0.028**, RPE **−0.023** — and
the last two are **structurally disqualified**, because volume is prescribed by the app (adherence
73.6% vs 73.1% planned) and `RPE_DEAD_BAND = 1.5` makes RPE deliberately insensitive. A number the app
dictates cannot validate another number the app produces.

**So the fix is the yardstick, not the rating** — which is what Q-72 said and my ask ignored. A rank
comparison of the 6 flagged-unusual nights against the 40 mid ones, re-run after ~3 weeks of history
under the recalibrated model, since every correlation here predates v1.319.0 and history is not
back-filled.

`mood_logs.energy_level` has the better *spread* (ok 35 / good 34 / low 4 / drained 2 — categorical
labels get answered where abstract magnitudes get a 3) and is worth adding as a secondary target. Its
−0.424 correlation with HRV is **flagged as a lead, not a finding**: it is the largest coefficient in
the review, points the wrong way, and Pearson on a 4-level ordinal with 92% of mass in two adjacent
levels manufactures exactly that.

## Added files

- `docs/reviews/2026-08-19-active-minutes-who-threshold.md`
- `docs/reviews/2026-08-19-sleep-validation-targets.md`
- `docs/implementation-backlog.md` — Q-523 answered, Q-524 + Q-276 decisions recorded, Q-72 updated
- `docs/domains/{activity,heart-rate,sleep}/README.md`

<a id="2026-08-20-home-card-invalidation-guard"></a>

## 2026-08-20 — Q-402's fix is guarded, and the Home-card fixture exists (Q-359)

**Branch:** `feat/home-card-invalidation-guard` · test-only, no runtime code changed, no version bump.

Q-359's remaining shell-level work was already done — the can-bite group reached zero in slice 4 —
so what the entry actually asked for next was the fixture: *"whoever takes this should build that
fixture first … because every Home-card guard needs it, and its absence is part of why a shell-only
staleness bug reached a user report."* Built, and used to drive Q-402 end to end for the first time.

**What Q-402 shipped and what was never proven.** The owner's report was *"requires a restart of the
app"*: Home's energy-balance card held its first payload forever. Eviction was never broken — six
write groups clear `energy-balance:` — but nothing asked the card to fetch again, and it lives in
the persistent tab shell, so its `useEffect(…, [])` never re-ran. `useCachedValue` +
`subscribeToInvalidation` are the missing half. **That fix merged unguarded.** Its PR tried three
times and measured *zero* `/api/nutrition/energy-balance` requests, because the harness could not
get the card on screen at all.

**Two fixture gaps, and one of them was described wrongly.**

| gap | as recorded | as measured |
|---|---|---|
| the profile the route needs | seeded user missing `height_cm`, `date_of_birth`, `sex` | it has height 180 and sex male — **only `date_of_birth`** is missing, and the route names exactly that one field in `missingProfileFields` |
| Home renders no cards | `DEFAULT_CARD_WIDGETS` is empty | correct as written |

So `ensureEnergyBalanceProfile()` is one column, `COALESCE`d over the other two so it stays right if
the seed changes, with a **fixed** date of birth — an age that drifts between runs would move the
BMR and every number resting on it. `enableHomeCards(page, keys)` sets `ta_ss_cards` through
`addInitScript` rather than driving More → Home Widgets, so an unrelated screen cannot break every
Home-card spec. Both live in `e2e/fixtures.ts` for the guards that come after this one.

**The guard asserts the request, not the number.** The mechanism under test is *"something asks for
a new value when a write clears the old one"* — a second GET is present only if that works, whereas
a changed figure could come from a remount and an unchanged one proves nothing. Asserting the
absence of staleness would pass either way, which is the Q-452 lesson.

The write is Home's own quick-log sheet, deliberately: **Home stays mounted throughout**, so a
refetch cannot be a remount, which is the entire distinction Q-402 is about. `POST
/api/body-metadata` → `invalidateBodyMetricWrite()` → `energy-balance:` cleared → second GET,
visible in the dev-server log in that order.

**Mutation-checked both ways.** Reverting `useEnergyBalanceToday` to the pre-Q-402
`useEffect(() => { cachedFetch(…) }, [])` shape makes it fail with its own message — *"the
energy-balance card did not refetch after a write cleared its cache key"* — and restoring the hook
makes it pass again.

**One local failure that was not a regression.** `goal-invalidation.spec.ts` went red on the full
run: it needs today's `body_metrics` row to carry a **steps** value, and this container's seed was
filled on 08-18, so 08-20 had no row. Exactly the aged-seed gotcha the Lane B baton records. Fixed
by topping up the row — a data change, not a code one — after which it and the new spec both pass.
CI provisions a fresh database every run and never sees it.

**Verification.** Full local Playwright suite: **28 specs, all passing** after the seed top-up.
`node scripts/check-fetch-once-effects.js` — OK, 12 known sites across 10 files, none new (no site
was converted in this PR). `pnpm check:rules` — Ran 50 of 50 Custom Rules steps, all passed.
`tsc --noEmit` clean.

**Not exercised.** The E2E harness drives the **web** build, where `getLocalStore` returns null, so
the offline-first branch of the write path never ran — the POST went straight to the API. Nothing
was checked on the S25, and no runtime code changed, so there is nothing new to check there.

**Still open in Q-359:** the twelve latent fetch-once sites. Every one unmounts on navigate, so none
can bite, and each needs judging individually rather than a codemod.

<a id="2026-08-20-non-idempotent-migrations"></a>

# 2026-08-20 — the four migrations that were retried on every cold start (PS-3)

**Branch:** `fix/non-idempotent-migrations` · **Lane A** · closes **PS-3**, files **LA-13**

## What was wrong

`054`, `055`, `082` and `157` each fail on a database that already holds their objects — a bare
`ADD CONSTRAINT`, a second bare `ADD CONSTRAINT`, an unguarded seed `INSERT`, and a `CREATE TABLE`
followed by ten `ADD COLUMN`s. A migration that fails never reaches `schema_migrations`, so all four
were retried on every cold start of the local dev database, forever.

The predecessor session's measurement is what set the scope: production has all four **recorded**
(`claude_ro.schema_migrations`, 206 of 206), so nothing re-runs there and nothing about this change
reaches it. This is a local and CI concern.

## What changed

Each file is now idempotent, using the pattern migration `003` already established:

| File | Guard |
|---|---|
| `054_users_email_unique.sql` | `pg_constraint` NOT EXISTS around the `ADD CONSTRAINT` |
| `055_friends_and_titles.sql` | the same, for `users_friend_code_unique` |
| `082_exercise_library_expand_2.sql` | `ON CONFLICT (name) DO NOTHING` on the 18-row seed |
| `157_scale_ble.sql` | `IF NOT EXISTS` on the table, both indexes and all ten columns |

**`157` is the one that mattered beyond noise.** A multi-statement migration is one implicit
transaction, so its first collision aborted the ten `ADD COLUMN`s behind it — the Postgres twin of
the local-SQLite failure that has left the Android store silently dead twice.

## Measured

- **Fresh database:** 206 applied, 0 failed, 0 already present.
- **The real dev database**, which held four unrecorded migrations: 202 recorded → **206**, 4 applied,
  0 failed. Re-run: 206 skipped, 0 failed. `exercise_library` stayed at 141 rows with zero duplicate
  names, so the seed did not re-insert.
- **Replay against a fully-applied schema** (`TRUNCATE schema_migrations`, run again): **205 of 206**
  apply cleanly.

## The one that does not replay, and why it is left alone

`001_initial.sql` fails that replay with `foreign key constraint "cardio_sessions_user_id_fkey"
cannot be implemented` — `002` renamed the column it references, so replaying `001` onto a modern
schema is incoherent rather than non-idempotent. It only arises by truncating the ledger by hand.

That replay is a check nothing in CI performs: `Migration Check` runs against a **fresh** database,
which is precisely the case where a non-idempotent migration cannot fail. Filed as **LA-13**, with
the `001` exemption recorded on the entry so it is not rediscovered.

## Not exercised

No APK, no native SQLite, no safe-area, no Samsung WebView, and nothing ran against production —
correctly, since production has all four recorded and the edits cannot execute there. Nothing
user-visible changed, so no version bump.

<a id="2026-08-20-orchestrator-sweep-completed-work"></a>

## Orchestrator sweep 1 — the completed-work baseline, cleared (2026-08-20)

The first run of the Orchestrator role. `scripts/check-backlog-pointers.js` carried a shrink-only
list of **17 queue entries whose heading announced its own completion**; the sweep's job was to work
it to zero, confirming each against a merged diff rather than against its own heading.

**Seven of the seventeen were finished.** Ten were not, and that ratio is the finding.

### What each turned out to be

| | entries | what happened |
|---|---|---|
| **Deleted — finished, nothing owed** | Q-107 · Q-139 · Q-170 · Q-207 · Q-213 · Q-217 · Q-32 | verified in a merged diff or in production, and any residual check is already tracked by a `projectOverview.md` row |
| **Kept with a `Keep:` line + `Gate: owner`** | Q-11 · Q-71 · Q-1b | the code shipped; each still owes the owner an action only they can take |
| **Retitled — never finished** | Q-149 · Q-219 · Q-254 · Q-270 · Q-298 · Q-394 · Q-500 | the heading announced a diagnosis, or one half of the work, or a fix production later refuted |

The baseline is now `new Set([])` and stays shrink-only: an ID may leave it, never join it.

### The one that mattered: Q-270 was marked FIXED FORWARD and is not fixed

`training_load_ots` was reported empty on 89 days, diagnosed as "nothing ever calls the route", and
closed on 2026-08-15 with a sync-provider warm-list entry. That entry set its own re-check condition:
*"Re-read `training_load_ots` in a day or two; if it is still 0, the diagnosis was incomplete."*

Five days on, `claude_ro.oura_daily_derived` holds **96 days with the column populated on 0 of them**,
and `active_calories_est` on 0 as well. Nobody had run the re-check. The entry is reopened 🔴 with the
measurement and one instruction: prove the route is called at all before re-measuring the four gates,
which were measured passing on 2026-08-15 and are the trap this entry has already fallen into once.

Q-298 is the same shape, more quietly: its heading read RESOLVED because the *cause* was found.
`log-exercise.ts:196` still zeroes the estimate on the phase-level deload while line 264 still stores
only the AI flag — the two-line fix it describes was never written.

### Q-213 and Q-107 closed on production evidence, not on their own say-so

Both entries said in their own text that they could only close on a production read. The whole
retained `error_events` window (2026-07-20 → 2026-08-19), grouped by day:

| day | connect-timeout | `/api/sync/pull` | body-battery + readiness-score | all events |
|---|---:|---:|---:|---:|
| 08-19 | 0 | 0 | 0 | 1 |
| 08-17 | **1** | 0 | 0 | 8 |
| 08-15/16/18 | 0 | 0 | 0 | 1 each |
| 08-13 | 16 | 1 | 2 | 757 |
| 08-12 | 39 | 0 | 2 | 2,556 |
| 08-09 | 33 | 1 | 3 | 2,615 |

All three families stop dead on **2026-08-13**, the day Q-213's stages shipped. The single
connect-timeout since then sits inside the unrelated `disk_full` outage of 2026-08-17, which the same
date's two `[pg 53100]` rows identify. The app was in use throughout — `set_hr_stats` rows were
computed on 08-15, 08-16, 08-17 and 08-19 — so the silence is not an idle account.

That evidence also closed two `projectOverview.md` Known Issues, moved whole to the archive: the
`/api/sync/pull` fan-out row (**the batching fix it proposed should not be built** — Q-213 established
the pool exhaustion was a symptom, not a cause) and the `/api/body-battery` + `/api/readiness-score`
row, whose "cause NOT diagnosed" now has a cause. The Q-213 row itself **stays live**: none of the
three stages has been exercised on the S25, and that gate is untouched by any of this.

### Also measured, and recorded where it belongs

- **Database: 178 MB total**, against a 171 MB baseline on 2026-08-18 — inside the ~0.4 MB/day trend,
  no row needed. `oura_raw_samples` is now 63 MB over 221,499 rows, which weakens Q-219's size case
  enough that the entry says so.
- **22 of 78 completed workout sessions still hold no per-set HR attribution**, and no bulk
  `computed_at` batch has landed since 2026-07-22 — the Q-11 backfill button has not been pressed.
- **85 rows still match the device-verification pattern and 3 carry no `needs:` tag at all**
  (tag census across the file: browser 31 · android 27 · data 11 · hardware 15). Q-254 now names the
  three by line.

### Verification

`pnpm check:rules` — **50 of 50**. `node scripts/check-backlog-pointers.js` — 204 entries, 0
baselined done-headings. `node scripts/next-item.js` places every entry. `anchor-source.test.ts`
re-run for Q-394: 3 passed.

Two traps recurred while archiving, both already documented and both caught by the gate rather than
by care: relative links shift by two directory levels moving from `projectOverview.md` into
`docs/overview/`, and an archived heading that names a still-live entry's ID reads as a duplicated
issue.

**Not exercised:** nothing here touched the app. Docs and one CI script. No runtime, no device, no
version bump.

<a id="2026-08-23-ai-fingerprint-granularity"></a>

# 2026-08-23 — The AI-usage screen's top row was an artefact of its own fingerprint

**Branch:** `fix/ai-fingerprint-granularity` · **Lane A** · Q-471

The double-trip metric on More → Developer → AI usage calls a request redundant when
`(user_id, section, fingerprint)` repeats inside 120 s. Three meal-plan sections fingerprinted on a
**rounded calorie target and nothing else**, so a deliberate reroll — tap reroll, dislike it, tap
again — was indistinguishable from the same call firing twice. It was the screen's top row:
**32 redundant · 4 distinct**, most plausibly four slots rerolled about eight times each.

## The fix

`lib/ai/instrument.ts` gains `contentKey(...parts)`: an 8-hex digest that turns free text into a
key, so it can enter a fingerprint without breaking that module's own rule — *"pass ids/dates/keys
only, never raw prompt text or health data"*. Empty in, empty out, so `stores: []` and no stores at
all still fingerprint alike.

| section | was | now also carries |
|---|---|---|
| `meal-plan-generate-meal` | rounded kcal | `avoidNames` — which includes the meal being replaced, so it changes on every reroll |
| `meal-plan-edit-meal` | rounded kcal | the instruction, and the meal it applies to |
| `meal-plan-generate` | `mealCount:dayTypes` | the kept meals, stores, excluded foods |
| `meal-plan-top-up` | rounded kcal | the meal name and what it is short of |

## Measured, on the real routes

`pnpm dev` against the local database, signed in, three POSTs to
`/api/nutrition/meal-plans/generate/meal` — two identical, one a reroll — and then the screen's own
query over `ai_call_log`:

```
meal-plan-generate-meal | 22ec3d34c81a5a06   ← call 1
meal-plan-generate-meal | 17744a6cdce1b8ec   ← call 2, one more name in avoidNames
meal-plan-generate-meal | 22ec3d34c81a5a06   ← call 3, identical to call 1

redundant_calls: 1   distinct_fingerprints: 2
```

Under the old fingerprint all three were `d98c061bfba1b3cc` — **2 redundant of 3, 1 distinct**. The
one redundancy that survives is the genuinely identical repeat, which is what the metric is for.

`/api/nutrition/meal-plans/generate` was driven twice, differing only by `stores`, and produced two
fingerprints where the old form gave one.

## One correction to the entry

It proposed fingerprinting `generate-meal` on "the meal `position` plus `avoidNames`". **There is no
`position` in that request** — the schema has no such field. `avoidNames` alone does the work, and
its own schema comment says why: *"Meals already in the plan — including the one being replaced — so
the reroll differs."*

## What this deliberately does not touch

The reroll UI. `meal-plan-review-step.tsx` already sets `rerolling` before the fetch and disables
every control on it; there is no tap-spam, and the entry exists partly to stop someone being sent to
that file by a misleading screen. **44 of the 89 redundant calls were this artefact. The other 45
are real** and belong to Q-470 and Q-469, which are now readable.

## Also in this PR

Q-545 is gated on the device. Its engine half is complete — the rollup reaches zero server-only
modules — and every remaining task (the drain wiring, the WASM instantiation check, the soak, the
single-writer flip) needs the S25, so it is not startable from a sandbox.

## Verification

Full suite **544 files / 4,488 tests** green · `pnpm check:rules` → **51 of 51** · typecheck and
lint 0 errors. `contentKey`'s determinism, empty-in-empty-out, order sensitivity and part separation
are pinned in `lib/ai/__tests__/instrument.test.ts`, alongside three cases stating the reroll-vs-
double-trip distinction directly.

**Not exercised:** `meal-plan-top-up` did not fire in the dev pass — it only runs when a meal cannot
reach its targets by scaling, and neither generated plan was short. It composes its fingerprint the
same way and is covered by the unit tests. Nothing here is device-dependent.

<a id="2026-08-23-bounded-scan-photo-payload"></a>

## 2026-08-23 — the food-scan photo is bounded before it is uploaded (BF-4, Lane B half)

**Branch:** `fix/bounded-scan-photo-payload` · **v1.333.4** · user-visible.

The owner reported *"the nutrition scan for images is alot slower than it used to be — from taking
the photo to getting the result is much longer than before."* BF-4's investigation had already
established the shape of the answer, including what it is **not**.

**Measured, in a real browser, on a 4000 × 3000 capture:**

```
4000x3000 -> 1024x768 | base64 2,266,776 -> 302,944 chars (-86.6%)
```

~2.2 MB of upload becomes ~300 KB. **Nothing is lost to accuracy**, and that is the argument that
makes this free rather than a trade-off: every image scan in a month of production reports
1,275–1,298 input tokens *regardless of the photo's size*, because Gemini normalises an image to a
fixed tile budget before the model sees it. Bytes above that budget do no model work — they are pure
upload latency, on the one leg nothing in the app times.

**1024 is chosen from that token budget**, not from taste, and the constant says so where it is
defined.

**Both client paths, because they were both unbounded.**

- `Camera.getPhoto` gains `width` / `height`. **These are `ImageOptions`' names — `takePhoto` uses
  `targetWidth`/`targetHeight`**, and both pairs are optional, so writing the wrong one type-checks
  and is ignored at runtime: a downscale that silently never happens. Verified against the pinned
  `@capacitor/camera` **8.2.0** source rather than from memory, per CLAUDE.md's external-field-names
  rule. (`getPhoto` also carries `@deprecated` in this version, pointing at `takePhoto` /
  `chooseFromGallery` — noted, not acted on; a migration would change which pair applies.)
- The gallery path `FileReader`'d the raw `File` with no resize. It now goes through the new helper.

**A shared helper, because this would have been the third copy.** `lib/media/downscale-image.ts`.
`more/profile-tab.tsx` (avatar) and `more/feedback-sheet.tsx` (screenshot) each had their own; the
rule is extract before a third. Two things the copies got wrong and the helper does not:

1. **`feedback-sheet` scaled by WIDTH alone** (`MAX_WIDTH / img.width`), so a portrait image — what a
   phone camera and this app's own 412 × 915 screenshots produce — kept its full height and most of
   its bytes. The helper fits the **longest edge**. `feedback-sheet` is converted to it in this PR;
   `profile-tab` is left alone deliberately, since a square centre-crop is a different operation, not
   a caller of this one.
2. Both leaked an object URL per call. The helper revokes on every path, success or failure.

**Tested where it can be tested.** Both vitest projects are `environment: 'node'`, so `Image` and
`canvas` do not exist — which is why the arithmetic is split out as a pure `fitWithin(w, h, maxDim)`
and that is what the eight new cases pin: longest-edge fitting in both orientations, aspect ratio
preserved, **never upscales**, and no zero dimension at an extreme ratio. Mutation-checked —
restoring the width-only divisor reds exactly the portrait case and the upscale guard, and nothing
else.

### What this does NOT do, which matters more than what it does

**It is not shown to be the owner's regression, and BF-4 says so itself** — Correction 2 demoted the
payload from prime suspect to a standing inefficiency, because `Camera.getPhoto`'s options have been
byte-identical since 2026-06-12 and the plugin's integrity hash has never moved. Something that
cannot have changed cannot explain a change. What shipped is a real, measured reduction on the one
leg with no instrumentation; whether it is *the* cause is untested.

**The named dated change is untouched.** #112 (2026-07-03) converted the route from `generateText` +
`JSON.parse` to `generateObject` + a Zod schema, 19 days before instrumentation existed — which is
why `ai_call_log` cannot see it. The schema / `maxOutputTokens` experiment BF-4 prescribes is a
**route** change and is Lane A's.

**"Photo → result" still has no number.** BF-4 asks for the client-side elapsed time to be recorded,
and it is not, because it needs a sink: `reportClientError` writes to `error_events`, which every
session reads at start-up looking for faults — timing rows do not belong there. Left to Lane A with
the server-side payload logging that entry already assigns it. **The entry stays queued**, annotated
with which half shipped.

**Not exercised.** Nothing on the S25 — and this is the one worth repeating, because the failure is
silent: only the gallery path can run in the sandbox, so **the `getPhoto` bound is unverified**. If
the field pair were wrong the downscale would simply not happen, which looks exactly like "the fix
did not help". Railway cold start on this low-traffic route is still untestable here.

**Verification.** 8/8 new tests, mutation-checked. `pnpm check:rules` — **Ran 51 of 51**, all passed.
`pnpm lint` 0 errors. `tsc --noEmit` clean.

<a id="2026-08-23-calorie-progress-bar"></a>

# 2026-08-23 — the calorie bar becomes a progress bar, and Home's ring counts down (Q-323)

**Branch:** `feat/calorie-progress-bar` · **Lane B** · v1.336.0

Q-323's last two pieces. Its budget half shipped in v1.335.0 (#320), which is what unblocked these:
a progress bar is only worth drawing once the number it fills toward is right.

## A premise correction, made before building

The entry's first item says *"the macro ring shows its remainder in grey"* and describes it as
*"a full 360° split by macro"*. Those are two different components. The **Nutrition tab's**
`MacroRing` already sweeps a brand-coloured arc over a grey track — it has done the asked-for thing
all along. The 360° macro split is **Home's donut**. So item (1) is a change to Home, and the
Nutrition ring needed nothing.

Worth recording because the entry would have been implementable as written, on the wrong component,
and the result would have looked done.

## What shipped

| file | change |
|---|---|
| `packages/shared/src/nutrition/calorie-balance.ts` | `barProgress()` added; `barPosition`/`barBands`/`BAR_SCALE_KCAL` deleted — no callers left |
| `components/nutrition/calorie-progress-bar.tsx` | **new** — the bar |
| `components/nutrition/calorie-zone-bar.tsx` | draws the progress bar; the three gauge labels go |
| `components/home/home-energy-balance-card.tsx` | same bar — the sibling-surface rule |
| `components/home/home-nutrition-card.tsx` | donut → progress ring with a grey remainder |
| `e2e/calorie-progress-bar.spec.ts` | **new** — two cases |

**The x-axis is intake, from 0 to `budget + OUTER_KCAL`**, so the notch sits at the budget and the
tail past it is exactly the far-over threshold — long enough to read, short enough not to look like
a second target.

**The stops sit on the real thresholds, and that is the whole design.** A literal five-band reading
would make the on-target stripe `ON_TARGET_KCAL / (budget + OUTER)` wide — **under 6% of the bar**
on a 2,180 kcal day, too thin to see. Returning colour *stops* rather than band widths lets the
gradient interpolate: green is exact at the notch and blends across the ±150 window, so the green
region reads about as wide as it truly is while every boundary stays where `balanceZone()` puts it.
The fill is that same gradient clipped to `fillPct` with `backgroundSize` holding it to the full
track width, which gives the owner's *"the fill takes the colour of the band it currently ends in"*
for free — and means the bar's colour cannot drift from the zone label printed beside it.

## Two things the sandbox caught that would have shipped

**`var(--accent-red)` does not exist.** The ring's over-budget colour was written against it; there
are only `--accent-amber`, `--accent-cyan`, `--accent-foreground`, `--accent-green`, `--accent-purple`.
A `var()` that resolves to nothing paints transparent, so the ring would simply have vanished when
you went over — the silently-undefined-utility failure this repo has shipped before. It now takes
`balance.zoneColor` from the payload, which is the same colour the bar and the "Over" label use.

**At 0.28 opacity the empty track read as a full pink bar.** Screenshotted at the S25 viewport with
nothing logged, the dimmed ramp was indistinguishable from a fill. A neutral `bg-muted` base under
the ramp at 0.16 fixes it: empty reads as empty, and the fill is unmistakably the fill.

## Verification

Asserted through the rendered **geometry** (`data-fill-pct` / `data-notch-pct`), not a screenshot: a
pixel baseline pins how it looks and rots on the next style change, while the fill reaching
`intake / (budget + OUTER)` and the notch sitting at `budget / (budget + OUTER)` pins what it
*means*, which is the thing that changed.

Mutation-checked, both caught:

| mutant | result |
|---|---|
| bar → centred gauge (fill 50%, notch 50%) | ✗ failed |
| ring centre → eaten instead of remaining | ✗ failed |

`barProgress` also has seven unit tests, including a budget smaller than `OUTER_KCAL` (where
`budget - OUTER` goes negative and stops collapse onto 0 — the clamp has to leave them ordered or
the gradient renders backwards) and a zero budget.

Gates: `pnpm check:rules` 52 of 52 · full unit suite · full e2e suite · build clean.

## Not verified

**Nothing ran on the S25**, and for a purely visual change that is the gap that matters most. The
gradient, the notch and the conic-gradient ring were judged at the 412 px viewport in Chromium; the
Samsung WebView compositor is the known hazard for exactly this kind of drawing (it is why the ring
uses a masked conic-gradient rather than an SVG stroke in the first place). Colour choices were also
only seen in the light theme.

<a id="2026-08-23-constants-injection"></a>

# 2026-08-23 — The Oura rollup reaches zero server-only modules

**Branch:** `feat/inject-oura-constants` · **Lane A** · no behaviour change

Last of today's Q-545 work. The [extraction](#2026-08-23-oura-rollup-io-port) ported the I/O, the
[runtime injection](history-2026-08-24.md) ported the models, and the one edge left was
the constants loader. It is closed.

`lib/oura-ble/rollup/run.ts`, walking its import graph on value imports only:

| | modules | server-only edges |
|---|---|---|
| after the extraction | 50 | 5 |
| after the `sourceRank` move | 50 | 4 |
| after the runtime injection | 46 | 1 |
| **now** | **45** | **0** |

No `node:` builtin, no `onnxruntime-node`, no driver. The rollup is a function of its inputs.

## What changed

Four ports read vendored constants and each read them off disk itself:
`steps-motion-decoder`, `daytime-stress`, `stress-resilience`, `cumulative-stress`. They now take
them by **injection**, the mechanism Q-221 built for the first of the four when a static JSON import
turned out to be serving Oura's numbers from `_next/static` with no session.

`lib/oura-models/constants-inject.ts` → `ensureServerOuraConstants()` is the one remaining module
that reads the directory. It runs at boot (`instrumentation-node.ts`, right after the delivery step
that already blocks boot on these files), inside the rollup worker's own `worker_threads` realm, and
at the rollup composition roots. It is idempotent, so an unsure caller can just call it.

`step-counter-pipeline` used to inject the steps-decoder table from disk **itself**, mid-pipeline.
That single line is why `node:fs` stayed in the rollup's graph long after everything else portable
had moved out.

## The failure mode, and why the test exists

Every one of these ports **throws** when its constants are unset rather than defaulting — inherited
from the disk loader, and correct: a missing constant is a wrong physical number, not a missing
feature. So a forgotten injection site is a hard production failure, and the two sites that are not
a Next request path are exactly the ones easy to miss — boot, and the worker realm, which inherits
`process.env` but not the main thread's injected values.

`lib/oura-models/__tests__/constants-inject.test.ts` pins the coverage list and the throw-not-default
contract. Deleting one line from `ensureServerOuraConstants` turns it red — checked, not assumed.

## Two things this turned up

**The count was wrong, and a grep is what got it wrong.** The queue entry said three getters. There
are four: `cumulative-stress.ts` imports its constants **relatively** (`from './constants'`), and
the scan that produced the three-row table only matched the `@/lib/…` form. The import-graph walk
caught it. If you re-measure this class of thing, walk the graph.

**A new file under `lib/oura-models/constants/` is silently untracked.** `.gitignore` excludes that
directory (the vendored data left the repo in Q-49) with an explicit negation per code file, so the
injector I first wrote there was never committed — while every local gate passed, because the file
was on disk. CI's Build would have caught it; nothing local would have. It now lives at
`lib/oura-models/constants-inject.ts`, beside `constants-delivery.ts`, which sits outside that
directory for the same reason.

## Verification

Full suite **544 files / 4,481 tests** green. `pnpm check:rules` → **51 of 51**. `pnpm build` clean;
`scripts/build-rollup-worker.mjs` bundles.

`pnpm dev` against the local database, signed in as the seeded user — the routes that reach these
constants past their auth gate:

| route | | reads |
|---|---|---|
| `GET /api/body-battery` | 200 | daytime-stress constants |
| `POST /api/weekly-digest` | 200 | resilience constants |
| `GET /api/oura-ble/decoder-constants` | 200 | steps-decoder table |
| `GET /api/oura-ble/step-counter-export` | 200 (as admin) | — |

**Stated honestly:** the last one returns `hasAnchor: false` on seed data, so its `ensure` call ran
but the pipeline body did not — that path is covered by `step-counter-pipeline.test.ts` and the
rollup suite instead. Cumulative-stress has no simple route and is covered the same way.

**Not exercised:** on device. Nothing here changes a runtime path on the server, and the device
rollup does not exist yet.

## What is left of Task 3

The device half, and nothing in the engine blocks it: a `RollupIO` over the local store, a
`ModelRuntime` over `getWebSession`, and a constants fetch following
`lib/activity/steps-decoder-constants-client.ts`. The route that serves the steps-decoder table
would need to serve the other three — deliberately **not** built here, because an auth-gated
endpoint exposing more vendored numbers with no consumer is surface without a reason.

<a id="2026-08-23-day-screen-edit-delete"></a>

# 2026-08-23 — Edit and delete for logged training, back on the day screen (LB-1)

**Branch:** `feat/day-screen-edit-delete` · **Lane B** · v1.334.0

## What shipped

`/health/day` now carries the four controls that went missing with Q-110: edit and delete on every
exercise row, delete on every session card, delete on every activity. `day-overlay-dialogs.tsx` is
reused **unchanged**, so the edit sheet and both confirmations are the ones already written and
approved — this is a relocation of controls, not a redesign.

| file | change |
|---|---|
| `lib/hooks/use-day-entry-mutations.ts` | **new.** The four handlers plus their dialog state |
| `components/health/day-detail/day-sections.tsx` | `TrainingSection` / `ActivitySection` gained the controls — the file had **zero** interactive elements before |
| `app/health/day/day-detail-content.tsx` | wires the hook, renders `DayOverlayDialogs` |
| `app/health/day/page.tsx` | passes `userId` through, for the local-store mirroring |
| `app/health/health-content.tsx` | its own four handlers deleted; now calls the same hook |
| `e2e/day-entry-edit-delete.spec.ts` | **new.** Four cases |

## Decisions

**The controls went on `/health/day`, not back on the sheet** — the owner's call, from the three
options in the LB-1 entry. It is where the calendar tap already lands, and Q-110 moved there for
sleep, body composition, scores and the whole-day HR trace that the sheet does not show.

**One hook, two callers.** The obvious shape was to copy the handlers onto the day screen, which
would have left two copies of four write paths — exactly the drift the "one write function per
domain" rule exists to stop. `health-content.tsx` was moved onto the same hook in the same PR, which
also took ~150 lines out of a listed 800-line hotspot.

**The date is read at action time, from `dateRef`, not captured at render.** This was the reason the
entry was owner-gated: the screen swipes between days, and a handler holding a stale date on a
screen whose whole job is changing dates could refresh the wrong day. Two things make it safe — the
entities are addressed by `exerciseLogId` / `workoutSessionId` / activity `id`, never by date, so
*what* is written is never in doubt; and the refresh targets whatever day is on screen when the
dialog is confirmed, which is the one the user is looking at.

**The post-write refetch does not re-seed.** `load(date, { seed: false })` keeps the current paint
while the fresh payload lands. Seeding after the caches were just cleared would blank every section
for the length of the round trip — the instant-paint rule, applied to a mutation.

**`day-overlay-sheet.tsx` was NOT deleted.** It still owns three affordances the day screen has not
got (exercise-name tap → `ExerciseHistorySheet`, activity tap → `ActivityDetailSheet`, per-session
HR recovery expander), all unreachable since Q-110 as well. Deleting the file would have discarded
them silently; filed as **LB-3** instead.

## Gotcha worth keeping

`.click()` does not work on these screens under Playwright — it dispatches a mouse-only sequence
that never produces a `click` event, already measured and written up on
`water-log-write-path.spec.ts` (Q-354). The first run of the new spec read exactly like the controls
were wired to nothing: the button was found, clicked without error, and no dialog opened. A DOM
`el.click()` opened it, which is what separated a harness artifact from a product bug.
`page.touchscreen.tap()` is the path that works, and is how the product is actually used.

## Not verified

**Nothing ran on the S25.** The 48dp targets and the confirm dialogs' safe-area clearance were built
to the rule but the web sandbox renders insets as 0. The local-store mirroring inside all four
handlers also never executed — `getLocalStore` returns null on web — so the offline half of every
write is verified by reading only. Recorded as a Known-Issues row rather than struck.

<a id="2026-08-23-feat-oura-autopack"></a>

# 2026-08-23 — the raw-frame packer runs itself (Q-541 Task 6)

**Branch:** `feat/oura-autopack` · **Lane A** · server/JS only, ships via Railway — no APK, no migration.

## What this closes

Q-541 is complete. Tasks 0–4 built the two-tier store, the codec, the readers and the packer; Task 5
ran the backfill by hand on 2026-08-18; Task 7 removed the last two readers of the stored
`measured_at`. What was left was the thing that makes it a system rather than a button.

**Task 5 is verifiably clean in production, which is the evidence Task 6 was gated on.** Measured
2026-08-23: `oura_raw_packed` holds **764 blobs / 941,233 frames / 13 MB**, and its ds range
(1,396,593 → 31,734,854) runs contiguously into the hot tier's oldest (31,104,070). ~14.5 bytes per
frame against ~328 bytes per row.

**And it showed why a button is not enough.** That run pruned `oura_raw_samples` back to 2026-08-10.
Five days later the table was **318,183 rows / 92 MB** again — ~6.5 MB/day, against the ~0.4 MB/day
the database as a whole is supposed to grow at. The packing was never the missing piece; running it
was.

## What shipped

`insertOuraRawSamples` now fires a bounded pack after storing its batch. There is no cron layer
(module-map §0), so it rides the ingest path like the other retention jobs — with two differences
that follow from what it deletes:

- **The throttle is per user, not per process.** Every other prune uses one module-level timestamp.
  With two ringed users that lets the busier one claim every window and the other's table never gets
  packed at all. The cost of keying it is a `Map` sized by real users.
- **It claims rather than checks.** `claimAutoPackSlot` tests and sets in one step, so two batches
  arriving together in one process cannot both start a run. It does not coordinate across replicas
  and does not need to — concurrent runs are safe by construction (`ON CONFLICT DO NOTHING`, a verify
  that re-reads what is committed, a delete that names row ids) — it just avoids the wasted work.

`OURA_AUTOPACK=off` stops it without a code deploy. Nothing depends on it running: the readers span
both tiers, so the only consequence of turning it off is the growth curve.

## The delete had a race, and automating it is what made the race reachable

Phase 3 deleted by the bucket's ds **range**. A frame arriving between the select and the delete was
therefore removed *having never been packed* — in neither tier, and nothing would ever say so. The
quiet guard (`max(recorded_at) < now() - 1 day`) makes the window narrow, but firing the packer from
the ingest path is precisely arranging for it to run while frames are arriving, and narrow is not
the same as impossible.

It now deletes **by primary key**, so the deleted set is provably a subset of what the verify proved.

The test reproduces the interleaving deterministically with a Postgres trigger on the blob insert —
which is after the rows were read and before the delete, and nothing else can put a row there at that
instant. Against the range delete it fails (`expected +0 to be 1`).

## Refusals now reach `error_events`

A refusal is the packer declining to delete frames it could not prove were stored — the most
important signal this pipeline produces. It used to be returned to whoever pressed the button. With
no caller it would have stopped at a log line and vanished at the 30-day prune, so it is written to
`error_events` with `url='oura-autopack'` as well. New ops-doc row: **I28**.

## Verified

- `oura-raw-pack.test.ts` 19/19 (two new: the race, and the aftermath — a bucket whose blob no longer
  describes the hot rows is refused, never reconciled by overwriting a verified blob).
- `oura-autopack-ingest.test.ts` 3/3 — the only test that proves anything *runs* the packer.
  Everything else would pass against a packer wired to nothing, which is exactly the state that let
  the table regrow.
- Two mutations, each applied and reverted: reverting to the range delete fails the race test;
  unwiring the ingest call fails 2 of the 3 ingest tests.
- Full suite **562 files / 4,612 tests**; `pnpm check:rules` **54 of 54**.
- **`pnpm dev`, through the real HTTP route**: logged in as the seeded admin, seeded 8 cold frames in
  bucket 500, `POST /api/oura-ble/samples` → `200 {"stored":1}`, and 3 s later the hot tier held 1 row
  and `oura_raw_packed` held one 102-byte blob of 8 frames.
  `[oura-autopack] packed 1 bucket(s), 8 frames -> 102 bytes in 20ms; 0 left`.

**Failure surfaces NOT exercised:** production itself — no Railway deploy has run this, and the
production table has 315k rows against the dev fixture's 8, so the per-run cost is projected rather
than measured. No device, native, safe-area or UI path is touched (server JS only), so the
device-verification gate does not apply. The 92 MB high-water mark will **not** shrink on its own:
deleted rows leave dead tuples that new inserts reuse, so the table stops growing but does not give
space back until a `VACUUM FULL` — that is Q-315, still `Gate: owner`.

## Sizing, from the measurement rather than from caution

The batch size was 8 on a first pass and the arithmetic behind it was wrong. Four runs a day of 8 is
32 buckets against **22.5 arriving** — a net of 9.5, which converges but would take **~12 days** to
absorb the backlog that exists right now (measured in production 2026-08-24: **115 eligible buckets
holding 140,487 frames**). The 2026-08-18 backfill packed **764 buckets in 246 s** — **0.32 s per
bucket** — so 25 a run is about **8 seconds** of background work every 6 hours, and the backlog is
gone in a day and a bit. That is what makes the follow-up `VACUUM FULL` one press rather than
something to repeat as the tail dribbles in.

**What to check after the deploy:** `oura_raw_samples` row count should stop climbing and settle at
roughly 7 days of frames (~160k), and `oura_raw_packed` should gain ~22 blobs a day.
`select count(*) from error_events where url='oura-autopack'` should stay 0.

<a id="2026-08-23-food-logging-complete"></a>

# 2026-08-23 — "I've finished logging", and the counter that makes it mean something (Q-387)

**Branch:** `feat/food-logging-complete` · **Lane B** · v1.337.0

Q-387's Lane A half shipped on 2026-08-19: the column, the route, the sync, and
`estimateMaintenance` filtering on a completeness flag instead of `intakeKcal > 0`. **Nothing could
set that flag**, so every day was excluded and the calibration could never leave `source: 'formula'`.
This is the control.

## Why the flag exists

The maintenance estimate averages the intake of every logged day, and a day abandoned after lunch is
byte-for-byte identical to a completed light one. Measured on the Lane A half: 14 days at a true
2,600 maintenance, six stopping at 1,400, estimated **2,086** — 514 kcal low, at
`confidence: 'medium'`, with nothing flagged. That figure reaches `targetFromMaintenance`, so the
error lands on the recommended daily target with a cut's deficit on top.

## What shipped

`components/nutrition/food-logging-complete.tsx`, rendered as the **last** element of the Nutrition
day's scroll. That placement is the entry's, and it is right: "I have finished logging" is a claim
about the whole day, so it belongs after everything the day contains rather than in the header beside
a running total.

- **The button becomes a receipt with an Undo.** A day marked by accident has to be reversible —
  the whole premise is that a wrong day poisons the estimate.
- **The counter ships with it, not after.** "N of 10 days marked · M more to calibrate", or the
  calibrated wording once it clears. The button feeds something otherwise invisible, and that
  invisibility is why this reached the owner as a question about the model rather than a bug report.
- **The copy says what *not* pressing it does**, which is the half that matters: an unmarked day is
  ignored, not counted badly.
- **Past days can be marked, and that is the common case.** Today is excluded from the calibration
  window entirely, so a control that only ever marked today could never move the estimate on the day
  you pressed it.

## Decisions

**`day-checkin:` was added to `invalidateNutritionWrite()`** rather than given its own group. The
flag is the only field this component reads, and finishing a day's food logging is the **only**
writer of it — the check-in sheets `COALESCE` that column rather than setting it — so no other path
can make the key stale. `lib/cache-groups.ts` is a Lane A path; this one line is claimed in the
baton with that reasoning.

**Q-359 is closed out in the same PR.** Its shell half finished in v1.325.9 with the can-bite group
at zero; the twelve remaining sites all unmount on navigate, so they are latent by definition, and
`scripts/check-fetch-once-effects.js` freezes them shrink-only. Converting them would add refetches
with no reader waiting — the entry's own "this is not a codemod" applies to its own remainder.

## Verification

The guard asserts the flag **in the database**, not the UI's own state: the control flips
optimistically, so a button wired to nothing looks identical on screen. It also asserts the counter,
because a control that wrote the flag and told the user nothing would pass a button-only test.

| mutant | result |
|---|---|
| the write is skipped, UI flips anyway | ✗ failed |
| the counter renders nothing | ✗ failed |

**A harness lesson worth carrying:** `toBeVisible()` does not mean "in the viewport". This control is
the last element of a long scroll, so its bounding box was off-screen and `touchscreen.tap()` landed
on whatever happened to be at those coordinates — the flag never moved and it read exactly like a
dead button. `scrollIntoViewIfNeeded()` before taking the box fixes it. (The `.click()` mouse path
does not work on this screen at all — Q-354.)

Gates: `pnpm check:rules` 52 of 52 · full unit suite · full e2e suite · build clean.

## Not verified

**Nothing ran on the S25.** The button clears the 48dp floor by assertion, but it sits at the end of
a scroll above the tab bar, so its clearance under the gesture bar is exactly the thing the sandbox
renders as zero. The offline path is also unexercised: this write has no outbox domain, so marking a
day complete with no network fails visibly rather than queueing — acceptable for a once-a-day action
whose value is in the calibration window rather than in the moment, but untested on a real device.

<a id="2026-08-23-free-activity-metrics"></a>

# 2026-08-23 — heart rate, steps and elevation on the free walk (Q-418, screen half)

**Branch:** `feat/free-activity-metrics` · **Lane B** · v1.339.0

The free-activity screen rendered distance, pace and cadence and **no heart rate at all** — while
the owner's mid-walk screenshot read `120 spm · strap`, meaning the strap was connected and
streaming beats at that moment. The data was already being persisted afterwards
(`done-activity-screen` stores `avgHr`/`maxHr` from `hr-window`), so HR was recorded for these walks
and invisible only *while walking* — the one time it is actionable.

## What shipped

| file | change |
|---|---|
| `components/activity/hr-readout.tsx` | **new** — live bpm with the guided walk's `STALE_MS` guard |
| `components/activity/activity-secondary-metrics.tsx` | **new** — running step total, elevation gained |
| `components/activity/active-activity-screen.tsx` | primary row distance · pace · **HR**; secondary line below |
| `components/guided-walk/walk-active.tsx` | the same step readout |
| `lib/activity/cadence-tracker.ts` | `stepsEstimate` on the snapshot |

**Both readouts are leaves with their own subscriptions**, like `CadenceReadout` beside them. A
strap reports about once a second and this screen renders a route map; putting beats in the screen's
state would re-render the map on every one. That is the repo's own render-discipline rule, and the
existing cadence component's comment says exactly why.

**`stepsEstimate` is derived inside the tracker**, from `summarizeCadence` — the function that
already fills the saved `steps` field (Q-230). A second integration on a screen would be a second
answer to "how far did I walk".

**Steps and elevation are hidden, never zero.** The step total is integrated cadence and is
**strap-only**: with no strap it does not exist, and `0 steps` after forty minutes reads as a broken
counter rather than an absent sensor. Elevation is the same on a flat route.

## Decisions

**Average pace was not added.** It is one of the entry's two *proposed* metrics rather than the two
the owner asked for, and the recommended layout — distance · pace · HR primary, cadence · steps ·
elevation secondary — has no sixth slot. Four `text-2xl` figures fit on 412 px; six do not.

**The guided walk got the step readout in the same PR**, which is Q-410's half of it. The entry is
explicit about why: a metric on one walk screen and not the other is how the free walk became the
forgotten surface to begin with. Q-410 is annotated so its next taker does not redo it.

## One thing worth checking, and checked

`HrReadout` calls `mgr.stop()` on unmount, and the **same strap** feeds the cadence reading on that
screen — so the obvious worry is that leaving the screen kills cadence. It does not:
`ChestStrapSource.stop()` detaches the live relay and **leaves the foreground service running** (its
own comment says so — that service is all-day, torn down only by unmounting the app or unpairing),
and cadence reads the accelerometer through `getPolarBle()` independently of this manager. Recorded
in the component, because the next reader will have the same worry.

## Not verified

**None of this ran on a device, and for this entry that is most of the verification.** Every number
here comes from a Polar H10 over BLE: the sandbox has no strap, so `HrReadout` renders its `--`
placeholder and `stepsEstimate` is null on every path exercised here. What was checked is that the
layout holds and nothing throws; what was *not* checked is the thing the entry is about — that a
connected strap puts a live bpm on that screen. **The staleness guard is likewise untested against a
real dropout.** The APK is the only place to see either.

**The Android pill is untouched and stays open as Lane A.** The background-geolocation plugin's
whole surface is `addWatcher`/`removeWatcher`/`openSettings`; `backgroundMessage` is fixed at
watcher creation, and re-adding the watcher to change the text would restart location tracking
mid-walk. That needs a native addition, which needs an APK.

<a id="2026-08-23-one-calorie-budget"></a>

# 2026-08-23 — one calorie budget, on both surfaces (Q-415 / Q-417, and Q-323's render half)

**Branch:** `fix/calorie-budget-surface` · **Lane B** · v1.335.0

## What was wrong

Three calorie budgets were live on one screen, from the same data:

| surface | expression | value |
|---|---|---|
| zone bar (both Energy Balance cards) | `restingBase + targetNet + activeKcal` | **2,180** ✅ |
| Home nutrition donut | `calorieGoal + activeEnergyKcalToday` | **2,451** (+271) |
| Nutrition tab ring | `targets.calories + burnedForSelectedDate` | **2,001** (−179) |

The visible consequence sat on one card: the ring printed **"Goal reached"** against 2,014 eaten,
because 2,014 clears its 2,001 — while the Energy Balance card two rows above said *"166 kcal left
today"*.

Both wrong figures were the **same** mistake in two places: `nutrition_targets.calories` is the
**rest-day floor**, not `restingBase + targetNet`, so adding movement to it produces a quantity that
matches nothing else. The ring was additionally 179 low because `activeEnergyKcalToday` was painted
optimistically from the local store ahead of the `body-metadata` fetch, with **nothing sequencing
the two** — and the local sum sees no strength sessions, no steps, and a Guided Walk writes
`caloriesBurned: null` (Q-96).

## What shipped

Both surfaces now read `budgetProvenance(balance).total` — the same function the provenance line
under the bar uses, so the number and the sentence explaining it cannot disagree.

| file | change |
|---|---|
| `components/home/home-nutrition-card.tsx` | **new.** Split out of the card switch so it can hold `useEnergyBalanceToday()`; a hook cannot live in a `switch` branch |
| `components/home/home-card-widget.tsx` | −53 lines; the donut branch is now one element |
| `app/nutrition/nutrition-content.tsx` | budget and macro grams both from the payload; the optimistic burn paint **deleted** |
| `components/nutrition/macro-ring.tsx` | `calsBurnedToday` → `earnedKcal`; "from cardio" → "from movement" |
| `app/session-select/session-select-content.tsx` | `activeEnergyKcalToday` removed — nothing reads it now |
| `e2e/one-calorie-budget.spec.ts` | **new.** Three cases |

**Q-417's suggested fix was "track which source last wrote".** Reading the budget from the payload
was better: `activeEnergyKcalToday` then has no consumer on either screen, so the optimistic paint
and its unsequenced race were **deleted** rather than ordered. A race you removed cannot be lost
again by a later edit.

**Q-323's render half rode along** — the ring shows `macroTargets.scaled`, which the server has
returned since #218 and nothing was reading. With 551 earned the card reported fat *over* when it
was well under.

## Verification

Each surface is asserted against **the route's own arithmetic**, never against the other: two
screens agreeing is not the property that matters, and they agreed before Q-401 too, on a wrong
number. The spec also asserts the expected budget **differs from `storedGoal + earned`** before
looking at any pixel, so a revert cannot pass by coincidence.

Mutation-checked, all three reverted expressions caught:

| mutant | result |
|---|---|
| ring budget → `targets.calories + earned` | ✗ failed |
| ring macros → `macroTargets.base` | ✗ failed |
| Home budget → `calorieGoal + activeKcal` | ✗ failed |

**The earned kcal in the fixture comes from a heart-rate session, not a logged walk.** The MET table
is a vendored constant this sandbox serves as synthetic fixtures, so an activity estimates to 0 here
and `earned` would be 0 — under which the old and new expressions differ only by the base and the
scaled macros equal the stored ones, i.e. two of the three assertions would prove nothing.
`estSessionKcal` prefers its HR estimate (Keytel), which is pure arithmetic over age/weight/sex/bpm.

Gates: `pnpm check:rules` 51 of 51 · 4,496 unit tests · 37 e2e (full suite) · build clean.

## Found on the way, not fixed here

**Q-417 part (a) has a cause, and it is not a missing eviction.** That entry asked whether the write
which logged 42 kcal invalidates `energy-balance:`. It does — `logFoodEntries` awaits
`invalidateNutritionWrite()` — but on the line **before** `pushMutations()`, which is
fire-and-forget. So the eviction lands before the server has the write, every subscriber refetches
the pre-log payload and re-caches it, and nothing invalidates again once the push completes. The
sibling delete path has the opposite, correct shape (`pushMutations(...).then(() => invalidate…)`).

Filed as **LB-4** rather than fixed here: `packages/shared/src/nutrition/log-food.ts` writes the
local store and the outbox, which is Lane A. The proposed fix is to invalidate **twice** — keep the
immediate call, because offline it is the only one that will ever fire, and add one after the push.

## Not verified

**Nothing ran on the S25.** Both changed surfaces are cards in the persistent tab shell, so the
paths that only exist on device — the local store feeding the deleted optimistic paint, and the
Samsung WebView's rendering of the conic-gradient ring the extraction moved — were exercised only in
the web sandbox. The sandbox also cannot produce a MET-based earned figure at all (see above), so
the *activity* contribution to the budget is unexercised end-to-end; only the HR contribution ran.

<a id="2026-08-23-orchestrator-owner-decisions"></a>

## Orchestrator — four owner decisions taken, one at a time (2026-08-23)

The top of the queue was three `Gate: owner` entries deep — positions 4, 5 and 6 — so Lane A was
stepping over three parked items to reach its work. The owner asked to be walked through them one
question at a time. All four are now answered, and two of them changed more than the question asked.

### Q-393 — the meal label. Removed, not unblocked.

Parked behind `Gate: owner` at position 36, **the position the owner had personally moved it to**,
while its own body contradicted itself: one bullet called Option 2 an open owner decision, a later
one called it moot. The later one was right.

Clearing the gate is what exposed the better answer. It put Q-393 at Lane B #16, **directly above
Q-392** — and `mealLabelStyle → ta_meal_label_style` was already a row in Q-392's table. Two entries
for one row of work. Removed, with the surviving half and the owner's decision folded into Q-392.
Option 2 is dead: 0.353 mm per module, below every shipped style.

**The lesson is about sequencing, not labels.** The cheaper outcome only became visible *after* the
first fix was applied. A gate can hide a duplicate.

### Q-85 — rest at a Quick budget. The owner's principle beat my recommendation.

I recommended shrinking rest with a 60 s floor. The entry's own measurement refutes it: rest is
**79% of a five-exercise Push**, and accessory rests are **already 60 s**, so that floor compresses
nothing. All the available time sits in the compound's 180 s — the rest the owner's principle
protects.

The owner's framing is what resolved it: *"rest was meant to be determined based on PCT… happy to
have rest be a bit shorter; but it should keep that in mind — and have a very solid floor."*
Measured across all **91 `style_sets` rows** in production, rest is already monotonic in intensity:

| %1RM | rest |
|---|---|
| 50–65% | **60 s** |
| 70% | 75 s |
| 75–80% | 90–130 s |
| 85–92% | 180–240 s |

So the principle was already in the data — but **hand-authored, not derived**: at 75% the catalogue
ranges 90 s to 180 s depending on the style's intent. The entry now says *scale the authored value,
do not replace it with a function of pct*.

**Decision: option (a), floor 45 s.** Accessories compress, the compound keeps full rest. The 45 s
was the whole question — at 60 s there is nothing to compress and (c) leave-it would have won.
Option (b), compressing the compound, is recorded as rejected: it would be the one place the
protect-the-primary discipline reverses.

### Q-420 — session RPE. The owner reversed the premise, and the data backs them.

Four calls: **delete the user-facing prompt**, derive a background intensity from set RPEs, store
derived separately from self-reported, keep the training-load chart labelled as derived. Deriving it
**dissolved the question that gated the entry** — the 6–10 → 1–10 mapping only mattered while a
human typed the number.

Then the correction that matters. This entry and Q-421 both said heart rate had made RPE redundant
for energy. The owner: *"HR only depicts cardio/heart rate, not CNS. Can't they work in
conjunction?"*

**Measured over the 44 sessions carrying both signals: `corr(avgBpm, mean set RPE) = +0.083`.**
Uncorrelated. Two structural reasons, both read from source: `summariseWorkoutHr` takes a **flat
mean across rest periods**, so a heavy day averages low exactly when it was hardest; and Keytel was
fitted on steady-state aerobic work, with no anaerobic or neuromuscular term.

| session | avg HR | mean set RPE | Keytel |
|---|---:|---:|---:|
| **74 min**, 74.4% 1RM, a set at RPE 9 | 73 | 7.27 | **207 kcal** |
| 48 min | 104 | 7.67 | **359 kcal** |

**The longer, harder session is credited 40% fewer calories**, at 2.8 kcal/min — barely above
sitting. So HR is the base and the derived intensity is a correction on it; neither overrides the
other. The formula is deliberately unpicked — it must be **fitted**, against Q-422's adaptive-TDEE
back-solve, which now carries `Needs: Q-420`.

Q-420 went from parked to **#1 in Lane A's ready list**.

### LB-2 — bulk-deleting a meal type's entries. Declined.

Move-only stays. Nobody is stuck (Q-326 shipped the move), the meal type can be deleted once empty,
and the alternative is a single irreversible tap that discards logged history feeding the calorie
trends, the TDEE calibration and Q-422's fitting. Removed from the queue; the decision lives in
[`docs/domains/nutrition/README.md`](../domains/nutrition/README.md) under **Decided, and
deliberately not built**, so a future session finds it where it would look.

### Two process notes

**My own entry parked itself.** The first draft of Q-420's rewrite contained a `⛔` in prose, and
`next-item.js` read it as a blocker marker. The tool was right; the marker was mine. That is the
same class sweep 3 exists to clear, found by writing one.

**A question the owner cannot parse is a question not asked.** The first version of Q-393's question
was written for someone who had read the entry, and the owner said so. Every question after it led
with what the feature *is* in plain terms before what was being decided.

### One entry needed no question at all — Q-137

Walking to Q-137 (the Activity Score) expecting a fifth owner question, its own text had already
answered it: **"DECIDED 2026-08-11 — direction C"**, with a closing line reading *"what remains on
this entry: nothing — strike this entry once Q-188 and Q-190 land."* Both had, confirmed in source
(`hourly-movement.ts`, `activity-score.ts`, `score-audit/activity.ts`). Removed rather than asked
about — the live thread on the Activity Score is a later entry (Q-505) the owner had already
delegated on 2026-08-18. Same class sweep 1 exists for, found this time by reading before asking.

### Verification

`pnpm check:rules` — **54 of 54**. `check-backlog-pointers` — 192 entries, 13 `Needs:` with no
cycles, every target known. Queue 201 → 192 across the session; owner-gated entries 29 → 26.

**Not exercised:** nothing here touched the app. No runtime, no device, no version bump.

<a id="2026-08-23-orchestrator-q287-decisions"></a>

## Orchestrator — Q-287, account deletion: all seven plan decisions resolved (2026-08-23)

Continuing the owner walkthrough. Q-287's own plan (`docs/superpowers/plans/2026-08-16-account-deletion.md`)
carried **seven** marked owner decisions, not the five the queue entry's earlier summary named —
the queue entry had drifted from its own plan doc.

### Three the owner decided

1. **Hard delete, not a tombstone.** Google Play requires deletion to actually remove the data;
   `oura_raw_samples` alone is over a million rows for one user, and a tombstone means carrying
   that weight forever for an account nobody is coming back to.
2. **A 14-day grace period** — chosen over the plan's own "no grace period, export-first" default.
   The mechanism problem that recommendation existed to avoid (no cron layer to execute an expiry)
   has an answer already used elsewhere in this repo: **check on the next authenticated request**,
   the same shape Q-270 used to warm a route once per app launch instead of inventing a scheduler.
3. **Refuse deletion for the last remaining admin.** The owner is currently the only one; a
   self-lockout would take `db-query` and every other admin tool this repo's own session routine
   depends on down with it.

### Three decided without going back to the owner

Each was cheap, reversible, and a mechanical call rather than a preference — the CLAUDE.md rule that
a decision like this doesn't need to interrupt anyone:

- **The big-table delete** measures the indexed `user_id` path first, falling back to a chunked
  delete only if that proves too slow. The plan's own recommendation; no owner preference involved.
- **`friendships` rows delete outright, on both sides**, on the reasoning that a friendship with a
  deleted account is meaningless — the same rule applied everywhere else a hard delete cascades.
- **The web-accessible path Google Play requires** is a route on the sign-in flow that already
  exists, not a new email process.

The seventh item in the plan's original list — reusing the existing table-scoping map rather than
hand-writing one — was never a preference to begin with; it is a finding, and stays in the queue
entry as guidance rather than a decision.

### What this unblocks, and what it does not

Q-287 goes from `Gate: owner` to `Lane A`, `Needs: Q-288` — it now correctly parks behind the export
completeness fix rather than reading as startable with an owner blocker buried in prose. **This does
not exempt the eventual PR from confirmation before merge.** `CLAUDE.md`'s destructive/irreversible
carve-out still applies to the code, not to the decisions that unblock writing it.

Both the plan doc and the queue entry were updated together, and the queue entry's stale duplicate
paragraph (the plan summary had been copy-pasted twice, once current and once from the original
filing) was trimmed rather than left to drift again.

### Verification

`pnpm check:rules` — **54 of 54**. `check-backlog-pointers` — 191 entries, 14 `Needs:` with no
cycles, every target known. `next-item.js` places Q-288 READY and Q-287 parked behind it.

**Not exercised:** nothing here touched the app. No runtime, no device, no version bump.

<a id="2026-08-23-orchestrator-q395-phase-split"></a>

## Orchestrator — Q-395 split into a phased chain (2026-08-23)

Q-395 was a **269-line queue entry** describing a nutrition rework across sixteen screens, listed as
one thing an implementer could pick up. Its own §14 sequenced the work into phases; nothing in the
queue expressed that, so `next-item.js` offered the whole rework as a single startable item and the
phasing had to be inferred by reading to the bottom.

### The chain

```
Q-406  → Q-395a → Q-395b → Q-395c → Q-395
row      quantity  day       Log Food  checkpoint
         sheet     screen    + rename
```

| entry | phase | the thing that would go wrong without it |
|---|---|---|
| **Q-406** (exists) | one shared `food-row.tsx` | a food reads four different ways today; the sixth copy is the one the reuse rule forbids |
| **Q-395a** | quantity sheet + Edit Meal | the srv/g toggle is a hand-rolled segmented control at 40 px — the app's smallest target |
| **Q-395b** | the day screen | **the 11-section coverage list.** The first draw showed 3 of the 11 sections this tab renders |
| **Q-395c** | Log Food + `My Foods` | **the rename sweep.** Two names for one list is the defect; a surface left behind reads as a second list missing rows |
| **Q-395** | the spec, `Needs: Q-395c` | it is the completion checkpoint, not work — and should never be picked up as a work item |

**Q-406 turned out to be the entry point rather than a prerequisite, and its own text says why.** It
was filed as "extract the row first so Q-395 has somewhere to land", then corrected on 2026-08-19:
extracting a food row frees **zero** lines from either landing file, and the four call sites are four
*different* shapes, so a faithful component is a wrapper rather than a unification. Its conclusion —
*"the row cannot be extracted without first deciding what it should look like, and that decision is
Q-395's"* — reads as a blocker and is now satisfied: the design is settled, so Q-406 is startable and
is phase one. Its **headroom half already shipped** (v1.325.3): `nutrition-content.tsx` 800 → 732 and
`saved-meals-sheet.tsx` 793 → 753, which was the hard CI blocker, since both sat exactly at the
800-line ceiling where one added line fails Custom Rules.

### What the phases carry, and what they deliberately do not

Each phase points back at Q-395's findings instead of restating them, so the decisions keep living in
one place — that is also what kept the split affordable. What is **not** delegated back is the three
warnings that describe how this rework fails quietly, because they have to be where the work is:

- the 11-section coverage checklist (Q-395b), reproduced in that PR body and ticked off;
- the `Saved meals` / `My Meals` / `My Foods` rename swept in **one** pass (Q-395c) — the owner
  caught the half-done version instantly: *"So im picking up a discrepancy between My Meals and My
  foods? Whats the difference"*;
- diffing `FoodLibrarySheet` against `SavedMealsSheet` before merging them (Q-395c), so bulk delete,
  meal-plan linkage and the label path survive the merge or are named as dropped.

### Cost, recorded rather than absorbed

`docs/implementation-backlog.md` baseline **11334 → 11359**. The split was 81 lines before trimming
and is 25 after. The reasoning is in
[`docs/doc-size-baseline-history.md`](../doc-size-baseline-history.md) — the ratchet exists so growth
is deliberate, and raising it with a written reason is the deliberate path, not a way around it.

Linked from [`docs/domains/nutrition/README.md`](../domains/nutrition/README.md) in the same PR,
per the rule that a pillar's index is supposed to be a complete answer.

### Verification

`pnpm check:rules` — **52 of 52**. `check-backlog-pointers` — 198 entries, 13 `Needs:` with no
cycles and every target known. `next-item.js --lane B` places Q-406 at **#6 READY** with Q-395a/b/c
parked behind it in order and Q-395 parked as the checkpoint.

**Nothing reordered.** The phases were inserted adjacent to Q-395, at its own priority.

**Not exercised:** nothing here touched the app. No runtime, no device, no version bump.

<a id="2026-08-23-orchestrator-sweep-aggregation"></a>

## Orchestrator sweep 2 — aggregation, and two entries that were the same investigation (2026-08-23)

The queue held **201 entries and 2 `Batch:` slugs**, both seeds from when the field was invented.
This assigns the first real batch, sets the lanes that batch needed, and converts three prose
blockers into `Needs:` fields.

### The batch: `ring-service-device-pass` — Q-537 · Q-533 · Q-388

Three changes under `android/…/oura/`. Batched because **the axis is what one verification pass
covers, and this is one APK and one sitting with the ring**: reveal the stored key and confirm the
`clearKey` warning (Q-537), start a full re-sync and confirm the completion notification arrives
(Q-533), and let Q-388's battery telemetry accrue on that same install over the following days.
Separately they are three APK cycles, which `CLAUDE.md` names as the most expensive verification the
owner performs.

**Q-537 is why the batch is worth assembling.** It is the mitigation for the hazard that makes APK
delivery costly at all — an install that cannot upgrade in place forces an uninstall, and an
uninstall destroys the only copy of the ring key. Batching two more Kotlin changes onto that APK is
free; shipping the key backup late is not.

**Q-388 alone survives its own batch, and that is stated in the entry rather than left to be
discovered.** The PR ships its two do-regardless items — resetting `EXERCISE_HR` and fast-HR mode in
the connect-time sequence, and persisting the battery poll. Its SpO₂ question is a decision waiting
on the A/B that persisting the poll makes measurable at all. A batch normally closes every member;
this one does not, because the alternative is a second APK cycle for a five-line change.

### Q-116 and Q-388 are the same investigation, filed 11 days apart

Neither entry referenced the other. Q-116 (2026-08-06): a live HR reading on the Health tab with
nobody having tapped *Measure now*, suspected to explain ~15%/night of ring drain. Q-388
(2026-08-17): the owner reporting ~20% overnight, roughly 3.5× stock.

**Q-388's "separate latent defect, found while tracing" is Q-116's second leak vector, pinned to a
line.** `reqBleFastHrMode(false)` and `EXERCISE_HR → AUTOMATIC` appear only in `liveHrStopSequence()`,
so any live-HR session that never reaches `stopLiveHr()` leaves continuous fast-HR sampling on
permanently — healed by no reconnect, restart or service restart. Q-388 traced Q-116's suspected
cause without knowing Q-116 existed.

They are cross-linked rather than merged, and **Q-116 now carries `Needs: Q-388`**. Q-388's batch
closes that vector and persists the telemetry, so Q-116's diagnostic capture is worth running
*after* that APK and not before: if the leak is gone, what remains is the other two vectors, and if
it is not, there is finally a number to argue with. They stay separate because Q-116's leading
vector is a stale persisted Zustand workout store — Lane B — while Q-388 is Kotlin. That is also why
Q-116 still carries no `Lane:`; the diagnostic is what decides who owns the fix.

### Three prose blockers became fields

Each of these read as READY under `scripts/next-item.js` while saying in its own body that it was
not. An implementer had to reach the bottom of the entry to find out.

| entry | now | the blocker, in its own words |
|---|---|---|
| Q-184 | `Needs: Q-204` | *"hold Q-184 behind Q-270 and Q-204"* |
| Q-204 | `Needs: Q-270` | Gate 1 FAILED — `training_load_ots` is empty |
| Q-116 | `Needs: Q-388` | (new — see above) |

**Q-184 and Q-204 both quoted "0 of 42 days".** Re-measured 2026-08-20 during sweep 1, both columns
are 0 of **96** — 54 further days have changed nothing, and Q-270 has since been reopened 🔴 because
the fix that was meant to start populating one of them did not take. Both counts are now dated.

`READY` drops 165 → 162 and `PARKED` rises 30 → 33 as a result, which is the whole point: three
entries stopped advertising themselves as startable.

### Lanes, because a batch cannot mix them

Q-537, Q-533, Q-388, Q-114 and Q-104 carried **no `Lane:` field at all**, so each appeared in both
lanes' queues. All five are `android/**`, which `docs/agents/README.md` §3 puts in Lane A without
ambiguity. The existing `scale-weighing-ui` batch (Q-114, Q-104) had the same gap and now has a lane.

### One correction to a measurement I made mid-sweep

A first pass counted **56 "native" entries** by matching any mention of APK, Capacitor or "native".
Read properly, that collapses to about 20 that genuinely require a Kotlin change — and one of the
first candidates, **Q-538, is not native at all**: it declares Lane B and calls plugin-bridge methods
Lane A already shipped. A grep for the word is not a measurement of the work.

### Verification

`pnpm check:rules` — **51 of 51**. `check-backlog-pointers` — 201 entries, batches now
`calorie-budget-surface×2, ring-service-device-pass×3, scale-weighing-ui×2`, 9 `Needs:` with no
cycles and every target known.

**Nothing reordered.** No entry changed queue position. Batching does pull Q-533 and Q-388 forward
in practice, since a batch ships when its first member is reached — 15 places in a 201-entry queue.

**Not exercised:** nothing here touched the app. No runtime, no device, no version bump.

<a id="2026-08-23-oura-constants-per-process"></a>

# 2026-08-23 — `/api/body-battery` was 500ing in production, and boot said the constants were fine (LA-20)

**Branch:** `fix/oura-constants-per-process` · **Lane A** · server only, ships via Railway

Found by the `error_events` read that CLAUDE.md asks for at session start — which I had skipped, and
which is the only reason this was caught at all. It is not in any backlog entry.

```
/api/body-battery · server · daytime-stress: constants not set — call setDaytimeStressConstants() first
19 hits · first 2026-08-23 10:37 · latest 2026-08-23 12:27
```

Live, still firing while I read it, and caused by the constants port I shipped earlier (Q-545).

## Two independent faults, both hiding behind a green boot line

`instrumentation-node.ts` downloads the constants, sets `OURA_CONSTANTS_DIR`, injects them into the
four ports, and logs a successful delivery. Both of those effects are **per-process**, and the
process that runs boot is not necessarily the process that serves a request.

**Measured, not reasoned.** A throwaway probe route reporting the accessors' own state:

```
{"daytime":false,"steps":false,"dir":null}
```

`daytime: false` in a request handler, with boot having logged `model constants: fixtures`. On a
later run the same probe read `dir` as a real path while `daytime` was still `false` — so the two
failures are separable:

1. **Module-instance divergence.** The `let constants` inside `daytime-stress.ts` that boot wrote to
   is not the one the route reads. No env var fixes this.
2. **`OURA_CONSTANTS_DIR` not inherited.** Where that happens, `constantsDir()` falls through to
   `<cwd>/lib/oura-models/constants` — which has held no `.constants.json` since Q-49 removed them.
   So a route that *did* inject would fail differently, on missing files.

The route with no fault (`/api/oura-ble/step-counter-export`) is the one that calls
`ensureServerOuraConstants()` itself. Every path that injects works; the one that trusted boot did
not. That pattern is the whole diagnosis.

## The fix, one half each

**`constantsDir()` now prefers the delivered cache directory** over the empty tree, gated on its
`MANIFEST.json`. `constants-delivery.ts` already wrote to a deterministic `<cwd>/.oura-constants`,
so the files were findable all along — nothing was reading for them there.

**`getRepository()` injects.** It is the one thing every path that can reach a constants read
already goes through, it is server-only by construction (it pulls in `pg`), and it runs once per
process. Adding the call to `/api/body-battery` would have fixed one route and left the class — the
class is what put a 500 in production two weeks after the port shipped.

It uses a new **non-throwing** variant. `ensureServerOuraConstants()` throws when the directory is
unreadable, and the repository is on the path of every DB route in the app; letting it throw there
would turn "the stress tables are missing" into "nothing works", which is a strictly larger outage
than the one being fixed. Swallowing changes nothing a caller sees — the accessor still refuses at
the read site, exactly as today.

## Verified

Three mutations, each applied, run, and reverted:

| mutation | fails |
|---|---|
| remove the cache-dir fallback | `falls back to the delivered cache directory when OURA_CONSTANTS_DIR is unset` |
| remove `tryEnsureServerOuraConstants()` from `getRepository` | `injects the constants a request path can reach` |
| make the repository use the throwing variant | `still returns a repository when the constants are unreadable` |

Plus the probe re-run on the fix: `before {daytime:false, steps:false}` → `after {daytime:true,
steps:true}` across a single `getRepository()` call, in the request-serving process. Full suite 548
files / 4,537 tests; `pnpm check:rules` 52 of 52.

**Not verified: production.** The local reproduction is a dev-server worker split, which is not
proof that Railway's split is identical — what is proven is that the injection now happens in
whichever process serves the request, whatever the split. **The check that matters is
`error_events` after this deploys:** the fault must stop, and "it stopped" is not the same as "it
was fixed" until the count is zero across a window where `/api/body-battery` was actually called.
That is recorded as a Known Issue rather than struck here.

`/api/body-battery` also cannot 500 this way locally without a daytime-HRV model and baselines,
which the seeded dev user does not have — the model path is guarded and silently skipped. That is
why a green `pnpm dev` said nothing about it, and why `error_events` is the only thing that could
have.

<a id="2026-08-23-oura-rollup-io-port"></a>

# 2026-08-23 — The Oura rollup now takes an I/O port (Q-545, D2 Task 2)

**Branch:** `feat/oura-rollup-io-port` · **Lane A** · no behaviour change

The D-track's north star, in the owner's words, is *"all the ring data goes directly to the phone
and once it's aggregated and calculated it sends to DB."* Today it is inverted: the phone ships raw
frames up and Railway decodes them and runs SleepNet. Q-545 is the missing middle, and this is its
Task 2 — the extraction that makes a device rollup possible without writing a second one.

## What shipped

`PostgresRepository.aggregateOuraRawSamples` was 1,102 lines of computation with its stores wired
straight into the method body. It is now:

| file | what it is |
|---|---|
| `lib/oura-ble/rollup/run.ts` | `runOuraRollup(io, timezone, opts)` — the whole computation, runtime-agnostic |
| `lib/oura-ble/rollup/io.ts` | `RollupIO` — every store the rollup touches, 22 methods |
| `lib/data/postgres/rollup-io.ts` | `createPostgresRollupIO(deps)` — the server implementation |
| `lib/data/postgres/adapter.ts` | a 10-line wrapper; the file drops 6,906 → 5,818 lines |

`RollupIO` is bound to one user by the implementation, so the rollup itself never handles a
`userId` and structurally cannot write across one.

**The gate this entry named was "identical output over a sample of historical days".** The
in-repo form of that gate is the **20 test files** that drive `aggregateOuraRawSamples`
end-to-end against real Postgres — sleep staging, night merge, anchor drift, step rollup and
backfill, SpO₂ day-keying, HRV median, illness persistence, incremental window, daily summary.
All 20 pass unchanged, and so does the full suite (542 files, 4,470 tests) and all 51 Custom
Rules steps.

## Two premise corrections, both of which change how Task 3 should be sized

**1. The port is 22 methods, not five.** The plan measured *"17 lines touch `this.db` / `.select(`
/ an `oura.*` slice helper"* and sketched a five-method interface from it. Lines are not
operations: there are **28 touchpoints across 22 distinct store operations** — nine reads (two
anchor reads, the watermark, raw frames, step live-windows, existing steps, workout windows, the
latest daily summary, the daytime-HRV model, daily derived) and thirteen writes. Anyone sizing the
device implementation off "five methods" would be out by about four-fold.

**2. ⚠️ The I/O is portable now; the models are not, and this extraction did not change that.**
`run.ts` still reaches `onnxruntime-node` transitively — `sleepnet-assemble` → `inference/sleepnet`
→ `inference/session.ts`, and `daytime-stress` → `inference/dhrv` → the same loader — a file whose
own header reads *"server-only: onnxruntime-node is a native addon and must never reach the client
bundle."* So Task 3 needs the model session injected the same way the I/O now is. `session-web.ts`
already exists as the WASM sibling, which is plan Task 4.

> **Correction, same day.** This entry first said Task 4 was "gated on plan Task 1: the production
> CSP has no `wasm-unsafe-eval`". **That gate is gone** — Q-546 added the directive on 2026-08-20
> (#259) and `lib/security/csp.ts` carries it with a test on both halves. The plan's §4, which is
> where the claim came from, still reads as current and is not. What is actually left of Task 4 is
> narrower and worth stating plainly: **`getWebSession` has no importers.** All seven consumers of a
> model session (`sleepnet`, `dhrv`, `energy`, `illness`, `awhr`, `awhr-profile-selector`,
> `step-counter`) hard-import the node loader, and `wasm-parity.test.ts` reaches `onnxruntime-web`
> directly rather than through `session-web.ts`. So the WASM loader is inert in exactly the way the
> local-store bridge was — written, device-shaped, and called by nothing.
>
> **And the reach-through is smaller than "the models are not portable" makes it sound.** Walking
> `run.ts`'s import graph following **value** imports only — a type-only import is erased and reaches
> no bundle, and counting them drags in the entire Postgres layer through one `import type` in
> `daytime-hrv-model.ts` — gives 50 modules and four edges: the step pipeline reaches both the
> disk-reading constants loader and the node session; `sleepnet-assemble` reaches the node session;
> `daytime-stress` reaches it **only through the module graph**, because the rollup calls just
> `buildDaytimeStressSeriesFromModel`, which is synchronous and runs no model. That last one needs a
> file split, not an injection. The table is on the Q-545 queue entry.

A smaller one, worth doing when Task 3 lands: `sourceRank` (`lib/data/health-source.ts`) drags
`drizzle-orm` into the module graph for what is a rank lookup.

## Not exercised

No device run — this is a server-side refactor that reaches the APK through a Railway deploy with
no rebuild, and the rollup's on-device path does not exist yet. Not exercised against drifted
production data either: the gate is the test corpus against a fresh local Postgres, which is the
same gate the rollup has always had.

## What this does *not* claim

Nothing here moves the bill. The rollup still runs on the server, computing exactly what it
computed before. The saving lands at plan Task 7, the single-writer flip, and every task between
here and there is still open.

<a id="2026-08-23-q534-closed-on-measurement"></a>

# 2026-08-23 — Q-534's three open findings, measured rather than built (closed)

**Branch:** `chore/close-q534-park-blocked` · **Lane A** · docs only

Q-534 was the non-destructive half of the `disk_full` incident: four findings, of which finding 4
(the `measured_at` index that made every re-stamp non-HOT) shipped on 2026-08-18. The other three
sat open. All three are measured here against production, and **none of them is actionable any
more** — so the entry is closed rather than implemented.

## The database the entry was written about no longer exists

| | at the incident (2026-08-17) | now (2026-08-23) |
|---|---|---|
| database total | 819 MB | **210 MB** |
| `oura_raw_samples` | 1.1M rows / 666 MB | 315k rows / 87 MB |
| its indexes | 443 MB | 46 MB |
| dead tuples | ~306 MB of bloat | **0** |
| `n_tup_upd` / `n_tup_hot_upd` | 681,005 / 0 | 0 / 0 |

The 500 MB question the entry closes on — *is it reachable without touching retention?* — is not
just answered, it is 290 MB behind us. `n_tup_upd = 0` is the direct evidence that finding 4's fix
removed the mechanism: nothing re-stamps the table at all now.

## Finding 1 — "the dedup index stores the payload twice" — is wrong

The reasoning was sound and the premise was not. Measured:

```
rows 314,995 · body_hex avg 24 chars · min 4 · max 28 · 7.3 MB across every row
dedup index (user_id, ring_timestamp_ds, tag, body_hex): 22 MB, 135,560 scans
```

**`body_hex` averages 24 characters.** A SHA-256 digest is 32 bytes — *larger than the value it
would replace*. MD5 is 16 and would save roughly 8 bytes a row, about **11% of a 22 MB index**, in
exchange for a collision hazard on the one guarantee that stops a distinct ring event being silently
dropped. The entry itself named that risk and said the column must stay in the equality check; with
the payload this small there is nothing left to gain by paying it.

The 22 MB is per-tuple overhead across 315k rows, not payload. Arithmetic: uuid 16 + bigint 8 + tag
+ a 24-char varlena ≈ 56 bytes of key, plus item pointer and tuple header ≈ 68, plus fill ≈ 73.
315k × 73 ≈ 23 MB, which is what is there.

What *would* shrink it losslessly is `text` → `bytea` (24 hex chars → 12 raw bytes), with exact
equality preserved and no collision risk at all — strictly better than hashing on every axis. That
is Q-540's half, and Q-541 supersedes it because a packed blob is already `bytea`. Q-540 now carries
the measured sizes, so the next reader costs it against 22 MB rather than the 78 MB it was written
against.

## Finding 2 — autovacuum — was already marked a measurement artifact

Re-confirmed: `last_autovacuum = 2026-08-22T19:08Z`, `n_dead_tup = 0`. (`last_analyze` is still
NULL, which `CLAUDE.md` already warns about — it is why `n_live_tup` is not to be trusted for "is
this table empty".)

## Finding 3 — `work_mem` and the 6.5 s `DISTINCT ON` — is no longer live

The query that triggered the incident, run against production:

```
SELECT DISTINCT ON (tag) tag, ring_timestamp_ds FROM oura_raw_samples ORDER BY tag, ring_timestamp_ds DESC
→ 20 rows, 246 ms
```

**246 ms, against the 6.5 s the entry recorded.** `oura_raw_samples_user_tag_ts` serves it, and the
sort that needed temp disk was a function of 1.1M rows. At 315k it does not spill. Raising `work_mem`
for a path that no longer strains it would be a change with nothing to verify against.

## What is left, and where it went

- The `VACUUM FULL` press the entry sequences is **Q-315**, which is now parked `Gate: owner` — the
  route shipped, and pressing it needs an admin session cookie a session cannot obtain (`db-query`
  runs as `claude_readonly`, which cannot `VACUUM` by design).
- The volume revert is withdrawn and settled, as the entry already says.
- **Q-418** is parked `Gate: device` in the same pass. Its remaining half is a native plugin patch
  needing an APK, and the entry's own instruction is to verify background tracking with the screen
  off *before* building on it — a 20-minute pocketed walk, which is not reachable from here.

## Not verified

Everything above is production measurement through `/api/admin/db-query`, which is **row-scoped to
one user**. For `oura_raw_samples` that is not a limitation — 314,995 counted against a 302,240
whole-table estimate says the owner's rows are essentially the table — but the sizes come from
`pg_stat_user_tables`, which is whole-database and exact, while the counts come from the scoped
view. Both are quoted as what they are.

<a id="2026-08-23-route-hardening-batch"></a>

# 2026-08-23 — Three route-hardening items on one verification pass (Q-454, Q-455, Q-465)

**Branch:** `fix/route-hardening-batch` · **Lane A** · server only, ships via Railway

Batched because they verify identically — anonymous and signed-in calls against `pnpm dev` — not
because they share a subject. None of the three is a fix for an observed symptom; all three are
guards on paths that are reachable and unused, and each entry says so. That is worth stating,
because a change presented as a bug fix invites the next reader to look for the bug.

## Q-454 — three routes answered before establishing the caller was anyone

Found by calling all 122 GET routes anonymously. 120 revealed nothing. Three did:

| route | anonymous answer, before |
|---|---|
| `GET /api/day-log` | `400 {"error":"Missing date"}` |
| `GET /api/exercise-history` | `400 {"error":"Missing name"}` |
| `GET /api/push/subscribe` | `503 {"error":"Push not configured"}` |

**No data leaked.** Supply the missing param and both param routes returned 401 — the pre-auth code
only read a search param. The push one is the more interesting of the three: the key it guards is a
*public* VAPID key, so nothing secret was reachable; what was reachable was a fact about the
deployment — whether this instance has push configured — to anybody who asked.

All three now call `auth()` first. The rule is that security checks fail closed and fail *first*; it
is cheap to reorder today and expensive the day someone adds a param handler above the `auth()` call
that touches the DB.

**Verified the reorder breaks nothing:** `subscribeToPush` is called from one place,
`components/more/settings-panel.tsx`, which is a signed-in screen, and its very next call is a POST
that already required auth. An anonymous caller could never complete that flow.

## Q-455 — a thrown route answered with an empty 500

`GET /api/oura-ble/decoder-constants` read the constants through the same accessor the server
pipeline uses, and `JSON.parse(readFileSync(...))` threw straight out of the handler. The caller got
**500 with no body at all**, so a client doing `res.json()` stacked a parse exception on top of the
original fault and learned nothing from either.

Now caught, returning `{"error":"Decoder constants unavailable"}`. **Deliberately not a fallback:**
there is no degraded dequantisation table, and a client silently decoding step frames with the wrong
numbers would be worse than one that could not decode them at all. This turns a shapeless failure
into a legible one, nothing more.

The trigger the entry observed was environmental — the sandbox cannot reach the model-constants
bucket — and is not what was filed. The shape is. Worth noting beside LA-20 from earlier today: the
first-request path exists whatever the boot check does, and LA-20 was that path failing in
production for real.

## Q-465 — a check-in that says nothing is not a check-in

`POST /api/day-checkin` with a body of exactly `{}` returned **201** and wrote a row with every
metric null. That row is indistinguishable from a real check-in in which the user answered nothing,
and readiness is precisely the pillar where *"the user told us nothing"* and *"the user told us they
feel neutral"* must not collapse. It also moves `reevaluationKey(...)` in `/api/workout-data`, so a
hollow row can trigger a re-evaluation carrying no new information.

`dayCheckinHasAnswers` lives in `packages/shared/src/validation/day-checkin.ts`, beside the two
schemas that are already shared for the same reason: **the outbox reaches this table too**, and a
guard on the web route alone is how the two write paths drift — the failure this repo has hit in
three domains. The push branch rejects per-item and **not retryable**: a mutation carrying no
information will never carry any, so retrying it forever is the poison-pill shape the outbox exists
to avoid.

**What counts as an answer** is the whole design: the ten scales, an illness context, a non-blank
journal, or a non-empty sore-muscle list. Not `phase` or `date` (addressing), and **not the two
`*Touched` flags** — they describe whether a score-derived prefill was accepted, which is meaningless
without the scale they describe, and accepting them would let the exact hollow row back in.

**Checked for regression risk before choosing 400 over a silent no-op.** Both live writers
initialise their scale state from `NEUTRAL_SCALES` rather than from null, so they always send
numeric scales — a guard that rejected those would have broken a Save button on a screen where the
user *did* answer. Production agrees: all 50 of the owner's check-in rows carry answers, across
every column.

## The existing parity test was asserting the old contract

`push-mutations-web-parity.test.ts` had a case posting `{}` to both paths and expecting 201 — the
behaviour Q-465 removes. Its subject is phase defaulting, so both fixtures now carry one answer, and
the answerless case got its own parity assertion beside it. **An unchanged fixture there would have
been the test asserting the bug**, which is the failure mode worth naming rather than quietly
patching.

## Verified

Four mutations, each applied, run, reverted:

| mutation | fails |
|---|---|
| revert `day-log`'s ordering | `GET /api/day-log — no date` |
| remove the route's answers guard | 3 of the 5 day-checkin cases |
| remove the push branch's answers guard | 2 of the 4 outbox cases |
| remove the decoder-constants try/catch | `answers a failed read with JSON, not an empty 500` |

Full suite **552 files / 4,562 tests**; `pnpm check:rules` **52 of 52**. Live against a signed-in
`pnpm dev`: all five anonymous calls 401, `day-log`/`exercise-history` still 400 correctly *behind*
auth, `{}` and addressing-only rejected 400, one real answer 201, decoder-constants 200.

**Not exercised:** the APK. Nothing here is native, offline-first, safe-area or gesture work — three
route handlers and one shared predicate — so the device gate does not apply. The outbox half is
exercised through `pushMutations` against the local Postgres, which is the same code the device
calls, but not from a device.

<a id="2026-08-24-activity-log-delete-outbox"></a>

# Deleting an activity works offline now (Q-328)

**Branch:** `feat/activity-log-delete-outbox` · **Lane B** · v1.350.0

## What was wrong

An activity log was **created** through the outbox — `exercise-review-sheet` and
`done-activity-screen` both `upsertActivityLog` + `queueMutation`. It was **deleted** by a bare
`fetch('/api/activity-logs', { method: 'DELETE' })` with no queued mutation anywhere, so with no
connection the delete simply failed. It was the one activity-log write that could not be made
offline at all.

CLAUDE.md: *"every user-visible write needs an outbox domain — any POST reachable offline must queue
a mutation or visibly fail."* This one visibly failed, so it was never silent data loss — but it is
also what forced `DELETE /api/activity-logs` to keep answering 200 for a miss (Q-556).

## What shipped

`handleDeleteActivity` in `lib/hooks/use-day-entry-mutations.ts` writes a local tombstone and queues
the mutation, then fires its toast — feedback after the **local** write, never after the network,
because offline there is no network to wait for. The push is fire-and-forget via
`pushThenRevalidate`.

The web `fetch` survives as the fallback for the sandbox, kept logic-free by policy: it carries no
defaults or semantics the device path lacks.

## The part that would have broken things

`softDeleteActivityLogPending`, **not** `deleteActivityLog`. The two differ only in `sync_status` and
both are correct at different moments:

- `'synced'` is what lets `applyDelta` reap the tombstone — it prunes with
  `DELETE … WHERE id = ? AND sync_status='synced'`, so a row left `'pending'` blocks its own
  tombstone forever.
- `'pending'` is what stops a pull clobbering a delete that has not reached the server yet.

A queued delete must start `'pending'` and move to `'synced'` on push confirmation, which is what
`markActivityLogSynced` does from `sync-engine.ts`. Lane A shipped all three methods for exactly this
reason; this PR is the client that finally uses them.

**`deleteActivityLog` is removed** — its only caller was the bare-`fetch` path this replaces, and a
method that writes `'synced'` from the client is now always wrong. Its two tests went with it; the
surviving pair asserts `'pending'` **and** `not.toContain('synced')`, since which value the client
writes is the whole risk.

## The guard, and the hole mutation-checking found in it

`lib/hooks/__tests__/activity-delete-outbox.test.ts` pins that the local write and the queued
mutation appear **together** — a `'pending'` row with no mutation behind it is never pruned and never
pushed, so the two calls are only correct as a pair.

The first cut asserted `body.toContain('softDeleteActivityLogPending')`. Mutation-checking showed it
**passing with the call deleted** — the name still appeared in the comment two lines above. A guard
satisfied by its own documentation guards nothing. It strips comments and matches
`store.softDeleteActivityLogPending(` now; both halves fail their assertion when removed, verified
by deleting each in turn.

## The Custom Rules gate caught a real bug in this change

`check-client-today-timezone` failed on a bare `todayInTz()` — which falls back to Brisbane, so the
outbox row would carry the wrong day for anyone outside AEST. It takes `useUserTimezone()` now.

## Verification

- `npx vitest run lib/hooks/ lib/local-store/` — 155 passed across 10 files.
- `e2e/day-entry-edit-delete.spec.ts` — 6 passed.
- `pnpm check:rules` — Ran 55 of 55. Typecheck clean.

## Not exercised

**The offline path itself was not run, and it is the whole point of the change.** `getLocalStore`
returns null in the web sandbox, so every test above took the web fallback — the local tombstone,
the queued mutation and the push confirmation are verified by unit test and by reading, never by a
device with the network off. `Gate: device` on the follow-up.

Q-556's 404 half is unblocked by this and deliberately **not** done here.

<a id="2026-08-24-aria-expanded-collapsibles"></a>

# The "9" hand-rolled collapsible toggles were actually 2, and the ratchet wasn't worth building (Q-491)

**Branch:** `fix/aria-expanded-collapsibles` · **Lane B** · v1.358.0

## What was wrong

Nine components (per `CLAUDE.md` and Q-491's own re-count) supposedly rendered a chevron-based
expand/collapse toggle with no `aria-expanded` attribute, so a screen reader couldn't tell whether
the region was open or closed. Filed for the stated Play Store direction, not a live user report.

## The count didn't survive a file-by-file check

Went through all nine named files against current `main` individually, rather than trusting the
list a second time (the entry itself already flagged two earlier prose-count failures this run:
Q-480's `DEFAULT_TZ` claim and Q-490's "2" memoised components that were actually 66):

- `health/day-overlay-sheet` — the file is gone. LB-3 retired it this run (#370/#373).
- `deload-explanation`, `signal-sections`, `ai-prescription-card` — all three already wrap their
  toggle in Radix `Collapsible`/`CollapsibleTrigger`. Confirmed against the installed
  `@radix-ui/react-collapsible` package source rather than trusting memory: `CollapsibleTrigger`
  sets `aria-expanded` and `aria-controls` on the trigger element automatically, including when
  used with `asChild` (Radix's `Slot` merges the props onto the child). None of these three needed
  anything.
- `nutrition/meal-card` — same shape: `CollapsibleTrigger asChild` around a `role="button"` div.
  Already correct.
- `workout/active-workout-screen`, `nutrition/saved-meals-sheet` — their chevron is `ChevronLeft`,
  a back-button icon. Never a collapse toggle in the first place.
- `weights-summary.tsx`, `workout/added-weight-toggle.tsx` — genuinely hand-rolled `onClick`
  toggles with no `aria-expanded` anywhere. The only two real violators.

A chevron-icon grep can't tell a Radix-wired trigger from a hand-rolled one, or a collapse chevron
from a navigation one — which is exactly how a specific "nine" became a different nine, and now a
different two.

## What shipped

`weights-summary.tsx`'s collapse `Button` and both of `added-weight-toggle.tsx`'s buttons (closed
state and open state are different buttons, not one toggle) now carry `aria-expanded` and
`aria-controls`, pointing at an `id` on the toggled region via `useId()`. Neither was converted to
Radix `Collapsible` — each renders materially different content by state rather than showing/hiding
one region, so a Collapsible wrap would have been more code than the two-line fix.

## What was NOT built, and why

The entry's own recommended fix shape was "prefer the ratchet over the sweep" — a Custom Rules
check counting chevron-toggle-without-`aria-expanded` sites, shrink-only. Tried the obvious
heuristic (a file imports a Chevron icon, has no `CollapsibleTrigger`, has no literal
`aria-expanded`) against current `main`: **34 files matched**, the large majority legitimate
non-violators for the same two reasons found by hand above (Radix-wired, or a navigation chevron).
A script whose false-positive rate requires auditing 34 files to save auditing 9 isn't a ratchet,
it's a bigger version of the same problem it's meant to solve. Left as a `Keep:` line rather than
shipped as noise — a real version would need to recognize Radix's trigger pattern (direct import or
`asChild`) and distinguish collapse chevrons from navigation ones, neither of which a text grep does
reliably.

## Verification

- `pnpm tsc --noEmit` / `eslint` on both touched files — clean.
- Rendered both components directly (scratch route, removed before committing) against the running
  dev server, logged in as the seeded user, and drove the toggle with Playwright: `aria-expanded`
  flips correctly on click for both components, and each `aria-controls` id resolves to a real
  element in the DOM.
- `pnpm check:rules` — Ran 55 of 55.

## Not exercised

No screen-reader/TalkBack pass on either component — the claim was that the attribute was absent,
not that a specific announcement reads correctly, and TalkBack is the relevant reader on the APK,
not tested here. No device check.

<a id="2026-08-24-battery-walk-extract"></a>

# The Body Battery walk is now a pure function, so TN-2's offset can be fitted (refactor)

**Branch:** `refactor/battery-walk-extract` · **Lane A** · enabling step for TN-2

## Why

TN-2 replaces Body Battery's charge-window offset — the reserve fraction has become structurally
unreachable as the owner's fitness improved, so the tank only drains. Its entry is explicit that the
offset **"must be fitted, not taken from this entry"**, and specifically *"against the shipped
TypeScript with the stress term included, not against [the SQL replay] table"*.

That was not possible. The integration loop was inline in `buildBodyBattery`, a ~200-line async
function that also does eight DB reads, anchor resolution and the daytime-stress fit — so the
arithmetic could not be driven without a database, which is why the only evidence so far is a SQL
re-implementation agreeing with stored values to 13 points mean absolute error. Good enough to
propose with; not good enough to calibrate against.

## What shipped

`packages/shared/src/health/body-battery-walk.ts` → `walkBodyBattery(samples, params)`, lifted
verbatim. **No behaviour change** — the route now calls it and uses the returned totals.

The constants stay declared in the route and are passed in, rather than being re-declared in the new
module. The route remains the one place they are chosen, so the extracted function cannot silently
drift from them.

## What this sets up, and why it is only a substitution

TN-2's change lands entirely in one parameter. `restThreshold` is a reserve fraction, so an explicit
bpm offset above resting HR is `offsetBpm / reserve` — nothing else in the walk moves. Two tests pin
that, so the calibration PR's diff is a constant and a `MODEL_VERSION` bump rather than a rewrite:

- the ceiling sits at exactly `restingHr + offsetBpm` for reserves of 80, 100 and 137;
- and it is **immune to `hrMax` re-estimation**, which the fraction form is not — reproducing the
  2026-08-05 step (hrMax 187 → 168) and showing the fraction-form ceiling moves while the offset
  form's does not. That is the whole mechanism TN-2 is fixing, now under test.

## Verification

15 unit tests in `packages/shared/src/health/__tests__/body-battery-walk.test.ts`, every expected
value **hand-computed from the formula** rather than captured from a run — a golden-file capture
would happily bless a regression. They cover charge, the charge-neutral boundary (the two branches
meet at zero rather than stepping), drain, the `hrr` clamp, gap-hold, the per-sample dt cap,
pre-wake filtering, zero-dt, stress drain and its book-keeping, positive-stress being ignored, and
both bounds.

One of them documents why TN-4's guard is safe: a null stress lookup is arithmetically identical to
having no stress series at all, which is exactly the state a failed stress build leaves behind.

- All 5 body-battery route test files (18 DB-backed tests) pass unchanged — that is the behaviour
  -preservation evidence, since they exercise the real walk end to end.
- Full suite: 4712 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode` in this
  sandbox).
- `pnpm check:rules` — Ran 55 of 55.
- `tsc --noEmit` clean.

## Not exercised

**No production data was replayed and no calibration was changed here** — this is the refactor only,
and `MODEL_VERSION` is deliberately untouched, so nothing re-scores. The fit itself is still TN-2's
work, and still needs the stress term reproduced offline (the dHRV model, its baselines, and the
temp/met signals, which come from decoded raw BLE frames).

Not run on device; `pnpm dev` unavailable in this sandbox (missing `@sentry/nextjs`).

<a id="2026-08-24-card-429-error-states"></a>

# Two Health cards stop vanishing on a failed fetch — and the cache layer that would have swallowed the fix (Q-499)

**Branch:** `fix/card-fetch-error-states` · **Lane B** · v1.356.0

## What was wrong

`hr-recovery-profile-card.tsx` and `strength-progress-card.tsx` both called `useCachedValue` with
no `onError`, then rendered a bare `return null` when their data was empty. `useCachedValue`
swallows a failed fetch unless the caller opts in, so a request that 429'd (the app's own rate
limiter, or any other server error) rendered identically to a genuinely empty result: the card
just disappeared. The 2026-08-18 review reproduced this for `strength-progress-card.tsx`
(`Estimated 1RM` went from 1 node to 0 under a forced 429) but the fix itself — wiring `onError` —
was left to the implementer.

## What shipped

Both cards now pass `onError` and render a compact "Couldn't load… — pull to refresh" state,
following `observed-hr-card.tsx`'s existing pattern. `CLAUDE.md`'s wording is corrected: `cachedFetch`
swallows `!res.ok` **only when the caller passes no `onError`**, not unconditionally as it previously
read.

## The fix that made the fix actually work

Verifying this against the real dev server, both cards kept vanishing under a forced 429 even with
`onError` wired — confirmed by instrumenting `cachedFetchCore` directly: `onError` fired at the
cache-layer level, but the component's own wrapper discarded it because its effect had already
cleaned up (`alive = false`).

That clean-up is React StrictMode's double effect-invoke, which Next.js runs by default in dev: the
first effect instance starts the fetch and is torn down almost immediately; its request stays in
flight and becomes the "owner" of `cachedFetchCore`'s per-key dedup. The second, real instance's own
call joins that owner as a **waiter** rather than firing a second request. On success, waiters are
notified — `cachedFetchCore` already relays `onData` to every joiner. On failure, they were not: only
the owning caller's `onError` ran, and that caller was the torn-down first instance. A production
build (no StrictMode double-invoke) doesn't hit this specific path, but the same race is reachable
there too whenever two different components read the same cache key around the same time — this
just happens to be the one shape dev mode reproduces on every single render.

Fixed in `lib/sqlite/cache.ts`: `pendingWaiters` now carries each waiter's own `onError` and whether
*that* waiter had its own cached value to fall back on, and a failure is relayed to every waiter
with nothing cached — the same "stale beats an error state" rule the owning caller already followed,
extended to joiners. Confirmed via `next.config.ts`'s `reactStrictMode` toggled off temporarily
during verification (reverted, not shipped) that this was the exact mechanism, then fixed the real
cause instead of routing around it.

## Verification

- Two new unit tests in `lib/sqlite/__tests__/cache-onerror.test.ts`: a failure relays to a joined
  waiter with no cache; a joined waiter that already had its own cached value does not get the error
  (stale beats error, per caller). Full file: 6/6 pass, run 5× with no flake.
- Ran every test file importing `lib/sqlite/cache.ts` (`cache-groups`, `cache-groups-legacy-seeds`,
  `q165-cache-seeded-reads`, `cache-fetch`, `cache-http-layer-bypass`) plus
  `use-cached-value-today-agreement` — 63 + 3 pass.
- Full unit suite (`vitest run --project unit`): 3922 passed, 0 failed, 733 skipped (DB-dependent,
  no `DATABASE_URL` in that run).
- New e2e spec `e2e/card-429-error-state.spec.ts` (adapted from the review's paste-ready
  reproduction, extended to both cards): forces each card's endpoint to 429 via route interception
  and asserts the error text appears. **Ran against the real dev server** (StrictMode on, the same
  conditions CI uses) — both pass, twice in a row.
- Rendered both error states live in the browser (screenshot) against a running `pnpm dev` +
  local Postgres, logged in as the seeded user, with the routes forced to 429.
- `pnpm tsc --noEmit` / `eslint` on all touched files — clean.
- `pnpm check:rules` — Ran 55 of 55.

## Not exercised

Device/APK and offline — `cachedFetch` cannot revalidate at all offline, so this class doesn't apply
there the same way. The other ~10-18 candidate cards from the 2026-08-18 sweep remain an
unenumerated worklist (see the backlog entry's `Keep:` line); several are likely legitimate empty
states and need per-file judgement, not a bulk conversion.

<a id="2026-08-24-db-maintenance-off-native-gate"></a>

# Server-side disk maintenance renders on a desktop (Q-544)

**Branch:** `fix/admin-db-maintenance-off-native-gate` · **Lane B** · v1.363.4

## What shipped

`DbFootprintCard` and `DeviceMetricsPanel` moved out of `OuraBleDebug` and onto
`app/admin/oura-ble/page.tsx`, **above** `<OuraBleDebug />`. Neither touches the Capacitor plugin —
both read only `/api/oura-ble/*` — and both were unreachable outside the APK purely because of where
they were rendered.

`OuraBleDebug` early-returns a *"Native OuraBle plugin unavailable"* banner when the plugin is
absent and renders nothing after it. Everything downstream of that return was APK-only, which is
correct for the BLE levers and wrong for these two.

## Why the gate mattered more than it looks

`VACUUM FULL` takes an `ACCESS EXCLUSIVE` lock, so **the APK is the one client blocked while it
runs**, with a WebView timeout free to swallow the response. And if the APK is broken, uninstalled
or mid-rebuild, the disk could not be reclaimed *at all* — which is exactly the situation where a
full volume is most likely. On 2026-08-18 the workaround during the `disk_full` recovery was a
hand-typed `fetch()` from a desktop console.

`DeviceMetricsPanel` was the panel BF-10 fixed and then could not observe, for the same reason.

## Q-544's second half was Q-316

The entry's second half — the pack backfill having no button — shipped separately today as Q-316.
This PR is what makes that button reachable from anything but the phone.

## Verification

Driven in a browser against `pnpm dev` + local Postgres, as an admin user, with **no native plugin**
(so `OuraBleDebug`'s unavailable banner is present on the page throughout — confirmed, not assumed):

- **DB footprint** renders, with all three controls: *Null historical decoded*, *Reclaim disk —
  VACUUM FULL*, *Pack sealed frames*, plus *"1 bucket(s) packable"*.
- **Device metrics** renders.
- Both sit **above** the banner in document order.
- One control was actually driven from that desktop context: pack returned *"packed 1 bucket(s) ·
  40 frames → 244 B · nothing left to pack · 0.2s"*.
- Zero page errors.

`tsc --noEmit` clean · `eslint` zero new warnings · `pnpm check:rules` **Ran 55 of 55**.

## Not exercised

**VACUUM FULL itself was not pressed** — it rewrites the table under an exclusive lock and there was
nothing to reclaim on the local seed. What this PR changes is where the button renders, and that was
proven by driving its neighbour through the same code path.

The genuinely native panels — `RawStoreStatusConsole`, the SleepNet dump, the sensor probe,
`SampleInspector` (which takes plugin-sourced props) — deliberately stay behind the gate.

Nothing checked on the S25. The APK's view of this page changes: the two cards now appear above the
console rather than inside it. That is a layout change worth a look on device.

<a id="2026-08-24-deload-visible-on-both-surfaces"></a>

# 2026-08-24 — a deload session says so, on both surfaces (BF-8)

**PR:** `fix/deload-visible-on-both-surfaces` · **Lane B**

## What was wrong

The Intensity control read **"Full · As prescribed"** while the AI card directly below it read
**"Deload session · Auto-applied"**. Mid-session the header read **"Accumulation · S1 · Ex 1/5"**
with no deload marker anywhere. The owner trained one of those believing it was a full session and
confirmed it: *"I was under the assumption I was doing my full session but it looks like it has been
deload... its too hidden."*

**Both surfaces failed on the same predicate, and that is the root cause.** `isDeloadActive` answers
*"is the current PHASE a deload week"*. Neither surface asked *"is today's session a deload"*, which
is what `prescription.deload` holds — so a readiness-driven, auto-applied deload was invisible from
the pre-workout screen through to the last set.

## What shipped

- **`components/workout/utils.ts` → `sessionContextLabel(phaseStatus, sessionIsDeload)`.** The
  header's line, resolved in one place. A session deload is called out **and keeps the phase
  context**: a phase deload has no cycle position worth printing, but a readiness deload inside
  Accumulation still happens somewhere, and dropping "Accumulation · C2/4" to say "Deload" alone
  trades one missing fact for another.
- **`use-deload-choice.ts` adopts the prescription.** The state was seeded from `?aiDeload=1` and
  nothing else, so with no param it said "Full" regardless of what was prescribed. **A later choice
  still wins** — adoption stops the first time the user touches the toggle (the URL param counts as a
  touch), because the toggle is live and what it says is what will run.
- **The sublabels follow the prescription.** "As prescribed" sat permanently under Full, which is the
  sentence that contradicted the card. When the engine has applied a deload, Full is now labelled
  **Override** and Deload carries "As prescribed".

## Decisions worth not re-litigating

**The toggle is not hidden on an auto-applied deload**, per the entry and the comment at
`pre-workout-screen.tsx:215`: gating it on an existing prescription would leave no way to pick Deload
before one exists.

**A `consumed` prescription is ignored.** Its deload flag describes a session that has already run,
so adopting it would relabel the next one.

**`prescribedDeload` is derived inside `pre-workout-screen.tsx` from the periodization it already
holds**, not passed down. The label is a statement *about* that prescription, and reading it from
somewhere else is how the two came to disagree in the first place.

**`ActiveWorkoutScreen` takes the finished label, not `phaseStatus`.** That prop was used for nothing
else in the file, so passing the resolved string removes a prop rather than adding one — which is
also what kept `workout-screen.tsx` off its size ratchet.

## Verification

- `components/workout/__tests__/session-context-label.test.ts` — six cases, including that the phase
  context survives a session deload and that a phase deload still prints on its own.
- `e2e/deload-visible.spec.ts` — the state the entry says would confirm the bug: an **auto-applied
  deload in a non-deload phase**, with no `?aiDeload=1`. It asserts on `aria-checked` rather than
  styling (the selected half is distinguished by background colour, and colour alone is not a state),
  that "As prescribed" lands on the prescribed half, and that choosing Full still overrides and holds.
  **Mutation-checked: both tests fail with the adoption removed.**

Full local gate: 4,568 tests, 53 of 53 Custom Rules, lint clean.

**Not exercised:** the active workout header end to end. Its label logic is pinned by the unit tests
and the prop wiring is one line in the diff, but no spec starts a workout and reads the header — and
none of this ran on the device.

<a id="2026-08-24-devices-card-ring-key-state"></a>

# The Devices card stops calling the ring healthy when it has no key (LB-5)

**Branch:** `fix/devices-card-ring-key-state` · **Lane B** · v1.359.0

## What was wrong

`OuraConnectionSection` (the ring card on More → Devices) reads its state entirely from server
data — `/api/oura-ble/freshness` and the battery cache. Both keep reporting whatever the server
last recorded for as long as those rows exist, regardless of whether the native BLE service is
actually running. After an uninstall/reinstall (which destroys the stored key —
`OuraBlePlugin.kt`'s comment: *"the key never leaves SharedPreferences; never logged"*), the
service logs `no key stored` and refuses to start, while this card kept showing *"Ring synced 2h
ago"* from before the reinstall. The one screen someone would open to find out why the ring
stopped syncing was the one screen that couldn't tell them, because it was never asking the thing
that actually knows: the plugin itself.

## What shipped

`OuraConnectionSection` now calls `hasKey()` on the plugin (`getOuraBle()` +
`plugin.hasKey()`, both already exported from `lib/oura-ble/plugin.ts`) on mount, alongside the
existing battery/freshness fetches. When it resolves `false`, the whole card is replaced with an
amber "No ring key stored" state that links to `/admin/oura-ble` — it takes priority over the
normal healthy/unseen card, since a ring that synced recently but has no key *now* is not healthy,
whatever the server-derived data still says.

Nothing on this card reveals or re-enters the key — it only navigates to the admin console, per the
entry's explicit constraint (the owner's backup affordance is deliberately behind one entry point,
not two). `getOuraBle()` returning `null` (web, or an APK built before the plugin existed) leaves
`hasKey` at `null`, and the card renders exactly as it did before this change — the keyless branch
only activates on a real `false`.

## Verification

- `pnpm tsc --noEmit` / `eslint` — clean.
- Rendered the Devices screen against the running dev server (real login, real Postgres): no crash,
  no page error, the card renders identically to before — `getOuraBle()` is absent on web, so
  `hasKey` correctly stays `null` and the new branch never fires.
- **The keyless branch itself can't be reached in the web sandbox** (`getOuraBle()` returns `null`
  there by construction), so verified it directly: temporarily forced the state to `false`, took a
  screenshot confirming the amber card renders with the right copy and links to `/admin/oura-ble`,
  then reverted the change before committing — nothing shipped from that step.
- `pnpm check:rules` — Ran 55 of 55.

## Not exercised

**The real path — an actual reinstalled device with a genuinely missing key — was not seen.** Only
the inert web branch (`hasKey` stays `null`) and a locally forced `hasKey === false` were verified;
the actual `getOuraBle()` → `plugin.hasKey()` round-trip against the native plugin only runs on the
APK. `Gate: device` on the backlog entry.

<a id="2026-08-24-drop-session-rpe-prompt"></a>

# The end-of-workout "how hard was that session?" prompt is gone (Q-420)

**Branch:** `feat/derive-session-rpe-from-set-rpe` · **Lane B** · v1.357.0

## What was wrong

`done-screen.tsx` asked *"How hard was that session?"* with a 1–10 tap grid every time a workout
finished. The owner said twice they can judge a single exercise's proximity to failure but not a
whole session as one number, and production agreed: only 25.6% of completed sessions ever got a
rating, against 59.7% of individual sets.

Lane A already shipped the fix this entry was blocked on: `sessionEffort()`
(`packages/shared/src/workout/derive-session-rpe.ts`) derives a session's intensity from the mean of
its rated sets at read time, no schema change, no stored column, self-reported always winning when
present. `health-trends` already consumes it. What was left was item 1 of the owner's four-item
decision — delete the prompt that made it necessary to type a number nobody could judge.

## What shipped

- The 1–10 tap grid, its heading (`sessionRpe`/`handleRpeTap`/`rpeSubmitting` state and the POST to
  `/api/workout-sessions/rpe`), and the now-unused `userId` prop (its only reader was that handler,
  reaching the local store to queue the mutation) are gone from `done-screen.tsx`.
- The kcal-estimate card that shared the same wrapper div — the number, the activity-type picker,
  the training-stress badge — is unchanged. It's a separate concern from the prompt and the owner
  never asked for it to move.
- `loadEnergy`'s request to `/api/workout-sessions/[id]/energy` no longer sends an `rpe` query
  param. `estSessionKcal` already treats a missing RPE as `'moderate'` intensity, and overrides it
  entirely with heart rate when the session has one — so this needed no server-side change, and the
  done screen's own kcal estimate keeps working exactly as before for the common (HR-present) case.

## What's deliberately left alone

`POST /api/workout-sessions/rpe`, the `pushMutations` `session_rpe` domain, and
`lib/local-store`'s `setSessionRpe` are now unreachable from any client call site — the prompt was
their only caller. Not removed: they're Lane A files (`app/api/**`, `lib/data/**`,
`lib/local-store/**`), and retiring dead server/local-store code is a separate decision from
deleting a UI prompt. Noted in the backlog entry rather than acted on.

## Verification

- Full unit suite (`vitest run --project unit`): 3925 passed, 0 failed.
- `pnpm tsc --noEmit` / `eslint` on both touched files — zero new warnings (compared the same lint
  output against the pre-change file: the 7 pre-existing `workout-screen.tsx` warnings and the 1
  pre-existing `done-screen.tsx` warning (`dynamic` unused, predates this change) are unchanged).
- `pnpm check:rules` — Ran 55 of 55. One genuine ratchet to fix along the way:
  `check-client-today-timezone.js`'s per-file baseline for `done-screen.tsx` was 2 and the file
  legitimately dropped to 1 (the handler's bare `todayInTz()` call went with it) — lowered in the
  same PR per the script's own shrink-only rule.
- Rendered `DoneScreen` directly (a scratch route, removed before committing) against the running
  dev server, logged in as the seeded user: no crash, no RPE prompt text anywhere on the page, the
  XP/stats/next-workout/share section renders exactly as before.

## Not exercised

Not driven through a real completed workout end-to-end (would need a full workout session through
the UI); the scratch-mount check above covers the component rendering correctly with the prompt
gone, not the full done-screen flow from an actual `complete-workout` call. Not checked on device.

<a id="2026-08-24-finish-logging-above-end-of-day"></a>

# 2026-08-24 — the finished-logging control moves above End of Day (BF-6)

**PR:** `fix/finish-logging-above-end-of-day` · **Lane B**

## Why a layout preference was not one

The owner asked for the swap in those terms: *"id also like to move the finish logging button and
swap it with the end of day button. end of day should be at the very bottom. finish logging should be
right after the meals."*

The measurement behind it is what makes it a bug rather than a preference. `FoodLoggingComplete`
feeds Q-387's adaptive-TDEE calibration, and that calibration treats an unmarked day as **excluded**,
not as a light one — so an unpressed button does not degrade the estimate, it withholds it entirely.
**0 of 55 `day_checkins` rows carried `food_logging_completed_at`** across 2026-07-02 → 2026-08-24.
The feature had never taken a single input since it shipped seven weeks earlier.

## What shipped

One reorder in `app/nutrition/nutrition-content.tsx`: meal cards → **finished logging** → weekly
chart → supplements → **End of Day**.

## The comment that argued against it

Line 638 carried a note saying End of Day *"deliberately stays put"*. It was defending against
**merging the button into Home's "Your Day in Review" banner** — still Q-112's call, still not this
change — and never against moving it down its own screen. An implementer who read it and stopped
would have done the right thing with the wrong information, so it is rewritten in this diff rather
than deleted or ignored.

The comment on `FoodLoggingComplete` needed the same treatment, and it was one I wrote in #330: it
argued the control belongs last because *"I have finished logging" is a claim about the whole day*.
That reasoning is sound about the sentence and was overtaken by seven weeks of evidence about the
control. It now records both.

## Verification

`e2e/nutrition-tail-order.spec.ts` asserts by **vertical position**, not DOM index — what went wrong
was where the control sat on screen, and an ordering check on DOM index would pass against a page
that paints them anywhere. Two cases, because both the finished-logging card and Supplements are
today-only and the tail of the screen changes shape on a back-dated day, which is what the entry asks
for. The past date is read from Postgres in the user's timezone, never
`new Date().toISOString().slice(0, 10)` — that is the UTC date and it is yesterday in Brisbane until
10am.

**Mutation-checked: both tests fail against the pre-change order.**

**Not verified on device.** This is a scroll-order change on the screen the owner uses most, and the
sandbox is not the S25.

<a id="2026-08-24-frame-packer-control"></a>

# The frame packer has a button (Q-316)

**Branch:** `feat/frame-packer-control` · **Lane B** · v1.363.3

## What shipped

A third control in `db-footprint-card.tsx`'s ① Data section, beside "Null historical decoded" and
"Reclaim disk — VACUUM FULL". It drives `GET`/`POST /api/oura-ble/samples/pack`, which existed and
could only be reached by curl.

- The `GET` count renders beside the button — *"1 bucket(s) packable"* / *"no sealed buckets to
  pack"* — so the number of presses left is visible, and the button disables at zero.
- After each press the footprint reloads, so `oura_raw_samples` shrinking and `oura_raw_packed`
  growing show up in the same table.

## The confirm copy is deliberately not the VACUUM copy

The VACUUM dialog says *"No data is lost"*. That is true of this one too — frames are moved, and the
packer refuses to delete a bucket it cannot prove equal after re-reading the blob. But this is the
**only control in the app that issues a DELETE against archival frames**, and copy that reads
identically to a lossless VACUUM trains the wrong instinct. So it says what it does: moves sealed
buckets older than 7 days into compact blobs, each blob re-read and its frames proved identical
before the originals are deleted, and names the fact that it deletes archival frames at all.

## A refusal is a finding, not a no-op

`refused > 0` means a bucket could not be proved equal and was left intact. The summary line carries
**"⚠ N refused and left intact"**, and each refused bucket is listed with its epoch, tag, ds bucket,
frame count and the server's reason. Without that it would read as "packed 0", which is the same
text a run with nothing to do produces.

## Verification

Driven in a browser against `pnpm dev` + local Postgres, with `oura_raw_samples` seeded so a sealed
bucket existed (40 frames at a low ds, one newest frame past the 7-day hot window, `recorded_at`
older than the 1-day quiet interval):

- **idle** — *"1 bucket(s) packable"*.
- **real pack** — *"packed 1 bucket(s) · 40 frames → 244 B · nothing left to pack · 0.0s"*;
  `oura_raw_samples` **242 → 202** rows, `oura_raw_packed` **0 → 1**, and the count line flipped to
  *"no sealed buckets to pack"* with the button disabled.
- **refusal rendering** — with the POST response replaced by a payload carrying one refused bucket:
  *"packed 1 bucket(s) · 12 frames → 88 B · ⚠ 1 refused and left intact · 3 still packable — press
  again · 1.2s"* over *"epoch 0 tag 134 bucket 1 (40 frames): verify mismatch: 39 of 40 frames
  matched"*.
- Zero page errors throughout.

`tsc --noEmit` clean · `eslint` **zero warnings introduced** (the one on this file, `runBackfill`'s
unnecessary `stats` dependency, is pre-existing — confirmed by linting the base copy) ·
`pnpm check:rules` **Ran 55 of 55**.

## Not exercised

**A genuine refusal was not produced** — only its rendering, by substituting the response. Forcing a
real verify mismatch means corrupting a blob between write and re-read, which is the server's own
path and was already proven by Lane A (251 frames → 10 blobs, API dump hashing identically before
and after). What this shipped is the client half, and that is what was driven.

**The card is reachable only from the APK.** `DbFootprintCard` renders inside `OuraBleDebug`, which
returns the native-unavailable banner and nothing after it whenever the plugin is absent — the same
gate BF-10 documented. Everything above was driven by mounting the card directly on a scratch route,
off the gated page. The button in its real home is owed an on-device check.

Nothing checked on the S25.

<a id="2026-08-24-invalidate-after-push-sweep"></a>

# 2026-08-24 — sixteen writes revalidated around their push, not after it (LB-6)

**PR:** `fix/invalidate-after-push-sweep` · **Lane B**

## The bug, once

`pushMutations` is fire-and-forget. An invalidation written beside it fires while the server still
holds the pre-write state: every `useCachedValue` subscriber wakes on that signal, refetches the old
payload and **re-caches it**, and nothing invalidates again — so the stale value stands for the key's
full TTL. Home's Energy Balance card read 42 kcal high for exactly this reason (LB-4).

`pushThenRevalidate(userId, invalidator)` is the fix, and it already existed: the caller still
invalidates immediately — offline that is the only signal that will ever fire — and the helper runs
the same invalidator again once a push actually moved something.

## The entry said six. There were sixteen.

Its finder was *"a `pushMutations(` call with an `invalidate…(` within the six lines above it"*, and
**five sites write the invalidation below the push instead** — `water-log-sheet`,
`manage-supplements-sheet` ×3, `supplements-section`. The ordering of those two lines makes no
difference: neither is chained to the push's resolution.

Four more the entry never saw: `injury-sheet` ×3 and `done-screen`, where the invalidation sits after
an `if/else` that both branches fall through to.

And one I introduced myself in #333 the same week the helper shipped, copying the old shape from a
sibling: `packages/shared/src/nutrition/save-plan-meal.ts`.

**`app/nutrition/nutrition-content.tsx` had the mirror image** and was cited by the entry as the
shape to copy *toward*. It invalidates **only** after the push — which the helper's own docblock
says is worse: `pushMutations` never resolves usefully with no network, so an offline food-log
delete repaints nothing at all. It now does both halves.

## Why this became a check

`scripts/check-invalidate-after-push.js` fails Custom Rules on the class (55 steps now). Prose did
not hold it: LB-4 fixed three engine paths, LB-6's own finder missed five more, and a sixteenth was
written by hand days later. Two shapes are deliberately not hits — a bare `pushMutations` with no
invalidation near it (the Sync buttons and the provider's own passes own no cache key), and an
**awaited** push, where whatever follows already runs after the server has the write.

Mutation-checked: the check reports all sixteen against the pre-change tree and zero after.

## What is not claimed

**Which of the sixteen were load-bearing was not audited.** Per `CLAUDE.md`'s "what makes an
invalidation load-bearing", a stale entry only *settles* where a call site passes `freshWithinTtl` or
a read path is seed-only; elsewhere `cachedFetchCore` revalidates anyway and the cost is a briefly
stale paint. All sixteen are converted regardless — the cost is one line, and the condition changes
the moment someone adds `freshWithinTtl` — but no user-visible fix is claimed for any specific one.

**Not verified on device.** Every one of these paths writes to the local store and queues an outbox
mutation, and `getLocalStore` returns null in a browser, so the entire converted branch takes the web
fallback here. The ordering is verified by reading and by the helper's own unit tests.

Full local gate: 4,582 tests, 55 of 55 Custom Rules, lint clean.

<a id="2026-08-24-meal-plan-to-saved-meals"></a>

# 2026-08-24 — the meal plan produces saved meals, and its write routes work again (Q-398)

**PR:** `feat/meal-plan-to-saved-meals` · **Lane B** (with a five-line Lane A fix, below)

## What shipped

Every meal of the active plan now carries **Save to My Meals**, with a **Save all N** beside the
list. A saved plan meal is an ordinary `saved_meals` row: it logs in one tap, prints a label with a
QR, and can be edited ingredient by ingredient. That is the whole point of the owner's framing —
*"the meal plan wont be used too much; it will be created - then likely not used again"* — a plan is
a **batch generator**, and what should outlive it is meals.

- `packages/shared/src/nutrition/save-plan-meal.ts` — `savePlanMealToLibrary` (one meal) and
  `savePlanMealsToLibrary` (a batch, stamping each result back onto its plan meal). Offline-first,
  with the Q-216 fall-through shape: the local write has its own catch and the API call sits outside
  it.
- `components/nutrition/plan-meal-row.tsx` — the plan card's meal row, extracted so the section did
  not grow a fourth action inline.
- `app/nutrition/use-plan-meal-saving.ts` — the UI state, mirroring `use-plan-meal-logging.ts`.
- `lib/hooks/use-plan-saved-meal-ids.ts` + a **From plan** tag on the My Meals row.

## Decisions worth not re-litigating

**No schema change, and none was needed.** Lane A's pre-check on this entry (2026-08-19) had already
established that `meal_plan_meals.saved_meal_id` exists, is `ON DELETE SET NULL`, and survives a
regenerate. That column is the idempotence key — better than the `(plan id, plan item id)` key the
entry proposed, because it is already preserved by `structure/route.ts`. Deleting the saved meal
clears the stamp through the FK, so the offer correctly comes back.

**Provenance is derived, not stored.** A saved meal is plan-derived exactly when some plan meal
points at it. A `from_plan` column would be a second copy of that fact and would go stale the moment
a plan was deleted.

**The conversion is shared with logging, not re-written.** `ingredientToEntry` in `log-plan-meal.ts`
was already the per-100g convention — a food item stored per 100 g with the weight carried in the
multiplier, so the library gains "Rolled Oats" rather than "Rolled Oats (250 g)". It is exported
rather than copied; two conversions would have drifted the first time either rounded differently.

**The setup sheet's own copy path is gone.** `saveTickedMealsToLibrary` was a second implementation
that created food items with a bare POST (no local store, no outbox, no `nutrition-food-items-all`
invalidation — the three gaps `createFoodItem` exists to close) and never stamped anything, so a meal
ticked at setup and then saved from the plan card produced **two copies of the same recipe**. Both
surfaces now call `savePlanMealsToLibrary`, and the setup path stamps against the persisted plan
rather than the draft, which has no ids to stamp.

**Not done, deliberately:** step 3 of the entry — deleting `meal-plan-section` and the staleness nag
— which the entry itself gates on owner confirmation. It stays open as its own question.

## The bug this uncovered: the meal plan could not be written to at all

While asserting that the copy stamps `saved_meal_id`, the PATCH silently did nothing. Five routes
had this shape:

```ts
let raw: unknown
const read = await readJsonLimited(req, MAX_BODY_BYTES)
if (!read.ok) { … }
const parsed = Schema.safeParse(raw)   // ← `raw` was never assigned
```

`raw` is `undefined`, every Zod object schema rejects it, and the route answers
`400 {"error":"Invalid input: expected object, received undefined"}` to **every** request. Confirmed
at runtime against the dev server, not inferred from reading: `POST /api/nutrition/meal-plans` with
a valid body returns exactly that.

Dead on `main`: creating a plan, renaming / activating / deleting one, restructuring it (meals per
day, training time, re-anchoring), editing a single meal, and saving dietary restrictions. TypeScript
was happy — `unknown` is what `safeParse` takes — and no test caught it, because the whole meal-plan
write surface has no route-level test.

These are `app/api/**`, which is Lane A's. Fixed here rather than handed over: it is a one-line
change per file, it blocks this entry's own stamp, and leaving a whole feature answering 400 while
the handover waited was the worse option. **`scripts/check-json-body-parsed.js`** now fails Custom
Rules on the class — for each `const <name> = await readJsonLimited(…)` it requires `<name>.body` to
be parsed. It reads the binding's own name because five healthy routes call it `result`. Custom Rules
went 52 → 53 steps.

## Verification

`e2e/plan-meal-to-saved-meal.spec.ts`, five tests: the copy's rows (a food item stored per 100 g, the
multiplier carrying the 250 g), the stamp, the kept state, "Save all 1" after one meal is already
kept, no duplicate of the first, and the From plan tag. **Assertions are on the copied rows, not on a
toast** — every button here reports success before its write resolves, so a control wired to nothing
produces the same screen.

Two fixture traps worth carrying: `saved_meals` has **no `deleted_at`** (hard delete), and
`createFoodItem` runs `sanitiseNutrition`, which recomputes calories from the macros once they
disagree by more than 40% — so a fixture with decorative macros asserts against the sanitiser rather
than against the copy.

Full local gate: 4,513 tests green, 53 of 53 Custom Rules, lint clean (0 errors), full e2e green.

**Not exercised:** the device path. The browser has no native SQLite, so `getLocalStore` returns null
and every run here took the web fallback — the local-store mirror and the outbox mutations are owed
an on-device check, as are the new controls' 48dp targets on the S25.

<a id="2026-08-24-memo-call-site-stability"></a>

# The memo baseline is empty now, and the list site was the one that mattered (Q-357)

**Branch:** `fix/memo-call-site-stability` · **Lane B** · v1.349.0

## What was wrong

`memo()` compares props shallowly, so **one** inline arrow at a call site defeats it entirely — and
the component keeps its `memo(...)` wrapper and keeps reading as optimised. Q-490 shipped
`scripts/check-memo-prop-stability.js` with four such sites baselined. This clears all four and
empties the baseline, so a new one is a regression rather than a debt row.

The scanner already computed a per-site `detail` list and never printed it; running it with that
line uncovered is how the four were located, rather than by grep.

## The expensive one, and why it needed a different fix

`components/nutrition/saved-meals-sheet.tsx:598` renders `<SavedMealCard>` inside
`visibleMeals.map(...)` with **five** inline arrows. A hook is not allowed inside a `.map()`, so the
usual "wrap it in `useCallback`" does not apply — which is exactly the case CLAUDE.md's memo rule
carves out: *pass scalars, or move the identity into the child.*

The child already holds `meal`. So each callback now **takes the meal and hands it back**
(`onLog: (meal: SavedMeal) => void`), which lets the parent share one stable `useCallback` per
action across every card. That is also the shape the mutation-callback contract asks for anyway — a
callback that carries the entity rather than a parameterless "something happened".

The parent's five handlers were plain `function` declarations, so they were re-created every render
even before this; they are `useCallback` now. Two are stable by React's guarantee rather than by
hope (`openBuild`, `toggleSelected` touch only setters); `quickLog` and `deleteMeal` list their real
closures, so they change when their inputs do and not on every keystroke.

## The other three

- `app/nutrition/nutrition-content.tsx` (×2) — `MealPlanReviewCard` and `MealPlanSection`, four
  inline arrows between them, all setter-only. Four named `useCallback`s.
- `components/oura-ble/oura-ble-debug.tsx` — `LogConsole`'s `onClear`. Admin-only, but this console
  appends a line **per BLE frame**, so it is the one screen where re-rendering the whole log on
  every render is measurable.

## Verification

- `node scripts/check-memo-prop-stability.js` — **75 memoised components, 0 defeated call sites**,
  against an empty baseline.
- `pnpm check:rules` — Ran 55 of 55. Typecheck clean; lint unchanged (0 errors).
- `e2e/food-logging-complete.spec.ts` + `plan-meal-to-saved-meal.spec.ts` — 7 passed.
- `e2e/meal-label.spec.ts` + `food-row-shared.spec.ts` — 6 passed. These are the specs that drive
  `SavedMealCard`'s label and log controls, i.e. the callbacks whose signatures changed.

## Not exercised

**No measurement of the render saving.** The change is justified by the rule and by the shape (a
memo defeated inside a `.map()` re-renders every row), not by a profile — nothing here counted
renders before and after, and on a list of the owner's current size the saving may be small.

**Not checked on the S25**, and the Samsung WebView is where a re-render cost would actually show.
`oura-ble-debug.tsx` in particular is an admin surface that only does anything with a ring
connected, so its change is verified by reading.

<a id="2026-08-24-metric-bounds-at-keyboard"></a>

# The bounds existed for months; the client never asked (Q-321)

**Branch:** `feat/validate-metrics-at-the-keyboard` · **Lane B** · v1.348.0

## What was wrong

`packages/shared/src/validation/body-metrics.ts` holds a threshold for every body metric, and both
the web route and the sync-push branch import it. **Nothing under `components/` or `app/` did** —
verified by grep, and it is the whole finding. `components/health/metric-log-sheet.tsx` checked only
`valueNum <= 0`.

So a 5,000 kg weight was accepted by the sheet, written to the local store, queued as a mutation,
pushed, and discarded server-side. The number the user typed appeared nowhere afterwards.

## What Q-321's own framing missed

The entry named `metric-log-sheet.tsx`. There are **three** client surfaces writing
`domain: 'body_metrics'`, and the other two matter more:

- **`app/session-select/components/log-value-sheet.tsx` had no bounds check at all** — not even the
  `> 0` its sibling carried — across **seven** fields: weight, steps, calories, the three macros and
  water.
- **`components/profile/water-log-sheet.tsx`** takes a custom millilitre amount, and
  `validWaterMlDeltaOrNull` is one of the **two** validators that *quarantines* rather than coerces.
  An over-5,000 ml entry therefore dead-lettered into a badge the user cannot act on — which is the
  outcome Q-321's own decision section argues hardest against. Of the fields this change covers, it
  is the one that was actually costing something.

## The change

`components/health/metric-bounds.ts` — one map from the field name each sheet already uses to the
validator and bounds already in the shared module, plus the message. **No new thresholds**: every
bound is imported, so the client and server cannot disagree about what is acceptable. All three
sheets call `metricBoundError(field, raw)`, render it inline, disable Save on it, and re-check it in
the save handler so "never queue the value" is true rather than merely hard to reach.

One behaviour change worth naming: **0 steps is now accepted.** `STEPS_MIN` is 0, and the old
`valueNum <= 0` refused it — a disagreement with the server, in the direction of refusing something
valid. Pinned by test so a future "must be positive" tidy-up cannot bring it back.

`validStepsOrNull`'s fractional-rounding bug, which the entry asked to fix in the same PR, **was
already fixed** on `main` by the Lane A half. Confirmed by reading it, not assumed.

## The measurement that corrected this PR's own test

The obvious guard is "the value must not reach `body_metrics`". I wrote that, then mutation-checked
it by restoring the old `valueNum <= 0`, saving 5,000 kg, and polling the table — **it passed.**

`getLocalStore` returns null in the web sandbox, so the sheet takes its API fallback, and
`BodyMetadataPostSchema` refuses 5,000 with a 400. The row was never written either way. The path
the entry describes — stored locally, queued, pushed, discarded — is the **device** path and cannot
run here at all.

So the database poll is kept as an invariant but is **not** the guard. The discriminating assertions
are the two client ones — the inline message naming the bound, and Save disabled — and those do fail
on the old check. The spec's own docstring records this, because "assert on the database, not the
toast" is normally the right instinct and here it was wrong.

## Verification

- `components/health/__tests__/metric-bounds.test.ts` — 10 cases: every boundary inclusive on both
  ends, the 5,000 kg case by name, zero steps, water strictly positive and capped, an unbounded
  field staying saveable, and a coverage case asserting every field the three sheets can pass has a
  bound (otherwise the guard is a silent no-op for it).
- `e2e/metric-bounds-at-keyboard.spec.ts` — 4 passed, including a plausible weight still saving, so
  a bound that refused everything would not pass.
- `pnpm check:rules` — Ran 55 of 55. Typecheck and lint clean.

## Not exercised

**The device path was not run, and it is the one the defect lives on.** `getLocalStore` returns null
here, so the local-store write and the outbox queue in all three sheets took the API fallback in
every test above. On the APK the guard runs before either, which is read from the code rather than
observed. Not checked on the S25.

**`log-value-sheet.tsx` and `water-log-sheet.tsx` were not driven end to end** — their bounds are
covered by unit test and by reading, not by a browser pass; only the weight sheet has an e2e path.

<a id="2026-08-24-recipe-spec-structural-attribution"></a>

# A guard that survived deleting the thing it guarded (LB-7)

**Branch:** `fix/recipe-spec-structural-attribution` · **Lane B** · `e2e/` + one `data-testid`

## What was wrong

`e2e/recipe-url-to-meal.spec.ts` checked that a scraped recipe shows its attribution with:

```ts
await expect(dialog.getByText('example.com').last()).toBeVisible({ timeout: 20_000 })
```

`.last()` hit the attribution *because the attribution renders after the name* — a position, not an
identity. `MyMealsPicker` creates the row with `name: hostOf(url)` the moment Enter is pressed and
keeps that name until the scrape resolves, so during the `looking` window **the host is on screen
twice**: once as the name, once in the attribution. Delete the attribution and `.last()` lands on
the name.

## It was measured, not reasoned

The entry asserted the hole; asserting it is not the same as having it. Two runs, against the same
component mutated to `{false && m.sourceUrl && (…)}`:

1. **With the mock fulfilling immediately, the old assertion FAILED.** The scrape resolved before
   the locator did, so the real name had already replaced the host and the only remaining
   `example.com` was the deleted attribution. On this evidence alone the guard looks fine.
2. **With `await new Promise(r => setTimeout(r, 8000))` before `route.fulfill`, it PASSED** — with
   no attribution anywhere on screen. The `looking` window was wide enough for the locator to match
   the name.

So the guard is not reliably hollow; it is hollow **whenever the scrape is slow** — the condition CI
is most likely to produce and a local run least likely to, which is the worst shape a test defect
can have. The first run's red is not the answer.

## The fix

`data-testid="meal-source-attribution"` on the attribution row, and the spec asserts on that row:

```ts
const attribution = dialog.getByTestId('meal-source-attribution')
await expect(attribution).toBeVisible({ timeout: 20_000 })
await expect(attribution).toContainText('example.com')
```

The later `from a 12-serve recipe` check moved onto the same locator too — that suffix renders
*inside* the attribution row, so pinning it to the row that owns it costs nothing and stops it
drifting into a bare dialog-wide text match.

Mutation-checked both ways: the new assertion fails on the mutated component (fast mock **and**
slow), and passes on the real one.

## Verification

`npx playwright test e2e/recipe-url-to-meal.spec.ts` — 4 passed. `pnpm check:rules` — Ran 55 of 55.

## Not exercised

Nothing user-visible changed — the only production edit is a `data-testid` attribute. There is no
device behaviour here to check on the S25.

No `projectOverview.md` note: test hardening with no Known Issue attached, in a file on a
shrink-only ratchet that every session reads before it can start.

<a id="2026-08-24-recipe-url-to-meal-ui"></a>

# 2026-08-24 — a recipe link becomes a meal, and an unstated yield gets asked about (Q-409, Lane B half)

**PR:** `feat/recipe-url-to-meal` · **Lane B**

## What shipped

The "meals you usually eat" step of the meal-plan wizard takes a URL. A URL is a **third input mode
beside image and text, resolving to the same shape**, so the widget, the `keep` semantics and the
downstream plan payload needed no change — which is why this is a few lines rather than a subsystem.

- `components/nutrition/my-meals-picker.tsx` — detect an `https:` URL, send `{ url }` instead of
  `{ text }`, show the source host, and ask how many the recipe serves when the page did not say.
- `packages/shared/src/nutrition/scan-totals.ts` — `perServing(ingredients, servings)`.
- `app/api/nutrition/scan/route.ts` — now calls that helper instead of its own inline map.

The route half (the `https:`-only guard, the SSRF checks, the JSON-LD parse, the divide on a stated
yield) shipped in PR #180 and is untouched here.

## The part that is not cosmetic

**`recipeYield: null` means the payload is the whole recipe.** With a stated yield the route has
already divided and its notes lead with *"Per serving (1 of 12)"*. Without one, a banana-bread page
measured **1,956 kcal for the loaf**. The entry's rule is *ask, do not assume 1*, so the row:

- shows the whole-recipe figures with the question **"How many does it serve?"**,
- **cannot be kept** until it is answered — keeping it would put a loaf in one meal slot,
- divides on the answer, and flips to kept in the same act, because answering the question **is**
  accepting the meal and asking twice for one decision is worse.

`perServing` is shared rather than copied: the route divides on a stated yield and the picker divides
on an answered one, and a 4× calorie error that looks entirely plausible is exactly the kind that has
to agree by construction.

## Verification

`e2e/recipe-url-to-meal.spec.ts`, two cases. The first asserts the picker sent the link as `url`
(not as free text), that the ask appears, that Keep is absent before it is answered, and that the
answer divides. The second is the mutation the first cannot catch: a **stated** yield must not be
divided a second time — that bug would read as a light meal rather than as an error.

Plus three unit cases on `perServing` itself, including that the per-100g densities are left alone;
scaling those too is the other way to divide twice.

**Mutation-checked twice.** Dropping the divide in `applyServes` fails the first spec. And the first
draft's "Keep is absent" assertion used `/^Keep$/`, which never matches: the button's accessible name
comes from the `<label>` wrapping it, so the guard passed and would have passed just as happily with
the control on screen. It asserts on the real name now.

**The scan route is stubbed in the spec, deliberately** — what is under test is the picker's handling
of a payload shape, and the alternative is CI fetching somebody's recipe site on every run. So this
proves nothing about the fetch, the SSRF guards or the JSON-LD parse; those are the route's own.

Full local gate: 53 of 53 Custom Rules, lint clean, both specs and the unit tests green.

**Not exercised:** a real recipe page, and the device. Nothing here is native, but the wizard's
scroll and tap targets on the S25 are unverified as always.

<a id="2026-08-24-redecode-job-polling"></a>

# The two BLE consoles poll the redecode job instead of guessing at its outcome (Q-318)

**Branch:** `fix/redecode-job-polling` · **Lane B** · v1.363.1

## What shipped

`components/oura-ble/redecode-job.ts` — a small client helper that POSTs
`/api/oura-ble/samples/redecode?async=1`, then polls `GET …?jobId=…` on a 3-second timer until the
server reports `done` or `failed`, and hands back the same phases payload the synchronous route used
to return. Both callers now use it:

- **`oura-ble-debug.tsx`** — the Redecode button. Its old defensive parse ("body may come back
  empty/truncated") is gone; there is nothing to parse defensively any more.
- **`step-backfill-console.tsx`** — "Run backfill now".

## What was actually wrong

Neither console could tell a finished run from a started one. The synchronous route outlives the
gateway timeout on real data, so Railway returns **502 for work that completed** — the debug console
printed `redecode failed: 502`, and a false failure invites a retry, which is another full-history
re-aggregate (the operation Q-535 names as the event-loop starvation that took production down on
2026-08-13). The backfill console had the mirror-image bug: it printed **"Done. Backfill applied"**
the moment the request returned, which is the timeout, not the write.

`alreadyRunning: true` now says so in words — *"a redecode (job N) was already running — this
started nothing; following that run"* — rather than showing progress for a press that started
nothing. There is no client-side poll timeout: the server's staleness reaper turns an abandoned run
into `failed`, so the loop always ends on a status the server stands behind.

The backfill console also surfaces `redecodeError`, which it previously ignored — it only read
`aggregateError`, so a decode-phase failure read as "Done".

## Verification

Drove all three branches end to end against `pnpm dev` + the local Postgres, through the real route,
as an admin user:

- **done** — `redecode job 1 started — this can take minutes` → `DONE job=1 scanned=0 sleep=0`, the
  phases payload arriving from the poll rather than the POST.
- **alreadyRunning** — with a `running` row already in `oura_redecode_jobs`, the press reported
  `job 2 was already running … following that run` and started no second job.
- **failed** — finishing that job with an error mid-poll produced `FAILED: boom from the worker`.

`tsc --noEmit` clean · `eslint` zero new warnings · `pnpm check:rules` **Ran 55 of 55**.

## Not exercised

**`step-backfill-console.tsx`'s run path was not driven at runtime.** The page renders and Preview
works (`0 day(s) would change` against the local seed), but with no affected days the "Run backfill
now" button never appears — reaching it needs seeded `oura_raw_samples` plus inflated historical
step days. Its call is a direct substitution onto the helper proven above, and it typechecks; that
is the evidence, and it is weaker than the debug console's.

**`oura-ble-debug.tsx`'s Redecode button is not reachable in the web sandbox at all** —
`OuraBleDebug` returns the native-unavailable banner and nothing after it whenever the plugin is
absent (the same gate BF-10 documented). The helper it calls was verified through an equivalent
mount; the button itself is owed an on-device check in the APK.

Nothing checked on the S25.

## What is left

**The route's default is still synchronous, and that is Lane A's half.** Q-318's last bullet — drop
`?async=1` and delete the synchronous branch — edits `app/api/oura-ble/samples/redecode/route.ts`.
Both callers now poll, so the seam that kept the default alive is gone; the entry records it as the
remaining step.

<a id="2026-08-24-rekey-declaration-control"></a>

# Declaring a ring re-key has a button (Q-317)

**Branch:** `feat/rekey-declaration-control` · **Lane B** · v1.363.2

## What shipped

`components/oura-ble/rekey-declaration-card.tsx`, on `/admin/oura-ble`. It drives the three verbs
`POST /api/oura-ble/rekey` already exposed (Q-314, Lane A): declare with an optional note, show the
pending declaration with the time it was made, cancel one made by mistake.

## Why an affordance is the point

A re-key restarts the ring's own clock, and the server cannot tell that apart from a history
re-drain by counter shape alone — inferring it re-timed the owner's entire sleep history **twice**.
Q-314's answer was to make it a declaration rather than an inference. A declaration nobody can make
in the app is one that gets forgotten at exactly the moment it is needed: right after a re-key, on a
laptop, mid-`open_oura`.

## Two decisions worth stating

**It sits outside `OuraBleDebug`, as a sibling section on the page.** That component returns the
native-unavailable banner and renders nothing after it whenever the plugin is absent — which is
precisely the situation the laptop doing the re-key is in. Putting the control inside it would have
made it reachable only from the APK, i.e. only from the device that is not being used at that
moment. The declaration needs no ring present; it only needs the server.

**The deferred effect is stated before the button, not after the press.** Nothing happens when you
press it — the new clock value is not knowable until the ring reports, so the next drain consumes
the declaration. A control that looked like it acted immediately would invite a second press, and
the entry's own warning is that a second declaration is a second epoch. The pending state shows the
declaration and its timestamp so the waiting is visible rather than inferred.

Cancel is offered only while `GET` reports something pending. A **consumed** declaration is not
cancellable — the API refuses, correctly, because the epoch it opened already exists and every
timestamp derived from it depends on that row as the audit trail.

## Verification

Driven end to end in a browser against `pnpm dev` + local Postgres, as an admin user:

- **idle → declare** — with a note typed in, the confirm dialog fires the POST; the card flips to
  the pending state and `oura_ble_rekey_declarations` carries the row with `note` persisted.
- **idempotency** — a second POST in the same session returned
  `alreadyPending: true` with *"A declaration was already waiting; this did not queue a second one."*
  and the pending row count stayed at **1**.
- **cancel** — the card returns to idle, reports *"Pending declaration removed."*, pending rows **0**.
- **consumed** — with a row carrying `consumed_at`, the card offers **no** cancel button.
- Zero page errors throughout.

`tsc --noEmit` clean · `eslint` zero new warnings · `pnpm check:rules` **Ran 55 of 55**.

## Not exercised

The **effect** of a declaration was not driven — that needs the next ingest batch from a real ring
to consume it and open the epoch, which no sandbox can produce. This item is the affordance; the
route's own behaviour was already proven end to end by Lane A under Q-314.

Nothing checked on the S25. The card is plain web UI on an admin page, so the APK risk is layout
rather than behaviour, but it is still unchecked there.

<a id="2026-08-24-rest-adherence-clustering"></a>

# Rushed rest does not cluster in time-constrained sessions (Q-300)

**Branch:** `feat/rest-adherence-signal` · **Lane A** · docs-only · no code change

## Why this is a measurement and not a feature

Q-300 asked for one thing before its remaining half could be built: *check whether the rushed sets
cluster in time-budget-constrained sessions before treating this as a user-behaviour finding.*
Building the coaching signal first would have shipped the wrong framing. Full working in
[`docs/reviews/2026-08-24-rest-adherence-clustering.md`](../reviews/2026-08-24-rest-adherence-clustering.md).

## The answer

**No.** On 344 sets across 27 sessions (2026-07-18 → 08-23, the window `planned_rest_sec` exists in),
39.8% are rushed — holding the 37% Q-300 filed on 68 fewer sets. Per-session rushed fraction is mean
0.411, sd 0.138, and **zero of 26 sessions is rush-free while zero is mostly-rushed**. A time budget
is an event and would split the sessions into squeezed and unsqueezed; this is one narrow cluster.

## Two traps, both of which this nearly fell into

**Session duration correlates, and the correlation is circular.** The most rushed sessions are the
shortest — but rest is a *component* of duration, so rushing produces a short session. Reading it as
evidence of a budget infers the cause from its own effect. Duration is not a usable covariate here.

**Q-85's hypothesis has no instances to test.** Every shortened session in the history predates
`planned_rest_sec`; 26 of the 27 measurable sessions are the same 5-exercise shape. So Q-85 is
neither confirmed nor refuted — recorded that way rather than as a clean negative.

## The finding that replaces the framing

Actual rest barely responds to what was prescribed: planned 60 s → **75 s taken** (longer than
asked), 90 → 65, 120 → 110, 187 → 133. Prescribed spans 60–187 s; actual spans 65–133 s. The
coaching line is *"your rest ignores the plan"*, not *"you rushed today"* — the latter is meaningless
when every session rushes. Within-session drift is real (0.32 at exercise 1 → 0.47 at exercise 5) but
sits on a 0.32 floor before any budget could have been spent: time pressure explains the slope, not
the intercept, and the intercept is most of it.

## Not exercised

No code changed, so there is nothing to verify on device. **Q-300 stays open** — the surfacing itself
is unbuilt, and it is a Lane B UI change once the owner has seen this framing. Nothing here licenses
a rest term in `expectedRpe`; the 2026-08-16 measurement already showed rest is not Q-289's confound,
and this adds that the rushing has no session-level structure a model could key off.

<a id="2026-08-24-retire-day-overlay-sheet"></a>

# The day-overlay sheet is gone, and two of its three affordances came with it (LB-3)

**Branch:** `feat/retire-day-overlay-sheet` · **Lane B** · v1.347.0

## What was there

Since Q-110 (2026-08-08) the calendar's day-tap has opened `/health/day`, not the bottom sheet.
`day-overlay-sheet.tsx` survived anyway, and the reason it survived is worth stating: it was the
**only** thing that could open `ExerciseHistorySheet` and `ActivityDetailSheet`, both still rendered
by `health-content.tsx`. So `historyExercise` and `selectedActivity` there could only ever be `null`
— three capabilities gone for a fortnight with no report, which is why LB-1 declined to delete the
file silently.

## The three decisions

**1. Tap an exercise name → its history. PORTED.** The strongest case, as the entry judged: it is
the only route from a logged lift to its 1RM trend outside Stats.

**2. Tap an activity → its detail sheet. PORTED.** The day screen's activity row shows distance,
kcal, pace, HR and steps, but not the HR chart, the route map, or the scrub — those live only in
`ActivityDetailSheet`.

**3. Expand a session → per-session HR recovery chart. DROPPED.** `HrRecoveryChart` is still reached
from `done-screen` immediately after a workout, which is the moment HR recovery means anything; the
day screen already carries `DayHrTrace` (the whole day) and `EnergyTimelineChart`. Porting it meant
bringing `loadSessionHr` with its retry-on-sentinel logic and a `/api/oura/hr-sync` round trip for a
third HR visualisation on one screen. It is the one the entry itself ranked last.

## The layout question the entry flagged

> the row already carries two 48dp controls, so a third target needs a layout decision rather than
> another icon

The answer is not to add a target: **the name becomes one.** In `TrainingSection` the exercise name
already occupies `min-w-0 flex-1` — the half of the row nothing else claims — and the row is ≥48dp
tall because of the icon buttons beside it, so a `<button>` filling that space inherits the height.
Same in `ActivitySection` for the activity title. Both are underlined so the affordance is not
carried by position alone, and both are real `<button>`s that are *siblings* of the delete control,
never nested inside it — the WebView rule.

Both props are optional (`onExerciseTap`, `onSelectActivity`), so a section rendered without them
falls back to the plain `<span>` it had before, matching how `DayEntryControls` already works.

## What was deleted

`components/health/day-overlay-sheet.tsx`, and from `health-content.tsx`: `dayOverlay`,
`fetchDayOverlay`, `refreshDayOverlay`, `overlayDate`, `sessionHrData`, `loadSessionHr`,
`historyExercise`, `selectedActivity`, `activityTypes` and its warm fetch, the `DayOverlayDialogs`
block, both sheet renders, and six now-unused imports. **`health-content.tsx` goes 811 → 644 lines**,
off the component-size hotspot list.

`useDayEntryMutations` is untouched — `/health/day` is now its only caller, which is what LB-1 was
aiming at.

## Verification

- `pnpm dev` — `/health/day` renders; tapping an exercise name opens the history sheet, tapping an
  activity title opens the detail sheet, and `/health` renders with the overlay wiring gone.
- **`e2e/day-detail-sheets.spec.ts` is new** — 4 passed. It taps each target by its *accessible
  name*, so a plain `<span>` (the shape this shipped as before) has no role and fails rather than
  passing quietly. **Mutation-checked separately**, since serial mode hides the second failure
  behind the first: reverting only the exercise name fails the exercise test, reverting only the
  activity title fails the activity test. The activity assertion also checks a fact the row does
  *not* render (`18.2` km), so it cannot pass on the row showing through an unopened sheet.
- `e2e/day-entry-edit-delete.spec.ts` — 6 passed; the existing guard on the edit/delete controls
  this change sits beside.
- `pnpm check:rules` — Ran 55 of 55. Typecheck and lint clean.
- `scripts/check-timezone-rendering.js` lost its grandfathered entry for the deleted file, and
  `scripts/check-component-size.js` is unaffected (`health-content.tsx` only shrank).

## Not exercised

**Not verified on the S25.** Both new tap targets are ordinary buttons in an existing row, so the
risk is a touch-target one — the 48dp floor here comes from the row's icon buttons rather than from
the button's own padding, and that is a reading of the layout, not a measurement on the device.

<a id="2026-08-24-saved-meal-photo-picker"></a>

# 2026-08-24 — the meal photo has somewhere to be picked (Q-327)

**PR:** `feat/saved-meal-thumbnail-ui` · **Lane B**

## What shipped

A 64 px tile beside the meal-name field in Edit Meal. Tapping it opens the camera or gallery;
tapping the corner removes the picture. The tile is the preview as well as the picker, so there is no
separate "current photo" row, and the image rides the save that already exists rather than needing a
write of its own.

- `components/nutrition/meal-photo-tile.tsx` — the tile.
- `lib/media/downscale-image.ts` — `downscaleToDataUrl(source, {maxDim, quality, mimeType})`.
  `downscaleToJpegDataUrl` now delegates to it, so its three existing callers are unchanged.
- `packages/shared/src/nutrition/meal-image.ts` — `mealImageBytes`, which `rejectMealImage` now uses
  as well, so the number on the tile is the same arithmetic the server rejects on.
- `components/nutrition/saved-meals-sheet.tsx` — one `mealImage` state, threaded into the local
  upsert, the outbox payload and the API body.

The storage half was already done and merged (Q-396): the column, both routes, the `pushMutations`
replay and the local mirror. Nothing here re-does any of it.

## Decisions worth not re-litigating

**WebP is requested, not assumed.** `canvas.toDataURL` answers an unsupported type with a **PNG**,
without erroring — and a PNG of the same picture is several times the bytes the 16 KB cap was sized
against, so an unnoticed fallback is exactly how a thumbnail sails past it. `downscaleToDataUrl`
checks the prefix of what came back and re-encodes as JPEG when the request was ignored.

**The byte figure on the tile is the tripwire, not decoration.** Nothing fails loudly when the cap
slips: the server rejects the image and the outbox just carries a heavier row. A number the user can
see is the cheapest signal available, which is the same reasoning that put `image_bytes` in the audit
view.

**`imageDataUri` is always sent, never omitted.** Both write paths read `undefined` as "leave a
stored photo alone" and `null` as "remove it". This screen always knows which it means, because
`openBuild` seeds the state from the meal being edited — and both list paths return the column, so
that seed is real rather than an accidental `null` that would delete the photo on every rename.
Omitting instead would be the same save with one more state to get wrong.

**The camera call uses `width`/`height`, not `targetWidth`/`targetHeight`** — the latter belong to
the sibling `takePhoto(TakePhotoOptions)` and are silently ignored, which `capture-step.tsx` already
records against the same pinned plugin. It is a first pass only; the canvas re-encode after it is
what actually reaches the cap.

## Verification

`e2e/meal-photo-picker.spec.ts`. The picture is built in the page — a 1,200 × 900 gradient with
deterministic noise, so the JPEG encoder cannot collapse it and make the downscale look unnecessary —
and the spec asserts the source is more than four times the cap before asserting the **stored** row
is a WebP under it. Mutation-checked: raising `maxDim` to 4000 fails the first test.

The second test covers the two ways an edit screen loses a photo: saving without touching the tile
must keep it, and Remove must actually clear it.

Full local gate: 53 of 53 Custom Rules, lint clean, the spec green.

**Not exercised:** the native path. `Capacitor.isNativePlatform()` is false in a browser, so every
run took the `<input type=file>` branch — the camera/gallery prompt, the tile's 48dp target on the
S25, and the local-store mirror of the image column are all owed an on-device check.

<a id="2026-08-24-strict-request-schemas-batch5"></a>

# Strict-request-schema sweep, batch 5: 67 → 40 (Q-464)

**Branch:** `fix/strict-request-schemas-batch5` · **Lane A**

## What shipped

Continued the Q-464 ratchet (`scripts/check-strict-request-schemas.js`) that turns a mistyped or
renamed request key from a silently-dropped field into a 400 at the boundary. 16 files reached
zero non-strict schemas and were removed from the baseline: `activity-logs` (DELETE and the
metrics PATCH), `exercise-estimates`, `exercises` (create), `nutrition/dietary-restrictions`,
`nutrition/targets`, `running-plan/explain`, `workout-review/session/[sessionId]/apply`, five
`nutrition/meal-plans` routes, and the shared `packages/shared/src/validation/generated-program.ts`.
Four more (`builder-chat`, `exercises/generate`, `generate-program`,
`nutrition/meal-plans/generate{,/meal}`) were lowered to their `generateObject` response-schema
remainder — their one genuine request schema is now strict, the schemas that constrain the model's
own output are correctly left alone (that's a different decision, not this ratchet's job).

Every conversion read the real client's payload against the tightened schema before touching it —
no codemod, per the entry's own standing warning.

## Two traps caught before shipping

Same class as the prior batch's `push/subscribe` `expirationTime` miss — a field the client sends
that the schema didn't name, which `.strict()` would have silently rejected in production:

- `workout-review-sheet.tsx` sends an unread `confidence` alongside its real fields to
  `workout-review/session/[sessionId]/apply`. Added to the schema as an accepted-but-ignored field
  (the route already computes its own deterministic confidence, per CLAUDE.md's rule that no
  LLM self-reported number may gate an automatic action), rather than exempting the route.
- `builder-review.tsx` mints a `clientId` on every exercise in its live `program` state — the
  review editor's React key — and sends that whole state to `/api/builder-chat`. The field lives on
  the shared `GeneratedExerciseSchema` in `packages/shared/src/validation/generated-program.ts`,
  used only as a request-side schema there; it would have 400'd every real chat turn.

## Verification

- Each client verified by reading its actual fetch call against the schema being tightened — the
  full list is in the `docs/implementation-backlog.md` Q-464 entry.
- The touched routes' own vitest suites: 81 tests across 8 files, all passing.
- Full suite: 4693 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode` package
  in this sandbox).
- `pnpm check:rules` — Ran 55 of 55.
- `tsc --noEmit` clean.

## Not exercised

**`pnpm dev` could not be run in this sandbox** — same gap as the prior batch, `node_modules` is
missing `@sentry/nextjs` despite `package.json` declaring it, unrelated to this change. Static
verification (reading every real client's payload against the tightened schema, confirmed against
the actual field names sent — not assumed from a type declaration) stood in for it, as it did last
time. No route in this batch was hit with a live request in this session.

<a id="2026-08-24-strict-request-schemas-complete"></a>

# The strict-request-schema sweep is finished: 89 → 37, all remainder exempt (Q-464)

**Branch:** `fix/strict-request-schemas-batch6` · **Lane A**

## What shipped

Three more conversions, and — more usefully — the finding that ends the sweep.

- `coach/apply` and `coach/threads`, each read against its real clients first: `number-dial.tsx`,
  `change-preview.tsx` and `confirm-content.tsx` all post `{patch, acceptedChangeIds}`;
  `coach-content.tsx` posts `{threadId, messages:[{role, parts}]}`. Both match exactly.
- `coach/options`, the route-builds-the-object class — it reads two named `searchParams` into a
  literal, so an unknown query key cannot reach the schema. Strict guards nothing there today; it
  costs nothing and catches the day someone swaps the literal for a spread.

## The sweep is complete, and that is the point of this entry

**All 37 remaining non-strict schemas are in a documented exemption class or are not request
schemas at all.** Categorised and verified rather than assumed, now recorded in
`scripts/check-strict-request-schemas.js`'s header:

| class | n | why it must stay permissive |
|---|---:|---|
| outbox / `pushMutations` | 16 | the 8 shared `validation/*` files + `sync/push`. Tightening one dead-letters a mutation queued by an older APK bundle. |
| external / native client | 8 | `oura-ble/*` (5), `scale-ble/samples`, `hr-ingest` (Kotlin `PolarStrapService`/`ScaleBleService`), `health-connect-ingest` (Tasker). The APK does not update with a Railway deploy. |
| third-party SDK wire format | 1 | `coach`, driven by `@ai-sdk/react`'s `DefaultChatTransport`. |
| `generateObject` response schemas | 12 | builder-chat 2, exercises/generate 1, generate-program 2, meal-plans/generate 2, meal-plans/generate/meal 2, nutrition/scan 2, nutrition-goals/recommend 1 — these constrain the model's output, not a client's input. |

So the count is a **floor, not a debt**. The backlog entry is removed; the ratchet stays in the
Custom Rules job permanently, because keeping a *new* non-strict request schema out is what Q-464
was actually for — and prose alone did not hold that line.

## What the whole sweep cost and bought

89 → 37 across six batches, every conversion read against its real client's payload. The tempting
shortcut — "in-repo JS clients ship with the server, so a key mismatch is a bug either way" — is
true and still insufficient: it argues a mismatch *is* a bug, not that there is none. Four traps
prove it, each of which `.strict()` would have turned into a silent 400 on a real request:

- `push/subscribe`'s real body is a browser `PushSubscriptionJSON`, which always carries
  `expirationTime` beside `endpoint`/`keys`.
- `workout-review/apply`'s client sends a `confidence` the route never reads.
- `builder-review.tsx` mints a `clientId` on every exercise in its live program state and posts it
  wholesale to `builder-chat`.

Each was fixed by adding the field to the schema, never by exempting the route.

## Verification

- `pnpm check:rules` — Ran 55 of 55.
- Full suite: 4693 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode` package
  in this sandbox).
- `tsc --noEmit` clean.
- Coach suites green (11 tests).

## Not exercised

**`pnpm dev` could not be run** — this sandbox's `node_modules` is missing `@sentry/nextjs` despite
`package.json` declaring it, a pre-existing gap unrelated to this change. No route was hit with a
live HTTP request this session; static per-client verification stood in for it, as in batch 5. The
exemption categorisation above was verified by reading each file (which schema feeds
`generateObject`, which validation module the adapter imports), not by exercising the paths.

<a id="2026-08-24-tier-a-enqueue-visibility"></a>

# The last line of defence stopped failing silently (Q-486)

**Branch:** `fix/tier-a-enqueue-visibility` · **Lane B** · v1.346.0

## What was wrong

`components/workout-screen.tsx` has four `queueMutation` calls — two for `workout_log`, two for
`complete_workout` — and all four ended `.catch(() => {})`. They were the only `queueMutation` calls
in the app that swallowed; the other ~26 `await`, so a throw reaches a `try` and suppresses their
success toast.

The path around them is good, and reading it as sloppy would be the wrong lesson.
`logWorkoutLocally` writes to the local store first **and warns on its own failure**; the primary
send is a direct `POST /api/log-exercise`, deliberately independent of the outbox. The enqueue is
the *fallback*. So losing a set needs two failures at once: the POST fails (offline — exactly what
the fallback exists for) **and** the local SQLite store is unavailable, which `CLAUDE.md` records as
having happened twice on Android, plus the partial-migration and `disk_full` cases.

When both fail the set is not sent, not queued, not recoverable, and **nothing is logged** — while
`hapticLight()` and `setLoggedCount(c => c + 1)` have already told the user it saved. In the same
function, the *less* consequential failure was warned and the more consequential one was not, which
is what makes it read as an oversight rather than a decision.

## What shipped

`reportEnqueueFailure(domain, err)` in `lib/local-store/dead-letter-signal.ts`, and the four
`.catch(() => {})` now call it. It warns — matching the line already above them — and for a Tier-A
domain fires a toast naming what was lost, distinguishing a set from a finished workout.

Control flow is untouched and the calls are still fire-and-forget. Converting them to `await` would
put a SQLite write in front of the haptic, which is the instant-feedback rule this screen is the
reference for.

## The one thing the entry got wrong

Q-486 said to *"signal the user through the existing dead-letter badge"*. That would have been
wrong, and noticing why is most of the work in this change.

The badge counts dead-lettered outbox **rows**, and the Data & Sync card lists them so each can be
retried or discarded. A thrown enqueue leaves **no row** — that is the entire defect. A badge lit
from here would show a number that card cannot explain, act on, or clear, and it would sit there
permanently. The toast is right for the opposite reason: it fires at the moment of loss, the only
moment the user can do anything about it — re-log the set while they still remember it.

## Verification

- `lib/local-store/__tests__/dead-letter-signal.test.ts` — four new cases (7 in the file): warns and
  toasts for Tier-A; names a finished workout differently from a set; warns without interrupting for
  Tier-B; and **leaves the badge alone**, which is the decision above pinned by test.
- `pnpm check:rules` — Ran 55 of 55.
- Typecheck and lint clean.

## Not exercised

**The failure itself cannot be induced in this sandbox and was not.** It needs a broken local SQLite
on a device; here `getLocalStore` returns null, so `store_?.` short-circuits and the enqueue never
runs at all. That `queueMutation` throws on a dead local DB is read from source, not observed — as
true after this change as before it. **The Q-486 Known-Issues row in `projectOverview.md` therefore
stays**, carrying `Gate: device`, and the backlog entry keeps a `Keep:` line for the same reason.
Nothing here was seen on the S25.

<a id="2026-08-24-water-widget-web-fallback"></a>

# The water widget's generic sheet treats water as an increment, like everything else does (Q-319)

**Branch:** `fix/water-widget-web-fallback` · **Lane B** · v1.363.6

## The entry's premise needs two corrections, and the second changes the fix

**1. The bug is not reachable from the UI, and never was.** Q-319 says the water tile's Log button
opens `log-value-sheet.tsx`. It does not: `metric-tiles-card.tsx:89` branches on `waterIntake` and
calls `onLogWater()`, which opens `components/profile/water-log-sheet.tsx` — the correct sheet, on
the correct route. `LogValueSheet` is reachable only via `onLogTile`, which that branch bypasses for
water. The diversion has been there since the public snapshot (2026-08-16), two days **before** this
entry was filed. The entry's measurement was real but was a direct route call, not a UI drive.

Confirmed against the running app: `POST /api/body-metadata {"localDate":…,"waterIntake":750}`
returns **`400 {"error":"Invalid input"}`**, exactly as the entry's ⚠ note predicts post-Q-464.

**2. The device path is NOT fine, which the entry states twice.** `log-value-sheet`'s local branch
wrote `waterMl: numVal` — an **absolute** — and queued `{ waterMl: numVal }`. Water is an increment
everywhere else:

- `components/health/metric-bounds.ts:51` bounds `waterIntake` with `validWaterMlDeltaOrNull` and
  its comment says outright *"A water ENTRY is an increment"*.
- `water-log-sheet.tsx` read-merges locally and queues **`waterMlDelta`**, with a comment naming
  **SYNC-P7**: an absolute total in the push branch made concurrent adds on two devices clobber each
  other.
- `adapter.ts:3901` routes `waterMlDelta` through `incrementWaterLog`, the same function the web
  route uses, and dedupes it on the mutation id because it is the one non-idempotent branch.

So this sheet held a second, contradicting copy of the water write — an absolute set that both
discards the day's accumulated water (`upsertBodyMetric` overwrites every column) and reintroduces
SYNC-P7. That is a latent write-path defect, not a semantic quibble.

## What shipped

`log-value-sheet.tsx`'s water case now matches its sibling on all three paths: read-merge the day's
total locally, queue `waterMlDelta`, and post to `/api/water-log` in the web fallback. The optimistic
paint increments rather than replacing, for the same reason.

Kept rather than deleted, deliberately. Dead code that is *wrong* is a trap: whoever later routes a
water widget through the generic sheet would otherwise inherit both the clobber and the 400.

## Verification

Driven against `pnpm dev` + local Postgres by mounting `LogValueSheet` with the water widget on a
scratch route — the tile cannot reach it, which is the point above:

| logged | `POST /api/water-log` | `body_metrics.water_ml` |
|---|---|---|
| 300 ml | 200 | 750 → **1050** |
| 200 ml | 200 | → **1250** |
| 150 ml | 200 | → **1400** |

Three successive entries **summed** instead of overwriting. Before the change the same flow sent
`waterIntake` to `/api/body-metadata` and got a 400 with the value lost.

`tsc --noEmit` clean · `eslint` zero new warnings · `pnpm check:rules` **Ran 55 of 55**.

## Not exercised

**No user-visible behaviour changed, because nothing user-visible could reach this branch.** This
closes a latent defect and removes a 400; it does not fix something the owner can currently hit.

**The optimistic paint's absolute value was not verified against the real screen.** The scratch
harness passes a no-op `fetchMeta`, so its starting `waterMl` stays null and the painted totals read
300/500/650 rather than the true day total. The *increment* is what was under test and it is correct;
reconciliation is `fetchMeta`'s job on the real screen and was not driven.

**The local-store branch was not exercised at all** — `getLocalStore` returns null in the web
sandbox, so only the web fallback ran. The read-merge and the `waterMlDelta` queue are read-and-typed
only, and they are the half that matters on the canonical runtime. Owed a device check.

Nothing checked on the S25.

<a id="2026-08-24-workout-automatable-past-set-one"></a>

# The workout write path can be driven past set 1 (Q-461)

**Branch:** `fix/start-set-bounce-blocks-automation` · **Lane B** · v1.363.5

## What shipped

One CSS rule and one E2E spec.

`app/globals.css`'s existing `prefers-reduced-motion` block gains `.animate-bounce { animation:
none !important; }`, alongside the particles and the marquee it already stops. `e2e/workout-set-loop.spec.ts`
drives a real workout — recommendation card → pre-workout → countdown → warm-up → Start Set 1 →
Log Set 1 → Start Set 2 → … → three logged sets — and asserts they reached Postgres.

## What was wrong, measured

The Start Set button carries `animate-bounce` while `workoutPhase === 'rest'` — the W1 affordance
`CLAUDE.md` documents by design. Playwright's actionability check needs a stable bounding box for
two consecutive frames, and an infinite animation never gives one.

Reproduced on this spec's own flow, before and after the rule:

```
reducedMotion=reduce          animation=none | 1            CLICKED in 85ms
reducedMotion=no-preference   animation=bounce | infinite   BLOCKED after 8009ms
```

So the affordance is untouched for anyone who has not asked for less motion. **This is a
testability fix, not a repair of a user-facing defect** — a human tapping a bouncing button was
never affected, and the entry says so explicitly.

It is also the accessibility-correct behaviour, and it follows the rule the block's own comment
already states: decorative motion stops entirely, *functional* indicators freeze to their static
state. The button stays where it is and stays primary; it stops moving.

`force: true` is deliberately not used anywhere in the spec. It bypasses **every** actionability
check including "is this covered by an overlay", so a spec written that way would keep passing
straight through a real regression.

## The spec is a guard, and it was checked as one

Removing the CSS rule makes it fail — verified, not assumed. It fails on
`toHaveCSS('animation-name', 'none')` before the click, so the failure names the cause instead of
timing out.

Three things it has to work around, each of which cost a run to find:

- **`/workout` and the pre-workout screen both carry a button reading "Start Workout."** The first
  is the Workout tab's recommendation card; the session id appearing in the URL is what separates
  them.
- **A 3-second countdown overlay** sits between the second press and the warm-up.
- **The set write is fire-and-forget by design** (CLAUDE.md, "Saves feel instant"), so a single
  database read straight after the last tap races it. The assertion polls.

The spec deletes the workout sessions it created in `afterAll`, matched against the exact set of ids
that existed before it ran — the harness shares one database serially, and a workout left in flight
would make the next spec's pre-workout screen offer "Continue Workout".

## Verification

- Spec **passes** with the fix, **fails** without it. Three sets logged at 75 kg × 8, confirmed in
  `set_logs` rather than only on screen.
- `tsc --noEmit` clean · `eslint` **zero warnings introduced** (124 both with and without the
  change — measured by stashing) · `pnpm check:rules` **Ran 55 of 55**.

## Not exercised

**The follow-on spec Q-461 names — log-set through complete-workout — is not written.** This one
stops after three sets of the first exercise. What it unblocks is the ability to write that one at
all, which was the entry's point.

Nothing checked on the S25. The rule only fires under `prefers-reduced-motion: reduce`, so the
device behaviour is unchanged unless the owner has that Android setting on — worth one look with it
enabled, since the bounce is the cue that a set is next.

<a id="2026-08-25-back-dismiss-sweep"></a>

# 2026-08-25 — the back gesture stops navigating the page away (BF-27)

**Branch:** `fix/sheet-back-dismiss-sweep` · **Lane B** · **v1.372.0.** JS-only — no APK needed.

## What was wrong

`lib/hooks/use-sheet-back-dismiss.ts` was imported by **5 of 45** files rendering a `<SheetContent>`
and **0 of 6** rendering a `<DialogContent>`. Everywhere else the Android back gesture reached the
WebView, which navigated the page underneath the sheet away. The owner found it on a device smoke
run and asked for the review: *"there are many pages that dont do this well; so we should do a
review on these pages to make it all like this."*

## Shipped as one component, not a 40-site sweep

BF-27 scoped this as `useSheetBackDismiss(open, onClose)` at each site. It ships instead as
`components/ui/back-dismiss.tsx`, rendered by `SheetContent` and `DialogContent`. Three reasons, in
the order they decided it:

- **It is where this repo puts UI defaults.** A tap-target floor belongs in `button.tsx`, not in
  every caller — the repo's own rule. A per-site wiring is also a rule every future sheet has to
  remember, and the 40 that lacked it are what forgetting looks like.
- **Closing goes through Radix's own `onOpenChange`**, by clicking a hidden `Close`, rather than
  through a callback threaded in per site. So back takes the same path as the X button and every
  guard already on that path still runs — `config-screen`'s unsaved-work check, the feedback
  sheet's reset, each dialog's cancel arm. A hand-wired `onClose` could bypass any of them.
- **It reaches what a sweep could not.** `profile/level-sheet.tsx` is uncontrolled — a
  `SheetTrigger` with no `open` prop — so there was no `open` expression to hand the hook.

**The hook has to be a child of `Content`, not a call inside `SheetContent`.** `SheetContent`'s body
runs whenever its caller renders it, and every tab screen renders its sheets unconditionally with a
null prop; it is `Portal` that gates the inner tree on `open`. A hook one level up would push a
history entry for every *closed* sheet on the page. This cost a wrong first draft.

The five call sites that had the hook lost it — otherwise each would push twice and need two
presses. `food-logger-sheet`'s `handleClose()` is exactly the `reset(); onClose()` its hook call
passed, so routing through `onOpenChange` is behaviour-identical there; the other four passed a bare
`onClose`.

## The dialogs got it too, and that was a decision

BF-27 says the six `<DialogContent>` files need a decision rather than the same treatment, because
*"a confirm dialog dismissed by the back gesture may be the right behaviour or may be a lost
confirmation"*. They get it. All six were read: five delete/move confirmations, an edit form, a
weight picker and a 1RM calculator. Back reaches every one through `onOpenChange(false)`, which is
each dialog's **cancel** arm — the same thing Cancel and the X do. It cannot take a confirm arm,
because no dialog wires one to `onOpenChange`. That is also the Android convention: back cancels a
dialog, and `AlertDialog` is back-cancelable by default.

The spec asserts this on the **database**, not the screen — a dialog that closed and a dialog that
deleted look identical once it is gone.

## Verified

- **`e2e/back-dismiss-sweep.spec.ts`, three cases, all mutation-checked** — with the two
  primitive edits reverted, each goes red, and the failure is the real defect: `page.url()` is no
  longer `/health/day`, i.e. back navigated the page away.
  1. A sheet that was never wired (`ExerciseHistorySheet` on `/health/day`) closes on one press, and
     the pushed entry count is **one**, which is what a leftover per-site call would break.
  2. A confirm dialog closes and **the row is still in the database**.
  3. **The nest** BF-27 names as the real risk: Log Food → History pushes a second entry, one press
     closes the inner sheet and leaves Log Food open, a second closes Log Food, and the page never
     moves. Before this, most nests pushed no entry at all, so the per-instance `sheetId` that keeps
     them apart had never been exercised in the product.
- **The three `hideCloseButton` sheets were checked individually**, because they are the ones with no
  X at all — back is their only dismissal besides Save, so they depend entirely on this hidden
  `Close` being its own element rather than the visible one. `food-logger-sheet` is covered by the
  nest case above; `morning-checkin-sheet` and `end-of-day-review` were driven in a browser: each
  pushes an entry on open, one back press closes it, and the page stays put. That the three sheets
  that most need this are exactly the three that already had the hook is not a coincidence.
- `sheet-back-dismiss.spec.ts` still passes — the StrictMode mount-already-open case (LB-10) and its
  one-entry-per-open invariant survive the move into the primitive.
- `tsc --noEmit` clean · `next lint` clean on the new file · `pnpm check:rules` **Ran 56 of 56**.

## Not exercised

**The Android gesture itself.** The harness drives `history.back()`, which is close to the gesture
and is not the same input — BF-27 says so and it is still true. The device check is what the entry
keeps, and it names the three presses worth making.

**No `forceMount` exists anywhere in the app**, checked, so there is no sheet whose content stays
mounted while closed — which is the one shape that would make this push entries forever.

## A local full-suite red I could not attribute, and did not merge on

Recorded in full because "flake" is not a root cause and this change touches every sheet in the app.

| Full run | Primitives | Result |
|---|---|---|
| A | with | `meal-label` failed · 66 passed |
| B | with | `meal-label`, `food-logging-complete`, `tabs-instant-paint (More)` failed · 64 passed |
| C | reverted | only the two back-dismiss specs failed, correctly · **all three of the above passed** · 63 passed |

Run C is **not a clean control** — the stash reverted `sheet.tsx`/`dialog.tsx` but left the five
call-site removals in place, which is why both back-dismiss specs failed there and is the expected
result of having no back-dismiss at all. What it does establish is that the same ten-minute load
produced none of the three failures.

**Against that: none of the three reproduces.** All fifteen tests of those files pass alone and as a
subset, with the change. And the failing set differs between A and B on identical code, which no
deterministic regression does.

**The `meal-label` one has an identified mechanism, and it is the spec's.** It fails on `decodeQr`
returning null for the **first** style of its decode loop. That loop gates on
`inkFraction > 0.01` — *any* ink on the canvas — and then reads pixels, so a canvas caught mid-draw
decodes to nothing. Nothing about that needs this change to be true; it needs the machine to be
slow, and `meal-label` alone is 2 of the run's 10 minutes.

**So the merge gate was CI, not this sandbox** — a fresh database, a fresh server, and nothing else
competing. It is also, per the repo's own note, the better signal. If E2E goes red there on any of
these three, it is real and this entry is wrong.

<a id="2026-08-25-baseline-zero-seed"></a>

# The baseline EMA seeded at zero (BF-13, Q-506, TN-8)

**Branch:** `fix/baseline-zero-seed` · **Lane A** · batch `temperature-baseline` · no migration

## One line, four consumers

`updateBaseline` starts from `meanX8 = 0` and anneals toward the sample — 1/2 under 4 nights, 1/8 to
14, **1/32 after that**. So the first sample lands the mean at half the reading, and the step size
collapses long before it catches up. On the owner's temperature history night 2 read **17.905 °C**
against a 35.81 °C sample, and at night **50** the baseline was still **0.363 °C low** — 2.8 nightly
sd.

One corrupted intermediate was failing four consumers: the readiness penalty ladder, the illness
radar's `tempZ`, the "body temp elevated" deload card, and TN-8's chronic-stress fever mask (which
leaves no trace at all — a masked night simply does not contribute).

## The trap the entry predicted, and I walked into it anyway

BF-13 says: *"Check the vendor port before changing the shared maths… if the port is faithful, the
fix belongs at the seed / call site, not in the ported update."*

I put the seed inside `updateBaseline` first. It broke `warm_up_then_settle` — which is **ported
verbatim from open_oura's own `baseline.rs` test** and asserts `updateBaseline(null, 100, 0) === 400`.
The zero start is ecore's ground truth, pinned against the decompile. Changing it would have made
the port a lie about what the ring does, and the vendor's test is what caught it.

The fix is `seedOrUpdateBaseline`, a wrapper: first-ever sample seeds `{ meanX8: sample << 3,
devX8: 0 }`, everything after that is the untouched port. Both folds in the app
(`daily-summary.ts`, `score-availability.ts`) now call the wrapper. **All six baselines** are
protected — the entry's own point that this is a baseline-engine defect, not a temperature one.

`devX8: 0` is deliberate: one sample has no spread, and `baselineZ` already returns null on a zero
dev, so a one-sample baseline reports nothing rather than something confident.

## Four tests were pinning the bug

Not adjusted to fit — checked one at a time, and each was asserting the defect:

- **`breathBaseline` expected `{ meanX8: 580 }`.** 580 is exactly half of 1160. A 14.5 rpm reading
  was being recorded as 7.25 rpm and the test called it "pins the ×10 units".
- **`trailingBaselineZ([50, 50], 1)` expected `> 5`.** That assertion *demonstrated* the hazard — two
  steady 50s folding to mean 25, dev 3.1, z of 8, which the composite would read as a flawless day.
  Seeding removes the hazard at source, so it now asserts `null`. **The maturity floor stays**, and
  the case is kept so a reverted seed makes the overconfident z visible again instead of hiding
  behind the floor.
- **`carries baselines forward independently`** reused identical values across both nights and passed
  only because the cold mean moved on *any* second sample. It could not tell "carried forward" from
  "still converging". The fixture now varies.
- The other vendor-ground-truth cases pass **unchanged**, which is the point.

## Verification

Mutation-verified: deleting the seed line fails three cases, including the new BF-13 one.

- Full suite: **4765 passed, 51 skipped, 0 failures.**
- `pnpm check:rules` — Ran 56 of 56. `tsc --noEmit` clean, `pnpm lint` 0 errors.

## The data half is NOT done — one button, and it is the owner's

The seed fixes every baseline built from here. The owner's **stored** baselines are still the ones
folded from zero, and re-deriving them is what the three entries' pass tests actually measure.

**No new code is needed.** `run.ts:917` null-seeds the fold when `fullHistory` is set, and the
**Redecode** admin endpoint already passes `fullHistory: true`. So one Redecode run against
production, after this deploys, re-derives all six from the raw nightly values — which are untouched,
making it re-runnable and reversible, exactly as the owner was told when approving it.

**I could not run it.** The rollup needs the vendored Oura constants Q-49 removed from the repo, so
it cannot execute in an agent sandbox at all.

**Pass tests to check after that run**, straight from the entries: temperature deviation mean within
±0.05 °C of zero and roughly half the nights negative (BF-13/TN-6); `temp_dev_c > 1.0` on **0**
nights (TN-8); and the whole biomarker table re-measured, because every z moves by ~19× and the
radar may then fire *too* often (Q-506). **Only temperature needs re-deriving** — Tuning measured
the other five and only temperature's nightly sd is tight enough for the gap to matter.

## Not exercised

No device, and nothing observed in production. The claim here is that the fold now seeds correctly,
proven against the vendor's own test vectors and by mutation — not that any stored baseline has
changed, because none has yet.

<a id="2026-08-25-card-error-states-enumerated"></a>

# 2026-08-25 — the rest of Q-499's card sweep, enumerated rather than estimated

**Branch:** `fix/card-error-states-sweep` · **Lane B** · no schema, no route, no APK.

Q-499 shipped two cards on 2026-08-24 and left a `Keep`: *"the other ~10–18 candidate cards from the
2026-08-18 sweep remain an unenumerated worklist"*. The review's own file list was not retrievable,
so the number was a grep estimate. This is the enumeration, the per-file judgement, and the fixes for
the three that were genuinely the Q-499 shape.

## What the Q-499 shape actually is

A component whose **entire render** is gated on a fetched value, where the failure and the legitimate
empty case collapse to the same `null` — so a 429 or a 500 makes the card *disappear* rather than say
anything. Two things that look like it and are not:

- **A supporting value.** `hr-profile` in `exercise-review-sheet`, `activity-detail-sheet`,
  `day-detail-content`; `muscle-recovery` in `workout-select-content`; `more-user-profile` in
  `session-select-content`. A failure degrades a chart's zones or a label — the surface stays.
- **A documented empty state.** `home-nutrition-zone-bar` (*"renders nothing without a balance,
  which is the same condition under which the old fill rendered nothing"*), `food-logging-complete`,
  `training-stress-line` / `training-stress-badge` (supplementary lines, *"self-hides when gated"*),
  `exercise-detected-card` (its data source has had no writer since the Oura Cloud removal, so it is
  permanently empty by construction, not by failure).

## The three that were real

| card | its `null` also means | what a failure looked like |
|---|---|---|
| `health/oura-section.tsx` | **"no ring connected"** | a connected user's entire ring section gone, the app behaving as though they had never owned one |
| `health/ai-periodization-status-card.tsx` | "no AI-dynamic sessions" | the card gone; a success with none sets `sessions` to `[]`, so a still-`null` `sessions` is exactly a failed fetch |
| `workout/exercise-hr-trend-card.tsx` | "no HR recorded for this exercise yet" | the Heart & Recovery card gone from the exercise-history sheet |

Each now renders the `observed-hr-card.tsx` shape — a bordered row, a `TriangleAlert`, *"Couldn't
load… — pull to refresh."* — and only when the fetch failed **and** there is nothing cached to paint
instead, which is the rule the reference card already followed.

**`.catch()` is not the guard, and `oura-section` shows why.** It had
`.catch(() => {})` on all three of its fetches and still vanished: `cachedFetch`/`cachedFetchToday`
resolve on a non-ok response, so `.catch` sees a network throw and never a 429. `onError` is the only
hook that fires there. The `.catch` arms now set the same flag, so a genuine network throw is covered
by both.

## Verified

`e2e/card-429-error-state.spec.ts` gains a case per card, matching the two already there: route the
endpoint to a 429, load `/health`, assert the error text. **6 passed.** Both new cases were confirmed
to **fail** with the component changes stashed — `2 failed` — so they guard the fix rather than the
page.

`tsc --noEmit` clean · eslint clean on all three files · `pnpm check:rules` **Ran 56 of 56**.

## Not exercised

Not run on the S25 APK. Also not exercised **offline**: `cachedFetch` cannot revalidate at all with
no connection, so what these states do on a genuinely offline first load is untested here — the
`failed && !cached` guard is what is supposed to keep them from firing over a cached paint.

<a id="2026-08-25-catalogue-family-anatomy"></a>

# 2026-08-25 — the shrug and glute-bridge families follow their sibling (LA-24 Kind 2)

**Branch:** `fix/catalogue-family-anatomy` · **Lane A** · migration **224**, v1.375.1.

Migration 219 shipped LA-24's Kind 1 — the five rows another family member already answered — and
deliberately left Kind 2 out, because BF-16a's additions to `Barbell Shrug` and `Barbell Hip Thrust`
came from anatomy with **no in-catalogue precedent**. Extending them to the rest of each family is the
same judgement made five more times, and 219's own comment says making it unasked is how a catalogue
drifts by assertion. **The owner decided it on 2026-08-25: yes, follow the barbell version.**

## What changed

Verified against production immediately before writing, after 216 and 219 had applied there:

| row | was | now matches |
|---|---|---|
| `Dumbbell Shrug` | traps | `Barbell Shrug` — + upper back, forearms |
| `Machine Shrug` | traps | ditto |
| `Barbell Glute Bridge` | glutes, hamstrings | `Barbell Hip Thrust` — + quads, lower back, adductors |
| `Bodyweight Glute Bridge` | glutes, hamstrings | ditto |
| `Single Leg Hip Thrusts` | glutes, hamstrings | ditto |

Thirteen appends across seven rows (two families of the corrected siblings plus five corrected rows).

## The decision was "for now", and the migration says so

The owner's answer carried that qualifier, so the reversal note in `224`'s header is not boilerplate.
The entry's own doubt is that loading differs *within* a family — a machine shrug's handles may be
supported where a barbell shrug's grip is not, and a bodyweight glute bridge does not load the quads
the way a loaded hip thrust does. If that turns out to matter, the correction is another
append/remove migration on the same seven rows. Nothing downstream stores a copy: `muscles` is read
in a **live subquery** by the volume tallies, so a change re-derives history rather than applying only
forward, and the device re-hydrates its mirror from `/api/workout-data` — **no APK needed**.

## Verified

- **Applied to the local DB and read back**: all seven rows now carry exactly their sibling's muscle
  set, checked row by row rather than by row count.
- **Idempotence proved, not asserted**: the migration was applied **twice more** against the
  already-migrated database and the seven rows were byte-identical before and after. Same shape as
  216 and 219 — each statement appends one assignment and skips when the row already names that
  muscle, compared case-insensitively because the catalogue carries a few Title Case values.
- `tsc --noEmit` clean · `pnpm check:rules` **Ran 58 of 58** · `check-migration-numbers` no
  collisions · `check-backlog-pointers` OK.
- Renumbered 225 → **224** before committing: 223 was the directory head, and leaving a gap would
  have made the pointer wrong for the next session.

## Also in this PR

**Q-304b is CLOSED, not parked** — the owner decided against recomputing the historical 1RM
estimates. The entry keeps why, because "leave it" is not free either: an inflated PR shows on the
badge and in the AI chat, and drives a too-heavy prescription **only** for an exercise carrying a PR
with no recent log (`resolveWorkingBasis` takes `lastNonDeload1rm` first). That is the accepted cost,
and it is written down rather than implied. Q-304's forward fix is unaffected — this decision is
about history only, and `set_logs` is untouched, so the recompute stays possible if LA-27's 76
style-edited rows are ever solved.

The backlog file ends the day at **11948 lines — exactly where it started**, and its size baseline
was ratcheted back down to match. Three raises earlier in the session were for entries being
*corrected*; completing LA-24 and closing Q-304b gave the lines back.

## Not exercised

The migration has not run against production — that happens on the Railway deploy. It applied cleanly
locally on top of all 223 prior migrations and CI's Migration Check runs it against a fresh database.
Nothing native, offline-first, safe-area or gesture-related is touched, so **no device smoke run is
owed**; the catalogue reaches the device through `/api/workout-data` on the next workout load.

<a id="2026-08-25-coach-undo-control"></a>

# 2026-08-25 — the Coach's undo has a button (Q-467)

**Branch:** `feat/coach-undo-control` · **Lane B** · no schema, no route, no APK.

A complete undo subsystem for AI-Coach changes has been in the repository with **no caller**:
`POST /api/coach/apply/[id]/undo` (auth-gated, rate-limited, ownership-scoped), `undoCoachChange()`
with a double-undo guard, an `undo()` handler in all five domains, a `captureBefore()` in each that
exists only for it, the `coach_changes.undone_at` column — and `coach-history.tsx` already styling a
row struck-through, muted and "· undone" for a state the user had no way to reach.

Re-verified against `main` before writing anything: the route is there, `/undo` appears in **no**
client file, and the history list renders read-only. All three still true.

The only way back was to ask the Coach to change it again — a *new* change against current state
rather than a restore, and for `early_deload` or `program_phase` possibly not expressible at all.

## What shipped

An Undo control on each change that is not already undone, in `coach-history.tsx`. In-flight guard,
`disabled` while the request is out, and the row re-styles itself struck-through the moment the undo
lands — that restyle is the feedback, so there is no toast.

**No confirmation dialog, deliberately.** Undo *is* the safety net; putting friction in front of it
is the wrong side of the trade. The route holds the real guard.

**The 409 is a state, not an error.** The window is "until the next workout started after the
change", because once a session has been shaped by it, reversing would silently disagree with
training already done. A refusal replaces the button with its own sentence on the row: the user has
not done anything wrong and there is nothing to retry.

## The bug this would have shipped with, if the route were taken at its word

`app/api/coach/apply/[id]/undo/route.ts` calls `invalidateProgramStructure()` **on the server**, and
`lib/cache-groups.ts` is a *client* module — it reaches `localStorage`, `sessionStorage` and the
on-device SQLite cache. On the server that call clears nothing. Wiring the button without noticing
would have restored the programme in Postgres while every screen kept painting the changed one from
cache for a full TTL: this repo's most-repeated bug class, arriving through a line that looks like it
already handles it.

The client now clears the superset — `invalidateProgramStructure()`, `invalidateGoalRecommendations()`
and `invalidateCoachHistory()` — after any successful undo. It has to be the superset: the history
payload carries only `id`, `summary`, `appliedAt` and `undoneAt`, so the client cannot tell which of
the five domains it just reversed, and adding a domain field would mean editing `lib/coach/threads.ts`,
which is Lane A's. The cost is one refetch on a rare action.

## Verified

Against local `pnpm dev` + Postgres, with a real `coach_changes` row (`user_goals`, steps
8,000 → 12,000):

**Undo inside the window.** Row shows an `Undo: Daily steps 8,000 → 12,000` button →
`POST /undo` **200** → row struck-through, "· undone" appended, the button gone. **In the database:
`users.steps_goal` 12,000 → 8,000 and `coach_changes.undone_at` set** — the restore actually
happened, not just the styling.

**Undo after training.** Same change re-seeded two hours back with a workout session started one hour
back → `POST /undo` **409**, the row renders *"You've trained since this change — undoing it now
would disagree with a session you've already done."*, the button is gone, and **the row is NOT struck
through** — nothing was undone and nothing claims it was.

`tsc --noEmit` clean · eslint clean · `check-memo-prop-stability` **78 memoised components, 0
defeated call sites** (the row is its own memoised component taking scalars, since it renders inside
`.map()` where a hook cannot live) · `pnpm check:rules` **Ran 56 of 56**.

## Not exercised

- **The other four domains.** Only `user_goals` was driven end to end. The remaining handlers
  (`nutrition_targets`, `session_exercise`, `early_deload`, `program_phase`) share the same route,
  the same `undoCoachChange()` and the same client call, and are covered by
  `lib/data/postgres/__tests__/coach-domains.test.ts` at the handler level — but no UI pass touched
  them, and `early_deload` / `program_phase` are the two whose restore is hardest to express.
- **The `stale` 409** (a later Coach change still in effect over this one) renders through the same
  path as the trained-since 409 and was not driven separately.
- **The S25 APK.** The control is a plain button in an existing list, but its tap target and the
  refusal's wrap have not been seen at that width. `Gate: device`.
- **Production has never had a row to undo** — `claude_ro.coach_changes` is empty for the owner, so
  this is the first real exercise of a path that has existed unused. That is also why the owner's
  Q-472 decision made it a prerequisite: the exposure appears the moment anything drives Coach writes.

<a id="2026-08-25-component-size-stale-baseline"></a>

# 2026-08-25 — the ratchet row that kept a fixed file exempt (Q-138)

**Branch:** `fix/component-size-stale-baseline` · **Lane B** · one script, one backlog table.
No product change, no version bump.

## Found by re-measuring a table, not by reading code

Q-138 lists six component-size hotspots with concrete extractions and says — correctly — *"take them
opportunistically when already touching the file, not as a dedicated PR."* That instruction was
respected. What the entry does not say is that **two of its six rows were already done**:

| file | entry says | actually |
|---|---:|---:|
| `app/health/health-content.tsx` | 991 | **651** |
| `components/more/profile-tab.tsx` | 849 | **476** |
| `components/workout-screen.tsx` | 1851 | 1820 |
| `app/session-select/session-select-content.tsx` | 1478 | 1456 |
| `components/config-screen.tsx` | 997 | 997 |
| `components/config/program-editor-sheet.tsx` | 963 | 963 |

Both finished files are **under the 800-line limit**, and their proposed extractions cite line ranges
that no longer exist — `health-content`'s row points at lines 588-779 of a file that is 651 lines
long. **A stale row is worse than no row**: it sends the next reader somewhere specific and wrong.

## The hole underneath

`app/health/health-content.tsx` was still in `check-component-size.js`'s `BASELINE` at **915** while
sitting at **651** — silently re-granting it **115 lines** of room it was no longer entitled to.

The script's own header has said *"Shrinking one below the limit? Delete its row — it is then held to
LIMIT like everything else"* since it was written. **Nothing enforced it**, and the rule has now been
missed three times: `health-sections.tsx` was removed correctly on 2026-08-09, then `profile-tab.tsx`
sat listed at 476 and `health-content.tsx` at 651. `CLAUDE.md` records the first two and reads as
though the habit held; it did not.

`check-client-today-timezone.js` has enforced exactly this for its own baseline all along — *"BASELINE
is shrink-only and these files have improved — lower them in the same PR, so the reclaimed ground
cannot be given back silently."* This is that half, arriving late in the sibling that needed it.

## What shipped

- `health-content.tsx` removed from the baseline. Four hotspots remain, all genuinely over the limit.
- A stale-row check: any `BASELINE` entry whose file is now at or below `LIMIT` — or has been deleted
  — fails, naming the row and its current size.

**Deliberately narrower than its sibling.** The timezone check fails whenever a listed file merely
*improves*; doing that here would fail CI on a routine refactor that trims thirteen lines off a
1,833-line hotspot, which is noise, not a finding. The rule enforced is only the documented one — a
row for a file no longer over the limit — which is the case that was actually missed three times.

## Verified

- `check-component-size` → *"no .tsx file over 800 lines beyond the 4 recorded hotspots"*, exit 0.
- **Proved the guard fires**, which is the only thing that makes it worth anything: a probe row
  claiming a 900-line baseline for `components/ui/sparkline.tsx` (68 lines) reports
  *"BASELINE holds file(s) that are no longer over the limit"* and names it. Probe removed.
- `pnpm check:rules` **Ran 56 of 56** · `check-backlog-pointers` OK at 194 entries.

## Not exercised

Developer tooling; nothing rendered changed, nothing device-related. **The four remaining extractions
were not done** — Q-138 says to take them opportunistically when already in the file, and that stands.
