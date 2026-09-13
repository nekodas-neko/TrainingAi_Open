# Session journal — batch folded 2026-09-10

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-08-25-drop-running-baselines"></a>

# 2026-08-25 — drop the `running_baselines` table (Q-301b)

**Branch:** `chore/drop-running-baselines` · **Lane A** · migrations 220 + 221. No user-visible change.

Q-301 removed the code half on 2026-08-24 — `saveRunningBaseline`/`getRunningBaseline`, the
`RunningBaseline` interface, the dead write in `app/api/running-plan/route.ts`, and the Drizzle
`schema.ts` entry. That left the physical table behind as a leftover no query could name. The owner
authorised the drop the same day and the `Gate: owner` was cleared; this is that follow-up.

## Why it was safe to drop, evidenced rather than assumed

Re-verified against production immediately before writing the migration, because the authorisation
rests on the table never having been written:

- **`n_tup_ins = 0`**, with `n_tup_upd` and `n_tup_del` also 0, and 16 kB total. That counter is a
  lifetime insert count maintained on every write — **not** a planner estimate like `n_live_tup`
  (which is stale on this database: `last_analyze` is NULL on every table, and trusting it once
  filed a data-loss incident, Q-528, that had never happened) and **not** row-scoped to one user
  like a `claude_ro` `count(*)`. No row has ever been inserted by anyone.
- **The emptiness is explained**, not a mystery: the writer landed in migration 146 *after* the only
  `running_plans` row was created (2026-07-21), and no plan has been created since. Not a silent
  write failure.
- **The feature uses something better.** `resolveSnapshot()` in
  `packages/shared/src/running/assemble-plan-context.ts` recomputes from `fitness_tests` and
  `body_metrics` fresh on every request, so the 12 `prescribed_runs` derive from live data rather
  than the plan-creation-time snapshot this table would have held.

## The dependency the backlog entry did not mention

`claude_ro.running_baselines` is a **view over the table**, rebuilt by every claude_ro migration
through 218. A bare `DROP TABLE` would have failed on the dependency, and a `CASCADE` would have
taken the view silently. So this is two migrations, following the exact shape of the
`214_drop_push_subscriptions` / `215_claude_ro_views_drop_push` pair:

- **220** drops the view **by name** — cascade would silently take whatever else happened to depend
  on the table, and the point of a migration like this is that its blast radius is written down —
  then drops the table. Both `IF EXISTS`, so a re-run is a no-op.
- **221** regenerates the whole claude_ro schema from
  `scripts/generate-claude-ro-views.js`. A **new** number rather than an edit to 218: `ensureSchema`
  tracks applied migrations by filename, so an edited already-applied file is skipped forever and
  the change silently never lands.

Filename sort order is what guarantees 220 runs first.

The generator **reads the live local schema**, not `schema.ts`, so 220 had to be applied locally
before 221 could be generated. Worth knowing for the next table drop — it is not obvious from the
file, and generating first would have silently reproduced the view.

## Verified

- **593 test files, 4,877 tests, 0 failures** (`unit` 570 files / 4,809 tests; `rollup` 23 files /
  68 tests). The three `claude_ro` suites were run again on their own to confirm they **ran** rather
  than skipped — 31 passed, 0 skipped. That matters because `claude-ro-readonly-role.test.ts` skips
  silently under the socket-form `DATABASE_URL`; both runs used the TCP form.
- `tsc --noEmit` clean · `pnpm lint` 0 errors (123 pre-existing warnings) · `pnpm check:rules`
  **Ran 57 of 57** · `check-migration-numbers` 218 numbers, no collisions, next free 222 ·
  `check-export-coverage` OK at 84 tables.
- Diffed 221's view list against 218: **the only difference is the removal of `running_baselines`**
  (88 → 87 `CREATE VIEW` statements). No other view changed.
- Confirmed the generated file contains no owner id — views scope on
  `current_setting('app.claude_ro_owner', true)` since Q-456, and the value passed to the generator
  appears nowhere in the output.
- `pnpm dev` booted clean, `[ensureSchema] 0 applied, 0 already present, 0 failed`, no
  relation-does-not-exist errors in the log. `/api/version` 200, `/api/running-plan` 401 unauth
  (fail-closed, as it should be).

## Not exercised

- **The migrations have not run against production** — that happens on the Railway deploy after
  merge. Locally they applied cleanly to a database that already carried all 219 prior migrations,
  and CI's Migration Check runs them against a fresh one.
- **No authenticated round-trip of `/api/running-plan`.** Its code no longer references the dropped
  table (Q-301 removed every reference; `tsc` and the full suite confirm), so the unauthenticated
  load check plus the suite was judged sufficient. Nothing device-specific is involved.
- Nothing native, offline-first, safe-area or gesture-related is touched, so no device smoke run is
  owed.

## Left in the queue deliberately

The entry's closing observation is **not** actioned here and is not lost: this is the third instance
of a recurring class — Q-270 (`training_load_ots`: live producer, zero rows) and Q-231 (the
"Exercise detected" card losing its only writer) — and it proposes a CI check that flags a
repository read method with no callers outside the data layer. That is its own piece of work, filed
as **LA-26** rather than folded in here.

<a id="2026-08-25-exercise-catalogue-missing-muscles"></a>

# 2026-08-25 — five catalogue rows get the muscles their sibling movement already had (BF-16a)

**Branch:** `fix/exercise-catalogue-missing-muscles` · **Lane A** · migration **216**, v1.370.2.

The owner's report was *"hip thrusts and dumbbell shoulder press should be able to be a secondary"*.
That reads as a threshold complaint and is not one. The role rule reads muscle counts, and BF-15's
anchor rule wants a catalogued exercise with **≥ 3 muscles** — so a row seeded with two can never be
classified above accessory whatever the thresholds say. Five rows were seeded short.

| Exercise | Recorded | Added | Established by |
|---|---|---|---|
| Cable Chest Dips | chest(m), triceps(s) | shoulders(s) | `Dip`, `Weighted Dip`, `Barbell Bench Press`, `Machine Chest Press` all carry shoulders on the same pressing pattern |
| Dumbbell Shoulder Press | shoulders(m), triceps(s) | traps(s) | `Barbell Overhead Press` |
| Cable Pulldown | lats(m), biceps(s) | upper back(s) | `Close Grip Lat Pulldown`, `Chin-Up`; `Pull-Up` carries it as a main |
| Barbell Hip Thrust | glutes(m), hamstrings(s) | quads(s), lower back(s), adductors(s) | no in-catalogue precedent — anatomical, per BF-16a |
| Barbell Shrug | traps(m) | upper back(s), forearms(s) | `Farmer's Walk` for forearms, the other grip-loaded traps movement; upper back has no precedent |

All five now sit at ≥ 3, which is the threshold the entry existed to clear. BF-16a's *rhomboids* is
written as `upper back` because `normalizeMuscle()` folds it there.

## The entry's premise was wrong in one way that mattered

BF-16a says *"Surface: production data. Not reproducible against the local seed — the dev database is
seeded correct."* It is not. The short lists were written by the seeds themselves (migrations 008 and
032) and are identical everywhere: fingerprinting all **140 seeded rows** (`merged_into IS NULL`,
`created_by IS NULL`) in the local dev DB against production, the `muscles` column **matches on every
one** — the only differences in the whole table are a sort-collation artefact and one row named
`Cable Crunch` locally against `Cable Crunch Abs` in production.

That is the difference between "correct a drifted production row" and "correct a defective seed", and
it is good news: the defect reproduces locally, so the fix could be exercised through the real route
instead of reasoned about.

## What shipped

Migration **216**, an idempotent append. Each statement adds one assignment and skips when the row
already names that muscle, compared **case-insensitively** — the catalogue carries a few Title Case
values (`Barbell Jefferson Curl` records "Lower Back", `Dumbbell Fly` records "Chest"), and without
the fold a row that already named the muscle in another case would get a duplicate, which every
weighted-set tally would then count twice.

Nothing else changed. Array order is not load-bearing: every consumer filters on `role`
(`lib/coach/tools.ts`, `lib/local-store/program-assembler.ts`, the two raw-SQL tallies) and none
indexes the array, so appending is safe.

**This retroactively changes past weeks' numbers, and that is intended.** `weekly-muscle-sets` reads
`exercise_library.muscles` in a live subquery rather than from a stored per-muscle total, so history
re-derives against the corrected catalogue the moment the migration lands.

## Scope — the five named rows only

Scanning the whole live catalogue for the same shape found **eight more rows**. They are filed as
**LA-24** rather than folded in, because they split into two kinds that want different handling:
five where another family member already records the muscle (propagating the catalogue's own answer —
`Dumbbell Overhead Press`, `Machine Shoulder Press`, `Arnold Press`, `Lat Pulldown`,
`Decline Bench Press`), and three families where BF-16a's own additions have no precedent, so
extending them means originating anatomy five more times. That second half wants an owner answer, and
it is cheap to defer: a catalogue UPDATE is reversible by another UPDATE.

Fixing the five does create a fresh inconsistency — `Barbell Shrug` at 3 while `Dumbbell Shrug` and
`Machine Shrug` sit at 1 — which LA-24 records rather than leaves implicit.

## Verified

- **Through the live route, before and after.** Seeded two sets of `Barbell Hip Thrust` against the
  dev DB and called `/api/weekly-muscle-sets` as the test user: `glutes 2, hamstrings 1` with the
  catalogue row put back to its pre-fix value, and `glutes 2, hamstrings 1, quads 1, lower back 1,
  adductors 1` after re-running 216 — the secondary half-weight showing correctly (2 sets × 0.5).
  Fixtures deleted afterwards; the tally is back to its seeded state.
- `/api/exercise-library` serves all five at their corrected counts (141 rows).
  `/api/muscle-recovery` 200, unchanged in shape.
- `lib/data/postgres/__tests__/exercise-catalogue-missing-muscles-migration.test.ts` — **5 passed**,
  covering the additions, the ≥ 3 threshold, idempotency across three runs, the case-insensitive
  guard, and an untouched neighbouring row.
- **Mutation-proven, both directions.** Dropping the `lower()` fold fails the duplicate case;
  dropping one row from the VALUES list fails two others. Re-running 216 twice more against the dev
  DB leaves the whole table's fingerprint unchanged.
- `pnpm check:rules` — **Ran 56 of 56**. `pnpm lint` — 0 errors.

## Not exercised

- **Nothing ran on the S25.** No APK is needed — the device's local `exercise_library` mirror is
  hydrated from `/api/workout-data` in `workout-screen.tsx:421` and upserted with
  `muscles=excluded.muscles`, so a corrected catalogue reaches the device on the next workout-screen
  load through the normal path. That reasoning is from source, not from a device.
- **The migration has not run against production.** It is idempotent and narrow, but the five
  production rows were read, not written, this session.
- The AI periodization engine's own weighting copy
  (`lib/data/postgres/slices/periodization.ts getWeeklySetsByMuscleGroup`) was not exercised; it
  reads the same column through the same shape and takes the correction for free, unverified.

<a id="2026-08-25-nutrition-day-artboard-parity"></a>

# 2026-08-25 — the day screen's meal grouping was inverted (BF-24, artboard 1)

**Branch:** `feat/nutrition-day-artboard-parity` · **Lane B** · `nutrition-content.tsx` +
`meal-card.tsx`. JS-only — no APK needed.

## What the owner saw

*"Is that the final design? thats not what the mockup looks like (Nutrition — the day)"*, with
artboard 1 attached. Q-395b had ticked an 11-section coverage checklist and measured gap
reclamation, and the screen still did not look like the drawing — because the checklist was about
*behaviour* and the complaint is about *layout*. BF-28 makes parity the acceptance test.

## ④ is the one that mattered, and both layouts were "grouped"

Artboard 1 groups the **food rows within a meal**: the meal name is an uppercase label *outside and
above* a rounded card, with the meal's total right-aligned on that same line, and the card contains
only the rows. Q-395b grouped the **meals within one container**: a single bordered box with
`divide-y` hairlines, each meal's name *inside* it.

Both are legitimately describable as "grouped", which is exactly why ② passed its checklist and
still read as wrong. The fix is the inversion, not more grouping.

`grouped` was MealCard's only prop for that old shape and it had one call site, so it is gone rather
than left meaning nothing.

## ① and ⑤, and what was deliberately kept

- **The header is one band.** 26 px title with the **date** as its subtitle and the gear at the
  right — the shipped screen had a static *"Food diary & macros"* line that said nothing and pushed
  the date onto a second row of its own.
- **The meal header line is the name and one calorie number.** The emoji and the P/C/F chips are
  gone from it; the macros already have a home in the meal's totals footer, and the same split at
  two sizes was the noisiest thing on the screen.
- **The day chevrons and the per-meal ⊕ stay**, though the drawing shows neither. An artboard
  depicts a *state*, not the controls that reach it: the swipe alone is not a discoverable way to
  change day, and per-meal add is the only way to log to a meal that is not the current hour's. The
  chevrons' hit area went from 28 px to 44 px on the way, since they had to be rebuilt anyway.

## What did not ship, and why — the entry asks for this explicitly

- **② the energy block.** Merging `CalorieBalanceBar` into `MacroRing` as one donut-left card is not
  a day-screen change: `CalorieBalanceBar` also renders on `/health`
  (`health-sections.tsx:658`). Two screens, so it wants its own PR with Health verified alongside.
- **③ the four-tile action row.** Search · Scan · Photo · My meals overlaps **Q-395c**, which owns
  collapsing the capture entry points. Building four tiles before that entry decides what they open
  would wire destinations it may then change. Q-395c ships them.
- **⑥ the row thumbnail** is Q-406's — `food-row.tsx` says outright no call site passes one.
- **⑦ the four sections the drawing lacks** — `MealPlanReviewCard`, `MealPlanSection`,
  `TdeeAdaptationCard`, day-tools — **stay below the meals**. BF-28's rule 1: an artboard is 812 px
  and stops at the fold, so absence from it is not a deletion order. Recorded as decided.

## Verified

- **Structural parity against the artboard's own inline styles**, read back out of the running app
  at 412 dp: the title computes to `26px` / weight `600` (the drawing's `font-size:26px;
  font-weight:600`), the header is a single band, and all six meal types render an uppercase outside
  label.
- **11 nutrition e2e specs green** — `food-row-shared`, `meal-type-reassign`, `nutrition-tail-order`,
  `calorie-progress-bar`, `one-calorie-budget`. Behaviour is unchanged; only the arrangement moved.
- `tsc --noEmit` clean · lint clean on both touched files (the one warning in
  `nutrition-content.tsx` is a pre-existing `useLayoutEffect` dep at line 167, untouched).

## Not exercised

**Nothing visual was judged by eye.** Parity here was checked *numerically* — computed styles read
back and compared against the artboard's inline values — because that is what this harness can do.
Whether it now *looks* like the drawing is the owner's call on the device, and that is what the
entry keeps. The web sandbox also renders safe-area insets as 0, and the header is the element that
sits under the status bar.

<a id="2026-08-25-nutrition-day-screen-grouping"></a>

# The rest of the day screen's gapped cards become grouped sections (Q-395b, complete)

**Branch:** `feat/nutrition-day-screen-grouping` · **Lane B** · v1.366.0

The half I left on Q-395b's `Keep:` line yesterday, finished. The reason for stopping was scope
caution rather than a real blocker, and it does not survive a second look: taking a card from
`rounded-2xl border` to full-bleed is a small change per component, and the browser can check it at
the right viewport in both themes — which is what happened here.

## What shipped

Two more grouped sections, on the same pattern `MealCard` established:

- **Today's energy** — `CalorieBalanceBar` + `MacroRing`. They are two views of the same number and
  a gap between them read as two unrelated cards.
- **Reference** — `WeeklyNutritionChart` + `SupplementsSection`. Neither is about today's meals;
  both are reference rather than action.

Each of the four components takes a `grouped` prop that drops its own rounding and border, because
inside a section those put a second hairline against the section's and re-open the gap the grouping
closes.

## The whole arc, measured

Same seeded day throughout:

| | scroll height | gap px | share |
|---|---|---|---|
| before Q-395b | 2,649 | 420 | 16% |
| after the meal list (#440) | 2,580 | 320 | 12% |
| after this | **2,538** | **280** | **11%** |

**140 px of gap removed; the screen is 111 px shorter.** Gaps 16% → 11%.

The entry claimed the gaps were *"most of the vertical space this screen spends on nothing."* They
were 16%, and they are 11% now. Worth doing, not what the entry said.

## What is deliberately still ungrouped, and why it is not scope caution

`MealPlanReviewCard`, `MealPlanSection`, `TdeeAdaptationCard`, `FoodLoggingComplete`, the action row
and the End of Day button. Every one of them is **conditional** — `TdeeAdaptationCard` returns null
unless it has something to say, the plan cards depend on a plan existing — so a fixed group container
around them draws an **empty bordered box** on the days they are absent. Grouping them means adding
`{(a || b) && …}` guards around each pair, which trades the gap for a different kind of clutter.

The two groups shipped here are safe because their first member always renders: the balance bar and
the week chart are unconditional, so `SupplementsSection` being today-only cannot empty its section.

## Verification

Driven at 412×915 against `pnpm dev` + local Postgres, **in both themes, each on a fully loaded
screen** (the previous PR's dark run sampled mid-load — that gap is closed):

```
light  {"scrollHeight":2538,"gaps":280}  gaps 11%  checklist 11 of 11  macro % 25% 3% 72%  errors 0
dark   {"scrollHeight":2538,"gaps":280}  gaps 11%  checklist 11 of 11  macro % 25% 3% 72%  errors 0
```

The dark screenshot was read: the energy section draws as one bordered block with a hairline between
the bar and the ring, and the split arc's three colours are correct against `oklch(0.05 0 0)`.

**Coverage checklist, asserted individually in both themes:** ✓ ScreenHeader + date nav ·
✓ CalorieBalanceBar · ✓ MacroRing · ✓ NutritionActionRow · ✓ MealPlan card/section ·
✓ TdeeAdaptationCard · ✓ MealCard × meal types · ✓ FoodLoggingComplete · ✓ WeeklyNutritionChart ·
✓ SupplementsSection · ✓ End of Day.

`tsc --noEmit` clean · `eslint` zero warnings introduced (the one on `nutrition-content.tsx` is the
pre-existing `useLayoutEffect` dep) · `pnpm check:rules` **Ran 56 of 56** · `check-component-size`,
`check-memo-prop-stability` clean.

## Not exercised

**No device smoke run**, which remains this entry's stated bar and the only thing left on it. Nothing
here is safe-area-sensitive, but `divide-y` over a `bg-muted/60` child is exactly the shape Samsung's
WebView compositor has caught out before, and there are now three such sections rather than one.

**A past date was driven and is fine** — on *Yesterday* the three groups hold 2, 6 and **1** child
(`SupplementsSection` correctly absent), and **zero** of them render as an empty bordered box. That
is observation, not reasoning.

**An empty day was not opened.** The meal group is guarded by `mealTypes.length > 0` in source, so a
brand-new account draws no meal section rather than an empty one — read, not run. The zero-data e2e
account exists and a spec could pin it.

<a id="2026-08-25-nutrition-day-screen-sections"></a>

# The day screen's meals are one grouped section, and the ring is split by macro (Q-395b)

**Branch:** `feat/nutrition-day-screen-sections` · **Lane B** · v1.365.0

## The entry's justification is overstated, and the measurement is the finding

Q-395b says grouped sections replace gapped cards because the gaps are *"most of the vertical space
this screen spends on nothing."* Measured on the same seeded day, before and after:

| | scroll height | gap px | share |
|---|---|---|---|
| before | 2,649 | 420 | **16%** |
| after | 2,580 | 320 | **12%** |

So the gaps were **16%**, not most, and this reclaims **100 px** of them. The screen is 69 px
shorter rather than 100 — the other 31 px is the per-macro percentage this PR adds under each label,
which is a deliberate trade, not a regression.

Sixteen per cent is still a screenful of scroll over the page, and worth taking. It is not the
argument the entry makes, and the next phase should not inherit that claim unexamined.

## What shipped

**The meal list is one bordered block with full-bleed dividers**, not six cards with gaps between
them. `MealCard` takes a `grouped` prop that drops its own rounding and border — inside the section
those put a second hairline against the first and re-open the gaps the grouping closes. Standalone
callers keep the card.

**`MacroRing`'s arc is split by macro.** The sweep still measures progress toward the calorie goal;
what changed is that it is coloured by where those calories came from. One ring, three segments — a
second ring was the alternative and the design pass rejected it. Degrees accumulate rather than each
segment being placed independently, so rounding cannot open a hairline between two colours. Each
macro's share is printed under its label, because a coloured segment on its own does not say it is
25% and the colour is the only thing tying the two together.

Observed with two foods logged: **25% / 3% / 72%** against 19.1 g protein, 2.3 g carbs, 24.8 g fat —
76.4 / 9.2 / 223.2 kcal of 308.8. Correct to the digit.

## The Atwater factors had four copies; `components/` now has one

Writing the split needed kcal-per-gram, and the honest way to get it exposed a "One Formula, One
Place" violation: `packages/shared/nutrition/calorie-balance.ts` has a `KCAL_PER_G` that is **not
exported**, `goal-recommendation.ts` hardcodes `* 4` / `* 9` at three call sites, and
`components/nutrition/saved-meal-card.tsx` wrote the sum out longhand.

`components/nutrition/macro-energy.ts` is now the one copy `components/` uses, and
`saved-meal-card.tsx` was converted to it — so this branch **removes** a duplicate rather than
adding a fifth. The two in `packages/shared/` are Lane A's and cannot be reached from here; filed as
**LB-9**. Adding a sixth copy to close that gap is how there came to be four.

## Extract before adding

`nutrition-content.tsx` was at **789 of a hard 800** — it is not on `check-component-size.js`'s
baseline, so it fails CI the moment it crosses, and this phase adds to it. The trailing group
(finished-logging marker, week chart, supplements, End of Day) moved to
`components/nutrition/day-tools-section.tsx`. The file is **773** now, with room for phase 4.

## Coverage checklist — all 11 sections, ticked against the running app

Driven at 412×915 and asserted individually:

✓ ScreenHeader + date nav · ✓ CalorieBalanceBar · ✓ MacroRing · ✓ NutritionActionRow ·
✓ MealPlanReviewCard / MealPlanSection · ✓ TdeeAdaptationCard · ✓ MealCard × meal types ·
✓ FoodLoggingComplete · ✓ WeeklyNutritionChart · ✓ SupplementsSection · ✓ End of Day

**The entry's list is one short.** It names 11; the screen renders **12** — `FoodLoggingComplete`
shipped with BF-6 after the entry was written, and sits between the meals and the week chart. Its
stated order is also wrong in one place: End of Day is last on the page, after supplements, not
between the meals and the chart.

`tsc --noEmit` clean · `eslint` zero warnings introduced (the one on `nutrition-content.tsx` is a
pre-existing `useLayoutEffect` dep, confirmed by stashing) · `pnpm check:rules` **Ran 56 of 56** ·
`check-component-size`, `check-memo-prop-stability` clean.

## Not exercised

**No device smoke run**, which is this entry's stated bar (*"as Q-395a"*). Nothing here is
safe-area-sensitive — no new bottom-anchored control — but the grouped list changes borders and
backgrounds across the screen's largest block, and Samsung's WebView compositor is exactly where a
`divide-y` over a `bg-muted/60` child is worth a look.

**Dark theme was not measured on a fully-loaded screen.** The dark run sampled mid-load (3 of 7
probes, macros still 0), so the numbers and the checklist above are from the light run. The light
screenshot was read; the dark one was not re-taken. Both themes render the sheet correctly per
Q-395a's checks a few hours earlier, and nothing here introduces a colour literal, but the grouped
list's dividers in dark are unverified.

**The gapped-card treatment is untouched outside the meal list.** CalorieBalanceBar, the plan cards,
the week chart and supplements still draw their own rounded borders with gaps between them. Taking
those full-bleed too means editing eight more components' chrome with no device check available,
which is a worse trade than leaving it — phase 3 is the entry's, and this is the part of it that is
genuinely better done.

<a id="2026-08-25-q555-offline-tap-not-reproducible"></a>

# 2026-08-25 — the offline tab tap is not silent on current `main` (Q-555 closed, not fixed)

**Branch:** `docs/q555-offline-tap-not-reproducible` · **Lane B** · docs only. No product change, and
the parked branch `fix/offline-tab-tap-native-fallback` should **not** be merged.

Q-555 said that offline, before the service worker claims the page, a tab tap is a silent no-op —
*"URL unchanged, no navigation, no offline page, no feedback of any kind"*. The entry's own remaining
task was to reproduce that tap, after three earlier Playwright attempts failed for three different
reasons. It was driven, and **the silent no-op does not reproduce in either window.**

## How it was driven

Chromium against `pnpm dev`, signed in as the seeded user, with `**/sw.js` aborted at the route
level so `navigator.serviceWorker.controller` stays `null` for the whole run — a deterministic stand-in
for the uncontrolled window that does not depend on catching a race. Confirmed `controller: false`
before every case. `handleNavClick` was temporarily instrumented to print whether it ran, with what
`pathname`, and whether it had an `onTabChange`; the instrumentation was reverted before committing.

## What the three cases actually do

| | state | result |
|---|---|---|
| **1. settled tab route** | hydrated, offline, no controller | tap **navigates** `/health → /nutrition`; `app/error.tsx` renders *"You're offline — This screen needs a connection. Your saved data is on the other tabs."* |
| **2. loading fallback, pre-hydration** | offline, no controller | `handleNavClick` **never runs**; the anchor performs a **native** navigation and lands on Chrome's *"No internet"* page |
| **3. loading fallback, hydrated** (destination RSC stalled 25 s) | offline, no controller | tap navigates `/nutrition → /health`, same explicit offline screen as case 1 |

**Case 2 is proved by the navigation itself, not by the instrumentation.** `handleNavClick` calls
`e.preventDefault()` unconditionally, so a native browser navigation is only possible if the handler
did not run — which before hydration it cannot. Nothing in React is running there, and the worker is
not installed either, so there is no code of ours in a position to respond at all.

## Two of the entry's premises do not hold on current `main`

- **`app/error.tsx` is the missing feedback, and it already exists.** The failed RSC fetch reaches the
  error boundary, which renders an offline screen naming where the user's data still is. The entry
  and the review it came from both list "no offline page" as part of the symptom.
- **`tab-loading.tsx`'s `<BottomNav />` — the one with no `onTabChange` — is not what receives the
  tap.** Measured on the fallback: **one** `<nav>` on screen, and its handler logged
  `hasOnTabChange: true`. `TabShell`'s nav is the live one across the transition. The entry's
  mechanism (point 1 of its diagnosis) is not what happens.

And `TabShell`'s in-app tab switch **does** change the URL, contrary to the diagnosis's *"a tap is
pure in-app state and never routes"* — visible in cases 1 and 3, where the pathname changes.

## Why the parked fix must not ship

`fix/offline-tab-tap-native-fallback` adds a toast inside `handleNavClick` gated on
`offline && !controller`. In case 2 that handler never runs, so the toast is inert exactly where the
defect is real. In cases 1 and 3 the handler does run — and the navigation **works**, so the toast
would be a false alarm on top of a screen that already explains itself. The branch's predicate and
its unit test are sound about the browser state; what is unsound is the assumption that this state
means the tap will be silent.

The predicate file and test are left on that branch as the record. Nothing from it is merged.

## What is genuinely left, and why nothing was built

Case 2 — a first-ever load that loses its connection before hydration — sends the user to the
browser's error page and loses the app shell. That is worse than a no-op, and it is **inherent**: no
JavaScript of ours is running and the service worker, which is the only thing that could serve
`/offline`, has not installed yet. The service worker already does `skipWaiting()` and
`clients.claim()`, so it claims as early as it can. There is no fix available in the click handler or
anywhere else in app code, which is why this closes rather than being re-filed.

## Not exercised

Web build only, `pnpm dev`. Not run on the S25 APK, where the worker's install timing and the WebView
lifecycle differ — the case-2 window may be wider or narrower there. Since the conclusion is that
nothing should be built, the device check is not gating anything; it is recorded here so a future
report of a dead tab bar on install day is read against these measurements rather than against the
entry's original description.

<a id="2026-08-25-quantity-sheet-collapsing-rows"></a>

# The quantity sheet, and one row shape for every food (Q-395a)

**Branch:** `feat/quantity-sheet-collapsing-rows` · **Lane B** · v1.364.0

## What shipped

`components/nutrition/quantity-sheet.tsx` — editing one ingredient's amount, on its own screen.
`components/nutrition/ingredient-row.tsx` is **deleted**, and the meal builder's rows are the shared
`FoodRow` Q-406 shipped. `QtyUnit` moved to `saved-meal-qty.ts`, beside the maths that uses it.

This is finding 12 made real: **a row in a list carries no editor at all.** That is the only reason
one row component can serve the diary, the library, both search lists and now the builder — a row
with a stepper, a number field and a unit toggle inside it cannot be the same component as a row
that is just a name and a number.

## Three things the entry got slightly wrong, and what was done instead

**"`ingredient-row.tsx` becoming `food-row.tsx`" could not be followed literally** — `food-row.tsx`
already exists as Q-406's shipped component. The instruction beside it is the one that matters
(*"the collapsed shape IS Q-406's row — not a second component"*), so `ingredient-row.tsx` is gone
rather than renamed onto a live file.

**`Needs: Q-406` was stale.** Q-406's own text has said *"Q-395a's `Needs: Q-406` is satisfied"*
since 2026-08-23, but the field the tool reads still said otherwise, so this entry sat parked. Same
field-vs-prose gap as Q-306's, removed here.

**Q-395b's `Needs: Q-395a` is cleared too.** What phase 3 depends on is these components existing.
They do. Q-395a stays queued only for its device smoke run, and a device check on the builder does
not gate the day screen.

## The memo check earned its place

The first version passed `onPress={() => setEditingIngredientId(item.id)}` from inside a `.map()`,
which defeats `FoodRow`'s `memo()` silently. `check-memo-prop-stability.js` failed the build and
named the line. The fix is the pattern `ingredient-search.tsx` already keeps — a small memoised
wrapper taking scalars and a stable `useCallback` — not a hoist, because a hook cannot live in a
`.map()`.

## 48 dp, as one change rather than eight

`components/ui/segmented-tabs.tsx`: `min-h-11` → `min-h-12`, which lifts all **8** call sites at
once. The batch-size stepper and its field went 44 → 48 as well. Measured after: segments render at
exactly **48 px** on `/more` and `/health`, with no horizontal overflow on either.

## Verification

Driven in a browser at 412×915 against `pnpm dev` + local Postgres, through the real sheet, in
**both themes**:

| | |
|---|---|
| header | the meal's name over *"Makes 1 portion · 149 kcal each"* |
| collapsed row | *"Chicken pate · 1 serving · 48 g · 149 kcal ›"* — no editor |
| sheet header | *"INGREDIENT 1 OF 2 · Q395A PROBE MEAL"* |
| `2 srv` preset | 298 kcal (2 × 149) |
| srv → g | field showed 96 (2 × 48 g) |
| `+` step | 101 g |
| Done | row wrote back *"101 g · 313 kcal"*, totals followed |
| Remove | list emptied, sheet closed |
| edit an existing meal | saved (`POST` 201), reopened via **Edit** — header reads *"Edit path probe · Makes 1 portion · 149 kcal each"*, row collapsed, sheet opens with the right kicker |
| tapped-row highlight | **false → true → false** across open and Done |

Colours invert properly — light `oklch(1 0 0)` on `oklch(0.145 0 0)`, dark `oklch(0.05 0 0)` on
`oklch(0.985 0 0)` — so nothing is hardcoded. Zero page errors in either theme.

`tsc --noEmit` clean · `eslint` zero warnings introduced · `pnpm check:rules` **Ran 55 of 55** ·
`check-component-size`, `check-hex-literals`, `check-memo-prop-stability` all clean.

## Not exercised

**The device smoke run this entry names was not done, and a browser cannot stand in for it.** The
web sandbox renders safe-area insets as **0**, and `SheetContent side="bottom"` is what owns the
bottom inset — so the one thing most likely to be wrong on the S25 is exactly the thing this check
cannot see. That matters more than usual here because the sheet's action row now carries a
**destructive** control (Remove) beside Done.

**Only the library search path fed the sheet.** The Open Food Facts and AI-estimate paths were
exercised in BF-11a and are unchanged by this diff, but the ingredient this run edited came from the
local library.

Nothing checked on the S25.

<a id="2026-08-25-quantity-sheet-convergence"></a>

# 2026-08-25 — there were two quantity sheets, and the busier one was the wrong one (BF-26)

**Branch:** `fix/quantity-sheet-convergence` · **Lane B** · one new shared component, two sheets
shrunk. JS-only.

## What the owner photographed

*"the UI could use some work; everything looks the same"* — and the screenshot named the wrong sheet
in a useful way. `quantity-sheet.tsx` (the meal builder's, Q-395a) already matched artboard 6.
`quick-edit-log-sheet.tsx` — the one reached by tapping any logged row on the day screen, so far
more often — did not: no unit toggle, `×0.5 ×1 ×1.5 ×2 ×3` multipliers instead of absolute presets,
and four identical monochrome macro columns with `kcal` among them at the same weight.

The complaint was literally true of it. The `−`, the value and the `+` were the same rounded square
at the same fill and near-identical height, so the number the sheet exists to set had no more weight
than the buttons that nudge it.

## One editor, two sheets

The defect was that the two existed separately, so the fix is
`components/nutrition/quantity-editor.tsx` — the stepper, the unit toggle, the presets and the macro
line — rendered by both. `qtyFromInput` and `steppedQty` come with it, so grams and servings cannot
drift apart between the builder and the diary. Each sheet kept only its own header and actions:
`quantity-sheet.tsx` 156 → 83 lines, `quick-edit-log-sheet.tsx` 195 → 158.

`MACRO_COLORS` is in the editor, so P/C/F read the same inside the sheet as on the row behind it.

**Cancel is gone**, which the entry asked to be decided explicitly. The drawing has none, and the
sheet already had two ways out — the X that `SheetContent` renders, and the back gesture that
BF-27 shipped this morning. A third beside a bin was the ambiguous control, not a safety net;
nothing is written until Save, so every exit discards the edit identically.

## The finding: a font-size class on an input does nothing on a phone

Item ③ asked for the value to be *"larger and visually distinct from its steppers"*. `text-2xl` on
the input **had no effect**, and the probe said so: 16 px.

`app/globals.css:530` sets `input, textarea, select { font-size: 16px !important }` inside
`@media (max-width: 640px)` — the iOS-zoom guard, and 640 px covers every phone, which is the only
runtime that matters here. So a size class on an input is inert on the canonical target while
looking perfectly correct in the source.

`!text-2xl` fixes it, and does not reintroduce what the guard prevents: the guard wants a **floor**
of 16 px to stop focus-zoom, and 24 px clears it. Measured after: value 24 px in a 56 px box against
48 px steppers.

**Scope, measured rather than assumed:** only two other inputs in the app carry a size class, and
both want ≤16 px — which is exactly what the guard exists to enforce. So this bites only when a
caller wants *larger*, and mine was the only one. Narrow, but silent, and worth knowing before
someone else spends an afternoon on it.

## Verified

- **12 e2e specs green**, chosen because they drive these two sheets or their neighbours:
  `sheet-back-dismiss` (which opens the quick-edit sheet directly), `back-dismiss-sweep`,
  `food-row-shared`, `plan-meal-to-saved-meal`, `recipe-url-to-meal`.
- **Read back out of the running app at 412 dp**: the diary sheet renders `srv`/`g`,
  `1 srv · 2 srv · 3 srv · 100 g`, and `200 kcal · P 26 · C 1 · F 0` in
  `rgb(34,197,94)` / `rgb(59,130,246)` / `rgb(249,115,22)` — the `MACRO_COLORS` values exactly. Its
  buttons are Remove · Save · Close, with no Cancel.
- `tsc --noEmit` clean · lint clean on all three files.

## Not exercised

**The device.** The action row's safe-area inset renders 0 in the sandbox and Remove sits in that
row. And whether the sheet now reads as *one thing* rather than a wall of equal squares is a visual
judgement I cannot make — I can only show that the sizes, colours and controls now differ where the
drawing says they should. That is what the entry keeps.

<a id="2026-08-25-raw-store-findings"></a>

# 2026-08-25 — the raw-store console says what its numbers mean (Q-538, the visible half)

**Branch:** `feat/raw-store-findings` · **Lane B** · `components/oura-ble/**` only. No schema, no
route, **no APK** — this is JS in the WebView, so it reaches the device on the next Railway deploy.

Q-538 asks for two things: **a bound** on the device raw store, and **a visible failure state**. This
is the second. The first is still blocked and this PR does not pretend otherwise.

## What was missing

`RawStoreStatusConsole` has printed `total / rolled up / unrolled / on disk / low disk` since Q-33,
and the numbers were correct. **Nothing said what they meant.** The owner took the first-ever device
reading on 2026-08-18 — **209,326 rows, 0 rolled up, 31.2 MB** — and establishing that `0 rolled up`
was *the fault* rather than a curiosity took a source trace: `pruneRaw`'s predicate is
`rolled_up = 1 AND synced = 1 AND measured_at < ?`, so with nothing marked rolled up the documented
14-day retention window can delete **no row at all**, and the store grows unbounded at the measured
~3.4 MB/day.

A readout that needs a source trace to interpret has a missing half.

## What shipped

`components/oura-ble/raw-store-health.ts` — a pure function over the plugin's own return shape,
producing the findings the numbers already support:

- **warn** — nothing rolled up, so the prune matches nothing and the store has no upper bound.
- **warn** — past Android Auto Backup's 25 MB per-app quota, so none of it is backed up. Re-verified:
  `AndroidManifest.xml:14` still sets `allowBackup="true"` with no `dataExtractionRules`.
- **warn** — `lowDisk`, i.e. the service is shedding rows and frames are being lost outright.
- **note** — a *partial* rollup, with the percentage. Said deliberately, because "some rolled up" is
  the state that looks healthy while falling behind, which is the retention decision's own warning.

Rendered as a list under the readout, each line carrying a `!` or `·` **beside** the colour rather
than relying on it — the repo's colour-only-state rule, and this card gets read on a phone in
whatever light the owner is standing in.

It is a pure function on purpose: the console is native-only (`getOuraBle()` returns `null` in a
browser), so the interpretation is the part that can be tested at all.

## Verified

- `components/oura-ble/__tests__/raw-store-health.test.ts` — **7 passed**, including the 2026-08-18
  device reading verbatim (both warnings fire on it), the quota boundary asserted at *and* just over,
  an empty store staying silent, and a store that is unbounded **and** unbacked **and** shedding
  reporting all three rather than the first.
- **Rendered** against those same numbers via a temporary scratch route: two lines, both
  `text-destructive`, both prefixed `!`. Route deleted, `.next` cleared afterwards.
- `tsc --noEmit` clean · eslint unchanged (1 pre-existing warning in a sibling file) ·
  `pnpm check:rules` **Ran 56 of 56**.

## What is still blocked, and why it is not this PR

**The bound.** `pruneRaw` can only delete rows marked `rolled_up`, and the only thing that sets that
flag is `markRolledUp`, whose sole caller would be the WebView rollup consumer — **D2 Task 5, still
not built** (re-verified: a repo-wide grep finds no caller for `markRolledUp`, `pruneRaw` or
`getUnrolledRaw` outside the plugin interface declaration). Wiring the prune today would delete zero
rows, which is what Q-538 has said from the start and what the device reading proved.

That work is a rollup consumer over local storage — Lane A's — and there is no queue entry for it to
point a `Needs:` at, so Q-538 keeps it as a written blocker rather than a field that would read as
"already shipped" if the target were absent.

## Not exercised

- **On device.** The findings have never been rendered from a real `rawStats()` call — only from the
  numbers one produced. `Gate: device`, and the check is one press of **Read stats** on
  `/admin/oura-ble` in the APK.
- **The partial-rollup note has no way to be true yet.** Nothing sets `rolled_up`, so that branch is
  unreachable in production until D2 Task 5 lands. It is tested and dead, deliberately: it is the
  case that will matter first when the consumer starts falling behind.

<a id="2026-08-25-saved-meal-meal-type-tags"></a>

# 2026-08-25 — saved meals can say which meals they are (BF-11e)

**Branch:** `feat/saved-meal-meal-type-tags` · **Lane A** · migration **217**, local SQLite **v29**.
No user-visible change yet — BF-11f is the picker.

The owner's report is the whole specification: *"we don't want pancakes recommended for dinner."*
`MealType` is reused as the tag vocabulary rather than inventing a parallel "category": the user
already names and configures their own types with time windows, and a meal can suit several.

## Three decisions, each of which fails silently if taken the other way

**1. `undefined` leaves stored tags alone; `[]` clears them.** The same distinction `imageDataUri`
already draws, and load-bearing for a concrete reason: until BF-11f ships a picker, **every** save
from the saved-meals sheet omits `mealTypeIds`. A `.default([])` on the schema — which `items` has —
would have made tags impossible to keep. It is carried through the shared validator, both routes,
the repository, the outbox replay and the local upsert, because a single link defaulting breaks it.

**2. Soft-deleted meal types are filtered on READ, not deleted from the join table.** `meal_types`
soft-deletes (a food log's `meal_type_id` is `ON DELETE RESTRICT`, so a hard delete cannot work), so
a join row can point at a deleted type. Deleting join rows instead would mean **restoring a type
could not restore its tags**. The filter is one inner join in `listSavedMeals`.

**3. Client-supplied meal-type ids are ownership-verified**, even though `saved_meal_meal_types` has
no `user_id` — its FK proves only that the type *exists*. Same check and same reason as the
food-item one beside it (CLAUDE.md write-path discipline (c)).

## The sync chain, end to end

Traced rather than assumed, and the plan's three constraints all held (line numbers had drifted):
`meal_types` soft-deletes; saved meals reach the device through **`hydrateSavedMeals`, not
`getSyncDelta`**, so tags ride the existing `listSavedMeals` response and there is no pull-delta
branch; and the **push** branch does exist, so route, `pushMutations` and the local table all take
tags here.

**One link is deliberately not wired, and it is recorded in two places.**
`saved-meals-sheet.tsx` still queues a payload with no `mealTypeIds`. That is the correct no-op:
absent means *leave them alone* on both the local upsert and the server replay, while sending the
currently-loaded tags would **revert a change made on another device** between the sheet loading and
the save. There is also no asymmetry for the sync rule to catch — no surface can set a tag today,
web or native. BF-11f's entry now carries the obligation, and so does a comment at the call site.

## What the gates caught that a reading would not have

- **TypeScript** found both local-store mappers the moment `SavedMeal` gained a required field —
  which is the "a missed mapper fails silently as *tags don't save*" hazard the plan names.
- **`check-export-coverage.js`** refused the new table until it was classified in
  `lib/export/export-map.ts`. Scoped through the meal, matching `saved_meal_items`.
- **`claude-ro-readonly-role.test.ts`** would have failed on the view-count divergence; migration
  **218** regenerates the views (87 → 88). It only runs under the **TCP** `DATABASE_URL` — under the
  session hook's socket form it skips, silently, which is exactly the trap `CLAUDE.md` documents.
- **`check-backlog-pointers.js`** caught both stale pointers (migration, SQLite version).

## A defect found in verification, not in review

The first version answered **HTTP 500** for an unknown meal type. That is wrong twice: the client
gets an empty body instead of a message, and **offline it is worse than wrong** — the outbox treats
5xx as *retry* and 4xx as *quarantine*, so a mutation that can never succeed would be retried
forever, which is the queue wedge CLAUDE.md has three production incidents about.

Both write handlers are now wrapped in `withRouteErrors`, and the refusal is a `UserFacingError`.
The sibling `Unknown food item` guard in the same function was converted with it — leaving it would
have meant two refusals of the same class, one line apart, answering 400 and 500.

## Verified

- `saved-meal-meal-types.test.ts` — **10 passed**. **Mutation-proven three ways:** treating
  `undefined` as clear, dropping the ownership check, and dropping the soft-delete filter each fail
  their own tests.
- **The mutation run also found a defect in the test file**, which is why it is worth doing: one
  seeded fault produced *two* failures, and the second was a fixture leak — a test that soft-deletes
  a meal type restored it in its own body, so a body that failed part-way left the next test looking
  at a deleted type. The restore moved to `beforeEach`; re-running the same mutation now fails
  exactly one test.
- Full suite **589 files / 4,831 tests passed**, 0 failures. `pnpm check:rules` **Ran 56 of 56**.
  `tsc --noEmit` clean.
- **Through `pnpm dev`**: POST with a tag stores and returns it; PUT **without** mentioning tags
  keeps them; PUT with `[]` clears them; an unknown meal type and an unknown food item both answer
  **400** with a message; a non-UUID answers 400 from the schema; 21 tags answers 400 from the cap;
  GET carries `mealTypeIds`. Fixtures deleted afterwards.

## Not exercised

- **Nothing on the device, and the local half is the part that cannot be exercised here** —
  `getLocalStore` returns null in the sandbox, so `saved_meal_meal_types`, the v29 upgrade and the
  hydrate path are covered by the schema checks and by reading, not by running. **The v29 upgrade on
  a device that already holds `saved_meals` is the specific thing to watch**: it is a new table, so
  `CREATE TABLE IF NOT EXISTS` does reach upgraded devices (unlike the v27/v28 column case), and
  `RECONCILE_TABLES` is the authority if it half-applies.
- **The migration has not run against production.**
- **No planner reads these tags yet.** Storage and transport only; BF-11f adds the picker and the
  slot matching is later still.

<a id="2026-08-25-scan-multi-candidate"></a>

# 2026-08-25 — the scan route stops merging several meals into one (BF-11b)

**Branch:** `feat/scan-multi-candidate` · **Lane A** · `app/api/nutrition/scan/route.ts`, v1.372.0.

`ScanSchema` returned exactly one `name` + one `ingredients[]` for every input, so a week of
meal-prep containers, a page with four recipes, or *"lunch was X, dinner was Y"* was forced into one
merged estimate. The route now returns a candidate per meal.

## The shape, and why the top level did not move

The model returns `candidates` **only**; the route builds the response's top level from
`candidates[0]`. Asking the model for both would mean the first dish is described twice and could
disagree with itself — and `toMeal()` builds the top level and every array entry, so the two cannot
drift. A test asserts `candidates[0]` deep-equals the top level.

**The top level had to stay a single meal.** BF-11b says four call sites read it and names
`saved-meals-sheet.tsx`. **Both halves are wrong**: that file does not call this route — its `fetch`
goes to `/api/nutrition/saved-meals` — and there are **five**, the two missed being the ones that
matter most: `my-meals-picker.tsx` reads `body.ingredients` and `ingredient-picker.tsx` gates on
`scan.calories > 0`. Either would fail *silently* if the top level became an array. The plan
(`plans/2026-08-24-meal-creator.md` §4.1) is corrected in this PR, because BF-11c reads it next.

## The measurement that changed the work

The splitting decision is a model behaviour, and the plan is explicit that it is the whole risk in
this item. The first version of rule 5 ended *"When in doubt, return one"* — which fought its own
repeated-portion clause. Five **identical** tubs, six runs:

```
5, 5, 1, 1, 5, 1
```

**A coin flip on the feature's headline case.** One passing run would have shipped it; six runs found
it. Splitting the rule in two — *unsure whether components share a plate → one* and *separate
portions are separate **even when identical*** — and re-measuring:

| case | want | 5 runs |
|---|---|---|
| five meal-prep containers | 5 | 5, 5, 5, 5, 5 |
| three identical tubs of chilli | 3 | 3, 3, 3, 3, 3 |
| lunch wrap + dinner bolognese | 2 | 2, 2, 2, 2, 2 |
| curry + rice + naan on one plate | 1 | 1, 1, 1, 1, 1 |
| six-component mixed grill | 1 | 1, 1, 1, 1, 1 |
| a banana | 1 | 1, 1, 1, 1, 1 |

**30 of 30.** The bottom three exist because sharpening the split rule is exactly the change that
could start cutting one crowded plate into six; the seesaw was measured, not assumed.

## Bounds

Candidates cap at **8**; a candidate with no ingredients is dropped rather than shipped as a named
zero (totals are summed from that list); `identified: false` still returns none, and so does a list
whose every entry is empty. A stated `recipeYield` divides **each** candidate — a per-response divide
would leave dishes 2..n at whole-batch calories, a 4× overstatement that looks entirely plausible on
a card. Where one page states one yield across several dishes the division is ambiguous, so the note
says it was applied to each rather than dividing silently. The JSON-LD page name is used only when
there is exactly one candidate; with several it describes the page, not any dish.

## Verified

- `multi-candidate.test.ts` — **10 passed**, model mocked. **Mutation-proven three ways:** removing
  the cap, dividing only the first candidate, and keeping empty candidates each fail their own tests
  and no others.
- `splitting-decision.live.test.ts` — **6 passed** against the real model. **It does not run in CI**
  and is gated on `RUN_LIVE_AI_TESTS=1`, not merely on a key being present, so a key in the CI
  environment cannot silently turn every PR into a paid non-deterministic run.
- Full suite **588 files / 4,821 tests passed**, 0 failures. `pnpm check:rules` **Ran 56 of 56**.
  `tsc --noEmit` clean, `pnpm lint` 0 errors.
- **Through `pnpm dev` against the local DB**, logged in as the seeded user: multi-dish text → 2
  candidates with the top level deep-equal to `candidates[0]`; `200g grilled chicken breast` → 1
  candidate, 330 kcal / 62 g protein; a car park → `Could not identify food`; an empty body → 400
  `Provide image+mimeType, text or url`.

## Worth knowing for the next AI item

**The model is reachable from an agent sandbox.** `GOOGLE_GENERATIVE_AI_API_KEY` is set and
`generateObject` works through the proxy, so an AI behaviour change can be *measured* here rather
than reasoned about. No baton had recorded this. The measurement above is the argument for using it:
the defect it found was invisible to a single run, to the type checker, and to every mocked test.

## Not exercised

- **No image and no URL was scanned end-to-end.** Both branches are covered by mocked tests and share
  the same `toMeal` path, but every live call was the text branch.
- **Nothing on the device.** No UI consumes `candidates` yet — that is BF-11c (Lane B) — so what
  reaches the S25 today is only the changed top level for a multi-dish input.
- **The live test's 30/30 is one afternoon's model.** It pins the split against drift only when
  someone runs it; CI cannot.

<a id="2026-08-25-score-band-colour-only"></a>

# 2026-08-25 — the colour-only score, and the three entries the queue was handing to the wrong lane

**Branch:** `fix/score-band-colour-only` · **Lane B** · one component line, three backlog lane
fields. No schema, no route.

## Q-281's cheapest subset — one site, not a sweep

Q-281 asks for an audit of every surface rendering a bare score, and names its own cheapest first
pass: the ones failing the colour-only-state rule, *"since `scoreBand()` colour without
`scoreBand()` label is already a `CLAUDE.md` violation"*.

All nine non-test `scoreBand()` call sites were **read**, not counted. Exactly one is a violator:

- **`readiness-breakdown.tsx:72`** — the **"Final readiness"** row colours the score by band and
  shows no band word, in the branch that renders no legend either. A bare amber `62` says nothing to
  anyone who cannot see amber. The label ships beside it now.

**The other eight are fine, and a grep says otherwise — which is the point.**
`contributor-chart.tsx` contains no `.label` anywhere and would top any "colour without label" grep;
it renders `<ScoreBandLegend />`, which pairs every colour with its meaning, and is correct.
`score-ring`, `alternatives-card`, `contributor-detail`, `contributor-details`,
`health-score-detail` and `oura-score-chip-row` all render the word already.
`app/api/ai/health-insight` uses only `.label` and never the colour.

**This is the Q-491 lesson arriving again**: that entry claimed nine `aria-expanded` violators and
had two, because a chevron grep cannot see a Radix trigger. A zero-label grep count is not a
violator list either. Reading nine files cost minutes and removed eight false positives.

## Three entries the tool was serving to the wrong lane

`next-item.js` shows an entry with **no `Lane:` field to both lanes**, by design — the path rule is
supposed to answer it. For these three the path rule answers *Lane A*, and nothing said so, so they
sat at the top of Lane B's queue:

- **Q-289** and **Q-290** — `expectedRpe`, `autoregulation.ts` and `RPE_DEAD_BAND` all live in
  `packages/shared/src/ai-periodization/`. **And both are scoring changes**, so the route is not an
  implementer's at all: Tuning proposes, the owner signs off, Lane A implements. A proposal is
  incomplete until it states how many other days the change moves.
- **Q-291** — the contradiction is between AI route outputs (`app/api/ai/**`, `lib/coach/**`).

Lane B's READY went **59 → 56**. Only these three were touched: a bulk lane sweep is Orchestrator's
work, not an implementer's, and there is a visible run of unlaned `readiness`/`platform` entries
below them that wants exactly that sweep.

## Verified

- `tsc --noEmit` clean · eslint clean · `pnpm check:rules` **Ran 56 of 56** ·
  `check-backlog-pointers` OK at 193 entries.
- `next-item.js` re-run for both lanes: the three entries move to Lane A's list and off Lane B's.

## Not exercised

- **The amended row was not rendered.** It is a one-line label addition in a branch that needs a
  readiness score with an `ouraScore` present, which the local seed has no row for. The change is a
  literal from `scoreBand()`, which is unit-tested where it lives — but the row itself has not been
  looked at, at any width. `Gate: device`.
- **Q-281's actual survey is untouched** — contributors / trend / action per surface. Only the
  colour-only subset it named as the cheapest first pass is done, and the larger presentation
  question (overlapping Q-278 and Q-305's "computed and discarded" thread) is still open.

<a id="2026-08-25-sleep-fragment-nights"></a>

# Two readers were choosing the nap over the night (Q-274)

**Branch:** `fix/sleep-fragment-nights` · **Lane A** · no migration · user-visible

## The sizing pass changed what the entry was about

All history: **17 sleep rows under 1.5 h across 74 dates, 4 of them exactly 0.00 h.** Every single one
starts between **09:32 and 22:14 local** — daytime detections, not short nights.

Two of the entry's claims are now stale, and both would have sent this the wrong way:

1. **2026-08-11 and 2026-08-13 are no longer single-row dates.** Q-536's clock repair, which landed
   two days after this was filed, supplied their real nights. The only genuinely single-row fragment
   dates in all history are 2026-06-01 (1.45 h, Cloud-era) and 2026-08-22 (0.00 h).
2. **The readiness claim no longer holds.** `previousNight` and `sleepBalance` reach sleep through
   `readiness-payload.ts`, `sleep-trend.ts` and `score-audit/sleep.ts` — all three go through
   `nightSessions`, which already drops zero-duration rows and classifies naps out by circadian
   midpoint. **16 of the 17 fragments were already handled.**

## So the invariant was decided; the defect was readers that bypassed it

The entry says *"decide the invariant once, at the write or at `nightSessions`"*. It is decided, and
`sleep-night.ts` is a careful piece of work. What it does not do is reach every reader. Two were
choosing for themselves:

**`/api/day-log` picked `sleepRes.value[0]`.** `listSleepSessions` orders by **date only**, so within
a date the row order is whatever Postgres returns. On the 15 dates carrying both a fragment and the
night, the day log was choosing between them **by coin flip**. It now aggregates through
`nightSessions` and takes the longest night — chosen from the rows the query already restricted to
that date rather than re-deriving the wake day, because production carries rows whose stored date
disagrees with their local wake day.

**The sleep list rendered a 0.00 h night.** `mergeByDate`'s `primaryCluster` takes the longest row, so
nap-plus-night dates were already right; a date whose *only* row is zero-duration returns early from
the one-row fast path, and 2026-08-22 reached the list as a night of zero hours. A bed period the
recorder never resolved into sleep is not a short night — `computeSleepScore` already returns null
for it. The predicate is now imported from `sleep-night.ts` as `recordsSleep` rather than copied,
since a second copy is how the two drift.

## A finding this PR did NOT fix

**There are two implementations of "which rows are the night."** `sleep-night.ts` classifies by
circadian midpoint then merges within a 3 h gap; `lib/sleep/merge-sessions.ts` takes the longest row
plus anything within 1 h. They agree on the production history, which is why nothing has surfaced —
but *One Formula, One Place* calls two implementations of one metric a bug by definition. Converging
them changes the owner's main sleep surface and wants a device check, so it is filed as a `Keep:`
rather than smuggled into this diff.

## Verification

Eight tests, **both fixes proven by mutation**: reverting the day log to `value[0]` fails four of
five (including the ordering pair, which is the whole point — passing one order proves nothing), and
letting zero-duration rows through fails two of three.

- `pnpm check:rules` — Ran 56 of 56. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- Full suite: 4754 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode`).

## Not exercised

**Nothing was seen on device**, and both changes are read paths on surfaces the owner looks at daily
— the day log and the sleep list. `pnpm dev` could not be run (missing `@sentry/nextjs`).

The write path still stores 0.00 h rows. That is now filtered at both read paths; whether the rollup
should refuse to write them at all is untouched. And 2026-06-01 still classifies as a 1.45 h night —
it sits in the night band, so the classifier is behaving as designed, and no decision was made about
whether that row should exist.

<a id="2026-08-25-suspend-temp-penalty"></a>

# The temperature penalty is suspended until its baseline is centred (TN-6a)

**Branch:** `fix/suspend-temp-penalty` · **Lane A** · no migration · user-visible

## Why now, and why on its own

`computeBlendedScore`'s absolute-°C ladder penalises readiness at |dev| > 0.3 / 0.5 / 1.0. That only
works if the deviation is centred on zero. BF-13's zero-seeded baseline sat **0.363 °C low**, so the
deviation was positive on **34 of 34 nights**, the ladder fired on **91.2%** of them, and being
healthy cost **−16.3 readiness points a day**.

The seed fix shipped hours ago, but the owner's *stored* baselines are still the zero-folded ones
until a Redecode re-derivation runs. The entry is explicit that this lands first and alone.

## Self-clearing, which is the whole design

`isTemperatureBaselineCentred` suspends the ladder while the trailing mean deviation sits outside
**±0.15 °C**, or while there are fewer than **10** nights of readings to judge by. It re-evaluates on
every request against the 28-day summary window the payload already loads — no extra query — so the
moment a Redecode centres the stored deviations the ladder returns **with no deploy**.

That is the entry's own argument: a `TODO: remove after` can be forgotten, a computed condition
cannot. It is also what makes it safe to ship ahead of the re-derivation.

**Too little history suspends.** Absence of evidence is not evidence of centredness, and it costs
nothing — a baseline that young was never trustworthy through this ladder.

**The mean is the entire test.** The entry offered a fraction-negative check as an alternative; it is
deliberately not ANDed in. A mean inside ±0.15 °C already implies both sides are represented, and a
second condition would make the suspension harder to clear without measuring anything new.

**The thresholds are untouched.** Widening them would hide a broken input behind a plausible firing
rate and permanently desensitise a real fever once the baseline converges — the answer TN-6, Q-506
and BF-13 all give.

## What it costs, stated plainly

Fever detection through this one path, until TN-6 replaces the ladder. Near zero while the condition
holds: a deviation positive on every single night cannot distinguish illness from baseline error in
either direction. The owner was told this before choosing.

## Verification

Eleven tests, **both halves mutation-verified**: ignoring the suspension fails five cases, dropping
the min-nights guard fails one.

- The suspension is exercised against the **owner's real 34-night shape** (mean +0.662 °C, every
  night positive), and clearing is proven on that same history shifted to centre — the entry asked
  for both fed through, "not by reading the condition".
- One test pins that **only** the temperature arm is suspended: ACWR still moves the score, and a
  below-threshold deviation is unchanged in both states.
- `pnpm check:rules` — Ran 56 of 56. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- Full suite: **4776 passed, 51 skipped, 0 failures.**

**One unexplained flake, recorded rather than dismissed.** An earlier full run showed 2 failures in
`claude-ro-owner-bootstrap.test.ts`. It passes alone, passed on the immediate re-run, and my diff
touches nothing near it — it matches the DB-contention class CLAUDE.md documents. Noted because
"it went away" is not the same as "it was explained".

## Not exercised

Nothing on device, and **nothing observed in production**: the suspension is proven against the
owner's measured deviation values, not against a live readiness response.

**This is a suppression, not a fix.** It must be retired by TN-6 rather than left as permanent
behaviour — TN-6's own pass test (deviation mean within ±0.05 °C of zero) is what retires it, and
until then the ladder is off for anyone whose baseline is uncentred.

<a id="2026-08-25-timeline-workout-day-detail"></a>

# 2026-08-25 — the timeline's workout card had a destination for seventeen days (Q-93-followup)

**Branch:** `feat/timeline-workout-day-detail` · **Lane B** · `components/home-day-timeline.tsx` +
one new e2e spec. JS-only — no APK needed. **v1.371.0.**

## What the entry was waiting on had already arrived

Q-93-followup was filed on 2026-08-06 with the workout card left unwired because *"no historical
per-session HR-chart + exercise-detail screen exists at all"*. A correction two days later pointed
at Q-110's mockups as the destination. **Q-110 shipped on 2026-08-08** as `/health/day`: its
Training section renders every session of a day with its exercises, sets, duration, volume and
kcal, tapping an exercise opens `ExerciseHistorySheet`, and the Activity section opens
`ActivityDetailSheet`. The card has had somewhere to land ever since, and nothing tracked the
dependency clearing — the entry kept describing a gap that had closed.

Two more of its premises had also gone stale:

- It says the wiring must be applied to **both timeline renderers**,
  `components/home-day-timeline.tsx` and `app/health/timeline/page.tsx`. The second file no longer
  exists. There is one renderer, mounted from `app/session-select/session-select-content.tsx`.
- The wiring reads `ev.date`, which the pushed workout event never sets. It is not missing:
  `app/api/day-timeline/route.ts:302` stamps `date` on **every** event centrally, after the type
  branches. So this needed no `app/api/**` change and stayed inside Lane B.

## What shipped

`workout` and `walk` cards navigate to `/health/day?date=<the event's own date>`. That covers five
of the seven card types; `bedtime` and `tag` stay inert on purpose, because a projected bedtime and
a ring tag have no detail view to reach and a destination that only repeated the card would be
worse than none.

The timeline is now a `<section aria-labelledby>` rather than a bare `div`. That is not decoration:
a workout card's title is its session name, and Home renders the same string as a session chip
further up the page, so a locator that knows only the text matches both. Naming the region makes
the timeline addressable instead of positional.

## Verified

- **`e2e/timeline-card-navigation.spec.ts`**, and it was proved to fail: with the two-line wiring
  reverted the spec goes red (`element(s) not found`), and green with it. The assertion is the
  destination URL plus the session name rendering on the screen it lands on — a row wired to
  nothing renders identically to a wired one, same card, same `role="button"`, same press feedback,
  which is exactly how this one stayed dead in plain sight. The fixture is anchored to **midday**
  on the user-local day read back from Postgres, because `/api/day-timeline` covers today and
  yesterday only and midnight is where an off-by-one stops being visible.
- **The walk branch was exercised too**, not inferred from sharing a line: an activity log inserted
  for today, tapped in a browser, landed on `/health/day?date=2026-08-25`.
- `tsc --noEmit` clean · `next lint` on the touched file clean (a dead `MapPin` import went with it)
  · `pnpm check:rules` **Ran 56 of 56** · `lib/__tests__/cache-groups.test.ts` 24/24 ·
  `tabs-instant-paint`, `health-tabs-instant-paint`, `home-card-invalidation-refetch` and
  `day-detail-sheets` all green against the changed DOM.

## Not exercised

**No device verification.** This is a navigation change on the canonical runtime's Home screen and
the destination is a navless full-screen route with a bottom-anchored back control — the shape that
has regressed repeatedly. The web harness renders safe-area insets as 0. Recorded as a `Gate: device`
row rather than claimed.

The web build also takes every offline-first fallback, so nothing here says anything about the APK's
local-store path. `/health/day` was already reachable from the calendar, so its own rendering is not
new ground; what is new is arriving there from Home.

<a id="2026-08-25-volume-landmarks-surfaced"></a>

# 2026-08-25 — the volume landmarks reach the card that was guessing (Q-305, the landmark half)

**Branch:** `feat/surface-volume-landmarks` · **Lane B** · no schema, no route, no APK.

## The finding was sharper than the entry's

Q-305 says the landmarks are *"computed and never shown to anyone"*. Re-verified against `main`, and
it is worse than unshown: **`weekly-muscle-sets-card.tsx` was already showing a band — a hardcoded
generic `MIN_TARGET = 10` / `MAX_TARGET = 20` with `barColor` thresholds at 15/10/6.** So the app has
been computing correct per-muscle MEV/MAV/MRV in `packages/shared` and rendering a made-up yardstick
next to it, every week.

**The goal multiplier is what makes that material, and Q-305's own history is the proof.** Its first
pass compared the owner's weeks against the raw hypertrophy row and concluded lats and upper back
were below MEV. The active program is `powerbuilding`, which `volumeLandmarks` scales by **×0.8** —
against the table the app actually uses, both are **in range**, and three other muscles are over
**MRV**. Reading the wrong row inverted the finding from "not doing enough" to "doing too much",
which is exactly what a generic 10–20 band does silently.

## What shipped

`components/health/volume-band.ts` — a pure `volumeVerdict(goal, muscle, sets)` over the shared
`volumeLandmarks`, returning the band **and its word**: `below MEV` · `in range` · `above MAV` ·
`above MRV`. Two of the four are red and mean opposite things, so the word is load-bearing, not
decoration — this is the colour-only-state rule with real teeth.

The card uses it whenever a training goal is known and the program supplies no explicit per-muscle
target. **A program target still wins**: that is the user's own number, not a reference range.

The goal needed no Lane A change. `workout-data:meta` already carries `program.trainingGoal`, and
`health-content.tsx` already fetches that exact key — it is captured from both the sync cache seed
and the network callback, so first paint has it too.

Two details that would otherwise have shipped wrong:

- **The bar gained a second marker at MRV.** With only the MEV line, a bar past maximum recoverable
  volume just looks like a long bar.
- **The footnote follows the bands.** It read *"Vertical line = 10-set minimum. Green = 10–14 sets ·
  Blue = 15+ sets."* — caught in the rendered output, not by reading the diff. A caption that
  disagrees with the chart above it is worse than no caption.

## Verified

**Unit** — `components/health/__tests__/volume-band.test.ts`, **13 passed**: all eight muscles from
the entry's 56-day measurement land in the bands it recorded (glutes/hamstrings/triceps over MRV,
shoulders/biceps above MAV, lats/upper back in range, calves under); the goal multiplier moving lats
from `under` to `in`, which reproduces the entry's own correction; each landmark asserted on the
boundary it names; `core` resolving to `abs` rather than falling through to the default (recorded on
the entry as checked-and-clean, pinned so it stays that way); and the two red bands carrying
different words.

**Rendered** on `/health` → Training, against three seeded muscles chosen to hit three bands:

```
Triceps  above MRV  22 sets
Lats     above MAV  11 sets
Calves   below MEV   2 sets
vs MEV–MRV for your goal
Lines = MEV (minimum effective) and MRV (maximum recoverable), scaled to your training goal.
```

Seeded rows removed afterwards. `tsc --noEmit` clean · eslint unchanged (1 pre-existing warning) ·
`check-component-size` clean · `pnpm check:rules` **Ran 56 of 56**.

## The push:pull half is deliberately NOT here

Q-305 says to do the push:pull ratio on the same surface *"rather than as two cards"*, and doing it
here would have meant inventing a muscle → movement-pattern taxonomy inside a component. **There is
no push/pull grouping anywhere in the repo** (checked). That is domain math, it belongs in
`packages/shared` beside `normalizeMuscle` and `MUSCLE_LANDMARKS` under **One Formula, One Place**,
and `packages/shared` is Lane A's. Building a second private copy in `components/` to satisfy "do
them together" would be the wrong trade.

Left on the entry as the remaining half, with the reason, rather than silently dropped.

## Not exercised

- **On device.** The card is browser-verifiable and was verified there, but not at S25 width in the
  APK, where the added band word sits beside the set count on a narrow row. `Gate: device`.
- **The `in range` band was never rendered** — the three seeded muscles deliberately hit the other
  three. It is covered by four unit cases including both boundaries.
- **The shared-treatment question Q-305 raises** (whether Q-278 / Q-302 / Q-305 want one common
  design for "computed and discarded") is untouched. Those entries are not mine to close, and
  answering it inside one card would have prejudged it.

<a id="2026-08-25-workout-store-user-timezone"></a>

# 2026-08-25 — the store stops guessing what day it is (Q-477 complete)

**Branch:** `fix/workout-store-day-rollover-tz` · **Lane B** · no schema, no route.
`check-client-today-timezone` baseline is **empty** — Q-477 is closed.

The last three bare `todayInTz()` calls in client code were `lib/stores/workout-store.ts`'s, and the
entry warned they were a design decision rather than a conversion: a Zustand store has no hook, and
`onRehydrateStorage` runs at store creation, outside React and before any provider mounts.

## The answer was not to thread `tz` in

Both shapes the entry proposed give the store a timezone it has no business knowing — either
`DEFAULT_TZ` plus a reconcile on mount, or a module-level "current user tz" global its own header
warns against. The third option is that **the store stops fabricating a date at all**.

`storedDate` exists for exactly one purpose: to be compared against a "today" so a day rollover can
clear `todayLogged`. It is never displayed and never used for anything else. So it is now written
only by a caller that knows the user's zone:

- `INITIAL_STATE.storedDate` is `''`, not `todayInTz()`. Empty never equals a real date, so the first
  check stamps it — clearing two objects that are already empty on a fresh store.
- `applyRehydrateFixups(state, today, now)` takes `string | null`. `null` means *the caller cannot
  know the zone*, and the date branch is skipped. The transient-mode and stale-anchor fixups need no
  date and still run — a stale `summaryData` still crashes `ExerciseSummaryScreen`, and the done
  screen still re-fires its confetti, so those could not be skipped with it.
- `startWorkout` no longer re-stamps `storedDate`. It marks which day the ticks belong to, not
  anything about a workout, and re-stamping it in an unknown zone is how a wrong zone *hides* a
  rollover that is due.

## The bug underneath was two answers, not one wrong one

`onRehydrateStorage` compared the stored day against **Brisbane** while `workout-screen.tsx`'s
visibilitychange effect compared it against the **user's** zone. For anyone who has pressed
Auto-detect those are different dates, so the app could roll the day over on open — clearing the
morning's completed-set ticks — and then roll it over again on the next resume.

`components/shell/workout-day-rollover.tsx` is now the single place that answers it, from
`useUserTimezone()`, on mount and on `visibilitychange`.

**It is in the root layout, not the workout screen, and that placement is the point.** The check it
replaces ran at rehydrate, which is to say on every app open regardless of which tab that open landed
on. Leaving it behind a mounted `workout-screen.tsx` would have left a user who opens the app on
Session Select after midnight looking at yesterday's ticks — the exact WK-13 symptom, relocated.

## Verified

**Unit** — `lib/stores/__tests__/workout-store.test.ts`, five new cases: a `null` date does not roll
over, a `null` date still applies the transient-mode fixups, a known date still rolls over, the store
starts unstamped, and `startWorkout` does not re-stamp. **28 passed.**

**In a browser**, seeded user moved to `Pacific/Midway` (UTC−11), whose today was **2026-08-24** while
Brisbane was already on the **25th** — so the user's day and `DEFAULT_TZ`'s day were distinguishable.
With a stored day of 2026-08-23 (a genuine rollover owed) and ticks present, opening the app on a
**non-workout** screen:

| | `storedDate` after open | `todayLogged` |
|---|---|---|
| before | `2026-08-23` — no rollover at all | ticks kept |
| after | `2026-08-24` — **the user's day**, not Brisbane's | cleared |

**One assertion in that probe was not discriminating, and saying so matters more than the tick.** The
first case — ticks surviving an open on the user's own day — passed before the fix too, because
zustand's `persist` does not write back the in-place mutation `onRehydrateStorage` makes, so
localStorage still held the ticks the old code had already cleared *in memory*. What the probe reads
therefore lags what the screen shows. The in-memory semantics are covered by the unit cases above,
which call `applyRehydrateFixups` directly; the browser run is evidence for the second row only.

`tsc --noEmit` clean · eslint unchanged on `workout-screen.tsx` (7 pre-existing warnings before and
after) · `pnpm check:rules` **Ran 56 of 56**.

## Not exercised

Not run on the S25 APK. The rollover is plain client state with no native surface, but the resume
path it hangs off (`visibilitychange`) behaves differently in a WebView than in a desktop tab, and a
real app-backgrounding across local midnight is the case that matters. `Gate: device`.

Also not exercised: any user actually *on* a non-Brisbane timezone in production. Every production
row is `Australia/Brisbane`, so this whole entry has always been latent — which is why the button
that triggers it, Profile → **Auto-detect timezone**, is the thing to try first on device.

<a id="2026-08-26-alternative-ring-testing"></a>

# 2026-08-26 — The Colmi R09 in learning mode, and the guard that makes it true (PS-8)

**Branch:** `claude/alternative-ring-testing-jzk8el` · one-off session · plan + one CI check, no
integration code

The owner acquired a Colmi R09 and asked for a deployment plan plus a guarantee: *"are we sure its
data will be read only and wont affect scoring of anything I have going? I basically just want to
ingest the data in a 'learning' mode state."*

## The finding that shaped the design

**The obvious isolation mechanism does not work.** Ranking `colmi_ble` below `oura_ble` in
`HEALTH_SOURCES` would make the per-field merge refuse to let it overwrite an Oura value — and would
not stop it being read. Every scoring read in the app is source-blind:

- `getHrForWindow` (`lib/data/postgres/slices/oura.ts:743`) selects `oura_heartrate` with **no
  source predicate** and hands the rows to `preferStrapBuckets`, which is an **allowlist of exactly
  one value** (`chest_strap`) with everything else falling through untouched. A row stamped
  `colmi_ble` would feed the readiness payload and the body-battery window directly.
- `listBodyMetrics` / `listSleepSessions` / `getOuraDaily` / `getOuraDailyDerived` read whole rows.
  `source_map` is per-field *write* provenance; no read consults it.

Repo-wide, two reads filter `oura_heartrate` by source and both are deliberate (the rollup's `'ble'`
and the comparison adapter). **A row in a shared table is a scored row however it is stamped.** So
isolation has to come from the data never entering those five tables — `oura_heartrate`,
`body_metrics`, `sleep_sessions`, `oura_daily`, `oura_daily_derived`.

## The strongest layer is an omission

Every shared-table write takes `source: HealthSource`, a closed union built from the
`HEALTH_SOURCES` tuple. **Not adding `colmi_ble` to that tuple makes a Colmi write to any shared
table a compile error.** The protection comes from the ladder entry being absent, which means adding
it "just for provenance" is exactly the change that removes the guarantee. Worth stating in the plan
so nobody helpfully adds it later.

## What shipped

`scripts/check-learning-mode-isolation.js`, wired into the Custom Rules job, empty baseline. It
fails on a learning-mode module naming a scoring table or calling a shared writer, on any import
outside its own directory except the comparison adapters, on `colmi` appearing in `HEALTH_SOURCES`,
and on `colmi` appearing in any scoring input.

**It was landed before the integration on purpose** — a guard written after the code is a guard that
can be argued with, and promotion out of learning mode now has to delete a line from this script and
show up in a diff.

**Its first draft was wrong and a probe caught it.** Copying `check-aest-midnight-timezone.js`, it
blanked string bodies as well as comments — so a ladder that *had* been given `'colmi_ble'` passed
silently, and the leak that matters most (a raw ``sql`INSERT INTO oura_heartrate …` `` inside a
string) would have been invisible. It strips comments only now. All four violation shapes were
probed failing, then the tree restored and re-probed clean.

## The R09 specifically

The reference client `tahnok/colmi_r02_client` lists **R02/R06/R10** — the R09 is **not** on it.
A fork (`patmorli/colmi-r09-smart-ring`) targets the R09 and reports the same UUIDs, the same
16-byte framing with a **mod-255** checksum, and the same feature set. That is enough to start and
not enough to build on, which makes Phase 0 — one `0x03` round trip proving transport, framing and
checksum together — the gate rather than a formality.

Sleep is in neither client. Gadgetbridge has it from a separate Wireshark dissection: a port, not a
copy, and Phase 6.

## Phase 0 rewritten for a factory-fresh ring

The owner confirmed no software of any kind is installed. That answers the plan's first open
question in the best way — full on-ring history, nothing holding the BLE connection, nothing to
undo — and it moved two facts into Phase 0 that were not there before.

**The ring ships switched off.** Colmi's FAQ says to charge *"more than 1 hour until the charging
indicator turns green"* to activate it for the first time. Until then it does not advertise, so a
scan finding nothing proves nothing.

**The gate now runs in nRF Connect, not QRing.** Colmi's support material claims the vendor app is
required and that pairing cannot be done outside it; that is a statement about their supported flow,
not a hardware lock — `colmi_r02_client` connects directly with `bleak` and Gadgetbridge exists to
replace the app. A generic GATT explorer pushes no firmware, syncs nothing, consumes no on-ring
history, and settles the entire gate **without a line of code or a repo change** — which also means
a failure there is unambiguously the ring or the model rather than our decoder. QRing is the
fallback if the ring will not advertise after a full charge, with its firmware-update prompt
declined and the app removed afterwards.

The probe packet is generated rather than typed: `03000000000000000000000000000003` (byte 0 `0x03`,
bytes 1–14 zero, byte 15 = sum-of-first-15 **mod 255** = 3). **The battery packet cannot distinguish
mod 255 from mod 256** — both give 3 — so the plan says so explicitly: they diverge once the bytes
sum past 255 (`0x1FE` → 0 vs 254), and a decoder that assumes 256 passes Phase 0 and fails on about
half of all real commands.

§11 of the plan is an empty device record to fill in during Phase 0. A firmware string that was
never written down is a firmware string nobody has, and re-reading it at the end of the trial is how
a silent mid-trial update gets caught.

## Phase 0 ran — transport confirmed, two surprises

Enumerated on the owner's factory-fresh unit in nRF Connect, no vendor app ever installed.
`R09_C400`, hardware `RT09_V3.1`, firmware `RT09_3.10.22_260420`. Service
`6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E` is present with RX `6E400002` (WRITE / WRITE NO RESPONSE) and
TX `6E400003` (NOTIFY + CCCD `0x2902`) — the R02 family's transport exactly. The biggest unknown
about the R09 is settled at the transport layer. **The `0x03` round trip has not run**, so the
framing and mod-255 checksum remain inherited from a client that does not list this model.

**The ring's address is a rotating type, which breaks the pairing pattern the plan assumed.**
`31:37:41:30:C4:00` has the multicast bit set in its first octet, so it is not a valid public
address; as a random address its top two bits are `00` — non-resolvable private, the rotating kind.
Phase 3 had assumed the scale/strap shape, where a `deviceId` is persisted to `localStorage` because
the MAC is stable. The Oura ring is the counter-example already in the repo: rotating RPA, scanned
by name, never by MAC.

It is not conclusive either way — the advertised name encodes the address tail `C4:00` and the
System ID characteristic embeds the whole address, and vendors do not usually bake a rotating
address into a static characteristic. The test is free (re-scan after a day and a Bluetooth toggle)
and it has to happen before pairing is designed, because the failure mode is a pairing that works
all afternoon and is dead the next morning.

**Two services no surveyed client documents:** `de5bf728-d711-4e47-af26-65e3012a5dc7`, a plausible
candidate for the raw/big-data channel behind §4's missing sleep and PPG paths, and `0xFEE7` —
Telink's OTA service, which is the firmware-flash path the mod-firmware rule says to stay away from.
Recorded because knowing where that one lives is the point of an enumeration pass.

## The ring accepts the write and answers nothing

Notifications confirmed enabled on TX, `03000000000000000000000000000003` written to RX and echoed
in its Value field, TX silent. Twice.

**The checksum convention is ruled out and could never have been the cause here** — `0x03` with a
zero payload sums to 3, and 3 is 3 under both mod 255 and mod 256. The one distinction the plan went
out of its way to be careful about is the one thing this probe cannot test, which is worth noticing
about probe design rather than about the ring.

**The R09 is known-good.** [Gadgetbridge #4491](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/4491)
is a user running this exact model with every sensor working, temperature included. So the question
moved from *is the R09 in the protocol family* to *how are we poking it*, which is a much better
question to have.

Ranked suspects in §11c: the write type (RX advertises WRITE and WRITE NO RESPONSE; nRF defaults to
Write Request and hides the selector under **Advanced**); the **Serial Port Service** `de5bf728`,
whose `de5bf72a`/`de5bf729` pair the `RT09_*` firmware line may use instead of `6E40FFF0-…`; a
required handshake; radio power-gating.

The diagnostic that actually separates the failure modes is **`0x10` blink-twice**, because the ring
answers it physically. A blink means the command channel works and only the notify path is broken;
no blink under either write type on either service means nothing is getting through at all.

**Next step is Gadgetbridge, not more nRF poking.** It is open-source, pushes no firmware, and
already works on this model — so it settles framing end-to-end and, if it produces sleep and skin
temperature here, both confirms §4's Phase 6 is achievable and names the codebase to port from.

## Reading the working client settled it, and corrected the plan

The R09 turns out to be a **first-class Gadgetbridge device** — `ColmiR09Coordinator.java`, under the
`yawell` OEM namespace. Reading `YawellRingConstants.java` and `YawellRingDeviceSupport.java`
answered the silence and overturned three things the plan had asserted.

**The checksum is mod 256, not mod 255.** `buildPacket` accumulates `(byte)(checksum + content) &
0xff`. Every Python client says 255, this plan repeated it, and went out of its way to warn that
assuming 256 would fail on half of all commands. Backwards. The two agree below 255 — including
every probe run so far — and diverge above it. The correction is §4b, and the lesson is the repo's
own rule: pin the decoder to a captured vector, not to either claim.

**There are two protocol versions and the ring speaks both.** V1 `6e40fff0` carries the 16-byte
commands; V2 `de5bf728` carries "big data". Gadgetbridge registers both services and subscribes to
both notify characteristics on connect. So §11b's unknown second service is answered — and it is
where **sleep and skin temperature** live, as CRC16-Modbus, length-prefixed, multi-packet payloads.
A different integrity scheme from V1's, in the same device.

That moves sleep from "known-solvable from a second codebase" to solved-on-paper: command `0xbc`,
type `0x27`, stages light/deep/REM/awake as `0x02`/`0x03`/`0x04`/`0x05`. Temperature comes with it
(`0x25`), which neither the Oura BLE pipeline nor any Python client provides.

**Why nothing answered.** Write type eliminated — Gadgetbridge issues a plain Write Request, which
is what was already being sent. Checksum eliminated — both conventions agree on these payloads.
And `0x10` blink-twice **is not a command in this firmware**; Gadgetbridge's equivalent is `0x50`
FIND_DEVICE, so that probe was very likely an unknown opcode and told us nothing. What survives is
the **connect handshake**: subscribe both notify characteristics, wait two seconds, then phone name
`0x04` → date/time `0x01` → preferences → **battery last**. A bare battery request on a fresh
connection is not what the working client does.

## Every protocol hypothesis died; the remaining ones are about device state

The handshake was sent — phone name, then find-device — with both notify characteristics
subscribed. No notification, no blink. Reading the rest of the working client closed the last two
protocol doors: `getBondingStyle()` returns `BONDING_STYLE_NONE`, so no bond is required, and
`ColmiR09Coordinator.getSupportedDeviceName()` is `Pattern.compile("R09_.*")`, which matches
`R09_C400`. Write type, checksum, service and opcode were already eliminated.

That is a useful place to arrive at, because it says to stop testing the protocol. Two candidates
remain and both are about the ring rather than the bytes.

The ring may never have finished its first-activation charge — Colmi specifies more than an hour to
green, and the enumeration started about thirty minutes after unboxing. And the application
processor may simply be asleep: every read that has worked so far (device info, the CCCD) is served
by the **BLE stack**, whereas executing a command needs the **application MCU**, which these rings
power-gate hard. `CLAUDE.md` already records the identical behaviour for the Oura — wakes on
charger, worn and moving, or during sleep — so a ring lying still on a desk is the worst case for
this test. Retry on the charger or worn.

Also noted for next time: nRF Connect's Value field shows what was *sent*, not what the peer
accepted. The log behind the floating button carries the ATT results and errors, and not reading it
earlier left a gap that three rounds of probing could not close.

## Root cause: every write went out as ASCII text

The nRF Connect log settled it in one line. What the phone actually transmitted for the battery
command was `(0x) 30-33-30-30-…-30-33` — `0x30` is `'0'` and `0x33` is `'3'`, so that is the
32-character *string* `"0300…03"` sent as 32 ASCII bytes, not the 16 binary bytes the ring expects.
The write dialog was on TEXT format rather than BYTE ARRAY. The phone-name packet went the same way.

**No valid command was ever sent to this ring.** Write type, checksum, service, opcode, bonding,
device match, handshake, wake state — every hypothesis of the evening was tested against a null
input. They remain correct readings of the working clients' source and not one of them was the
cause.

The tell was on screen for hours: nRF prefixes a byte-array value with `(0x)` and prints a text
value bare. The V1 writes never had the prefix. The V2 writes did — those were real 16-byte writes,
sent on the big-data channel where the raw command format does not apply, so the evening managed
valid bytes on the wrong channel and invalid bytes on the right one.

## The ring was talking the whole time, and its data decodes cleanly

The same log carries notifications on TX: `73-0C-64-00-…-E3`, and later `73-0C-64-01-…-E4`. Against
`YawellRingConstants` that is `CMD_NOTIFICATION` / `NOTIFICATION_BATTERY_LEVEL` / **100% battery** /
charging flag — and **the charging flag flipped from 0 to 1 exactly when the ring went on the
charger**. The checksum arithmetic confirms on real output: `0x73 + 0x0C + 0x64 = 0xE3`, mod 256.

These are the ring's own periodic pushes rather than replies, arriving 18 seconds after one write
and one second after another — which is what a device reporting its own state while understanding
nothing it receives looks like. It also explains `sd…`: `0x73` is `s`, `0x0C` is unprintable, `0x64`
is `d`.

## Both earlier claims about that value were wrong

The first said the gate had passed; the retraction said no notification had arrived because the
Value field was unchanged. The log shows repeated notifications with *identical content*, which
updates the field to the same text. Claim and retraction were each unsupported, because the evidence
sat in a log neither had read.

Confirmed with hex now: transport, notify path, framing, mod-256 checksum. Unproven: the
command→response path, since nothing valid has been sent.

The cheap lesson is to read the transport log before forming a hypothesis. Five rounds of protocol
theory ran against a Value field that was hiding the outgoing bug and the incoming data at the same
time, and every genuine result in them came from reading other people's source rather than from the
device.

## Command round trip confirmed — Phase 0 complete

The owner ran the web client's Start Monitoring with the ring worn and it returned live heart rate.
That is the write direction, the one thing still unmeasured, so Phase 0 is done: services and
characteristics, the notify path, framing and the mod-256 checksum against a real decoded push, Web
Bluetooth connectivity from the S25, and now a command reaching the ring and being acted on.

The caveat is kept deliberately — that was the third-party client's code path. It proves the ring
and the transport, not ours. Ours is proven when Phase 3 drives the same commands from the app.

## Phase 1 shipped: the protocol module

`lib/colmi-ble/protocol.ts` and `lib/colmi-ble/decode.ts`, 32 tests, all green. Pure functions, no
I/O and no clock, so the module runs in the WebView and is testable without a ring.

Framing, commands and decoders cover the full surface rather than the HR-and-steps minimum the plan
originally scoped — the owner asked for full use of the ring, and in a pure module breadth is cheap
once the layouts are in hand. That includes SpO2, HRV, stress, sleep and **skin temperature**, none
of which the Oura pipeline provides.

Two decisions worth not re-litigating later:

**Decoders return relative time and never construct a Date.** `daysAgo`, `minuteOfDay`, BCD parts.
Gadgetbridge resolves these with `Calendar.getInstance()` — the device's own zone — which is exactly
the pattern this repo bans: a phone in another zone keys a night's sleep to the wrong day. The caller
anchors them in the user's timezone instead. The side benefit is that a clockless module cannot grow
an hour-dependent or rolling-window test, which this repo has been bitten by twice.

**Decoders are infallible.** An unrecognised or truncated frame returns `{ kind: 'unknown' }` rather
than throwing — the Oura pipeline's rule, since one bad frame must never take down ingest. A
300-case fuzz test holds it.

The anchor test is the packet captured from the owner's ring, `73-0C-64-00-…-E3` decoding to battery
100% / not charging with the `-01-…-E4` variant charging. Every other vector comes from a reference
implementation; that one comes from hardware.

The isolation guard was re-probed against the real directory rather than a stand-in: naming a
scoring table inside `lib/colmi-ble/` fails, and importing it from `readiness-payload.ts` fails.

## The connector shipped: storage, ingest, pairing card, comparison endpoint

Migrations 231 and 232 (the second regenerates the `claude_ro` views — the schema is default-deny,
so a new table is unreadable until a view exists and each views migration rebuilds the whole
schema). A repository slice, `POST /api/colmi/samples`, `GET /api/colmi/status`, the BLE connector,
a pairing card on More → Devices, and `GET /api/admin/device-comparison` aligning the Oura ring, the
Polar H10 and the Colmi on one grid.

Decisions worth not re-deriving. The local day is resolved **server-side** from the user's stored
timezone and never sent by the client, because every comparison is "what did each device say on day
X" and one writer deciding the day once is what keeps three devices aligned. A **silent ring is not
an empty sync** — zero frames returns `reason: 'silent'` and the card says to wear it or charge it,
since recording that as "no data" would bias the comparison in the direction that looks like the
ring under-reports. The ingest returns `received`, `accepted` and `stored` together, because a
repeat sync storing 0 of 400 is deduping and one number cannot distinguish that from failing.

Verified against a running server rather than asserted: ingest stored 3 of 4 readings with an
implausible 999 bpm dropped per-sample rather than the batch rejected, a second identical POST
stored 0, an unknown key returned 400, and the admin route returned coverage plus all three pairwise
summaries, rejected a bad date and a 30-day-plus range, and accepted both date separators. A
DB-backed test asserts zero rows reach any of the five scoring tables. The BLE layer itself has no
test coverage — it is I/O against hardware — and the mapping under it is pure and covered.

The isolation guard was widened deliberately: "only the comparison adapters may import this" was too
blunt once the device had a connector, since pairing and sync are app code that must reach it and
produce no score. The rules that matter are unchanged — the module still may not name a scoring
table, and the scoring inputs still may not mention it.

## Raw accelerometer moves the ring into the other column

The owner found a Raw Data Mode in the web client: `0xa1` enables ~20 Hz accelerometer streaming on
stock firmware, no flash, and the command is in neither reference implementation. Builders ship with
tests; no payload decoder yet.

The plan had filed the Colmi as a *computed* source, beside Health Connect — a device that hands us
finished numbers. Raw accelerometer puts it beside the Oura as a **raw-capable** one, on hardware
costing a fraction as much with a public protocol. That is a different proposition from a cheap
second opinion on heart rate, and it is now PS-9.

The gesture idea it demonstrates is PS-10, blocked on PS-9 on purpose. The risk there is not
recognition but false positives during resistance training: a missed gesture is an annoyance, and a
false one that skips a set corrupts the log, which is what the app is actually for.

## Deployment shape

No APK. `lib/live-hr/chest-strap-source.ts` already does the full BLE cycle in TypeScript in the
WebView, and the Colmi logs internally so it syncs on app open like the scale rather than needing a
foreground service like the Oura. Ships via Railway; **no uninstall risk to the Oura ring key**.

The migration (Phase 2) was deliberately **not** claimed — Postgres numbers belong to Lane A, and
this was a `PS-` session. Next free was 231.

## Files

- `scripts/check-learning-mode-isolation.js` + `.github/workflows/ci.yml` — the guard
- `docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md` — the deployment plan
- `docs/implementation-backlog.md` — PS-8, `Gate: device`
- `docs/module-map.md` · `docs/domains/devices/README.md` — index rows

<a id="2026-08-26-build-a-meal-add-methods"></a>

# 2026-08-26 — Build a Meal gains a recipe link, and the divide that was already done

**Branch:** `feat/build-a-meal-add-methods` · **Entry:** BF-11c · Implementation Lane B

BF-11's original ask: the recipe scan reachable without starting the whole plan wizard. Three
add-methods beside the existing search, none replacing anything.

## What shipped

**A pasted `https:` link imports the recipe.** It replaces the AI-estimate offer rather than sitting
beside it — running an estimate over the text of a URL produces a food called *https* with invented
macros, which is worse than no offer. Each ingredient is created through `ingredientToEntry`, the
same conversion the plan's copy-to-library path uses, so a recipe imported here and the same recipe
saved from a plan mint identical food items. It stores per 100 g with the weight in the quantity, so
the library gains *Cooked quinoa* rather than *Cooked quinoa (236 g)*.

**A page holding several dishes asks which to keep.** The scan route's prompt is explicit that
separate portions are separate candidates — a page listing four recipes is four — and the response's
top level is only `candidates[0]`, so filling the builder from it and stopping silently discarded the
rest. Each kept dish becomes **its own** saved meal, and nothing is minted until the user chooses.

**The picker's default list is headed.** See the correction below.

## The bug this entry warned about, written and then found

BF-11c says a *"makes 12"* recipe must land as `servings: 12` with the whole recipe's items, because
`SavedMeal.totals` is the whole batch by contract and `oneServingItems()` is the one place that
divides. The contract is right. **The premise under it is not: `/api/nutrition/scan` already
divides.** `toMeal` runs `perServing(c.ingredients, servings)` before it answers, so a page stating
*makes 12* comes back as **one slice**.

The first commit on this branch set `servings = recipeYield` on those already-divided ingredients.
That is the exact double-divide the entry warns about, arrived at by following the entry: every log
would have been **a twelfth of a slice** — a plausible-looking number, twelve times too small.

Found by reading `toMeal` while scoping the candidate picker, not by a test. So the decision is a
pure function with tests now (`recipe-import.ts`, `recipeBuilderPatch`): both divides are correct in
isolation, they live in different files, and the failure is silent.

**What shipped is `servings: 1`** — exact, no divide-then-multiply round trip, and the same encoding
`savePlanMealToLibrary` already uses. Honouring the entry's literal shape would have meant
multiplying the route's division back out, which is lossy for no gain.

**The unstated-yield case is unaffected and is the one that still needs asking.** `recipeYield: null`
makes the route's divisor 1, so nothing is divided and what arrives IS the whole batch — a
banana-bread page measured 1,956 kcal for the loaf. Left alone that silently becomes one portion, so
the builder says so in an amber line pointing at the batch-size field directly above it.

## The History item was already built

§5.3 asked for a default list *"rather than a blank state"*, on the premise that the picker was
type-to-search only. It was not. `searchFoodItems('')` returns the twenty most recently updated
foods — its own comment calls it *the browse-all path* — and `IngredientPicker` already fetched with
an empty query on mount and rendered the result unconditionally.

What it actually lacked was a **heading**, next to a *Food database* heading that had one. That is
what shipped: `Recently used` before you type, `Your foods` after.

## Decisions worth not re-deriving

- **The candidate list does not use `food-row.tsx`.** §5.4 deferred this to a design answer that has
  since arrived: Q-406 shipped, all four call sites converted, and the owner's concession was **one
  optional string**, not a node. A keep/discard control is a trailing *control* rather than a value,
  so it is the wrapper move that concession avoided. Drawn separately, and the plan says so now.
- **Kept candidates are saved, not merged.** A page of four dinners is four things you log
  separately; combining them produces one meal nobody eats.
- **`asHttpsUrl`/`hostOf` moved to `recipe-url.ts`** — both surfaces that accept a recipe link now
  agree on what one is by construction rather than by both being written correctly.

## Two extractions, both forced by the 800-line ceiling

`saved-meals-sheet.tsx` hit it twice. `meal-batch-size.tsx` came out first (the unstated-yield
prompt), then `meal-builder-footer.tsx` (the candidate picker). Both are memoised with scalar props —
they re-render on every keystroke in the ingredient list, and an object prop would defeat the memo
silently. The file ends at **786**, with BF-11d and BF-11f still due to land in it.

## Verification

- `npx tsc --noEmit` clean · lint clean on `components/nutrition`
- `pnpm check:rules` — **Ran 60 of 60**, all passed. It caught one real thing: an inline arrow into
  memoised `MealBatchSize`, which is the rule working rather than a formality.
- Unit suite — **5,208 passed / 57 skipped**, including 7 new tests on the divide
- `check-component-size` — nothing over 800 beyond the four recorded hotspots

### Failure surfaces NOT exercised

- **A real recipe page.** Every scan here is the live Gemini route against a live URL, so nothing in
  the sandbox exercises it end to end — the candidate path in particular has never seen a real
  multi-dish page, only the shape the route promises.
- **The S25.** A new list with a keep/discard control, and a moved footer. `Gate: device`.
- **The native local store.** `createFoodItem` and `savePlanMealToLibrary` both take their web
  fallback here; the offline branch that queues N mutations is device-only.

<a id="2026-08-26-entries-limit-targets-the-grower"></a>

# 2026-08-26 — The journal limit now fails whoever grew the directory (BF-36)

**PR:** `fix/entries-limit-targets-the-grower` · **Lane B** · CI tooling only, no user-visible change

## What was wrong

`check-doc-index-size.js` fails the Custom Rules job when `docs/overview/entries/` holds more than
60 **foldable** (uncited) entries. The threshold is right and the compaction chore is real. What was
wrong is **who paid**: the failure landed on whichever PR happened to be open when the count crossed,
which has nothing to do with whoever grew the directory. Every session writes a journal entry, so the
cost fell at random.

Measured on the day it was filed: it blocked **PR #527**, a docs-only intake whose diff the failure
named none of — and the resolution was not the sweep but **merging `main`**, because another session
had swept concurrently. That PR paid a CI cycle and a diagnosis for a condition it neither caused nor
fixed.

## The fix

The same attribution the line-count ratchet a few lines above already does. It asks whether *this
branch* grew the file, not whether the file is over its number — different questions the moment two
PRs are open at once, and only the first has an answer the author can act on.

- Over the limit **and this branch adds an entry** → fail. That PR is the growth and its author is
  already touching the directory.
- Over the limit **and it adds none** → a note saying so, which is the mechanism that already existed
  for "sweep it when convenient".
- **The base unreadable** (a shallow clone, an export) → still fail. Attribution is impossible there,
  and an unreadable base must not silence the limit.

`dirNamesAtBase(baseRef, dir)` is new in `scripts/lib/base-ref.js`. It returns `null` rather than an
empty list when the base has no such tree, because "the base had nothing" and "we cannot see the
base" lead to opposite conclusions about what this branch added.

## Why it is testable now

The decision moved to `scripts/lib/entries-verdict.js` as a pure function. The two cases are driven
against **fixture numbers, not the live directory** — a regression test for a counting rule that
reads the repo's real count changes verdict as the repo does, which is the one thing it must not do.
The live count was 20 foldable against a limit of 60 when this shipped; none of the seven cases would
exercise the limit at all if they read it.

Reverting the attribution fails two of them: the core BF-36 case, and the one asserting the total
ceiling is still reached when the limit has been excused for this branch.

## Deliberately not done

- **The 250-entry total ceiling keeps failing everyone**, unattributed. The same argument applies to
  it, but BF-36 scopes to the runaway limit and the ceiling is 89 files away (161 today). Widening
  the change to reach it would be my decision, not the entry's.
- **Not raising the limit**, which the entry rules out: it defers the same collision about a week and
  makes the eventual sweep bigger, and the README records sweeps already failing the link checker in
  five separate ways.
- **Not making it warn-only.** A warning nobody must act on is how the directory reached 198 files.
  The obligation stays; it just lands on someone already in the directory.

## Not exercised

- **The failing path has not run in CI**, only in unit tests — the live count is 20 against a limit of
  60, so nothing here can reach the limit until the directory grows again. The wiring that computes
  `addedHere` was checked against the real base (162 entries at `origin/main`), so the inputs are
  right even though the verdict is not yet reachable.

<a id="2026-08-26-feat-saved-meal-tag-ui"></a>

# 2026-08-26 — `feat/saved-meal-tag-ui` (BF-11f) — tagging a meal, and the click event that was eating the argument

**Lane B · v1.388.0 · one entry shipped (BF-11f), one entry filed (LB-20).**

## What shipped

**BF-11f — the meal builder can tag a meal with the slots a plan may use it in.** BF-11e built the
column, the join table, the route field, the local table and the outbox replay, and deliberately
shipped **no way to set any of it**. This is the last link.

- `components/ui/chip-group.tsx` — `ChipGroup`, lifted out of `meal-plan-setup-sheet.tsx`, which had
  the only copy and six call sites for it. Generalised so an option may be `{ value, label }` as well
  as a plain string. **That generalisation is the whole reason it moved rather than being copied:**
  the wizard's options are strings that are their own labels, but a tag's value is a meal-type **id**
  the user must never see, and reusing the string form verbatim would have keyed the chips by name.
- `components/nutrition/meal-type-tags.tsx` — the picker. Memoised, and the `{ value, label }`
  mapping happens **inside** it, over the state arrays the sheet already holds, so the call site
  passes no fresh identity (Q-490).
- `components/nutrition/use-ingredient-quantities.ts` — the ceiling extraction. The builder was at
  784 of its 800 lines; this took the ingredient list and its per-row unit out, leaving the
  arithmetic in `saved-meal-qty.ts` where the tests already are.
- `save-meal.ts` carries `mealTypeIds` to **both** write paths from one destructure. `[]` clears the
  tags, `undefined` leaves them alone — the distinction BF-11e built through the route, the local
  table and the outbox replay, and it is load-bearing in one specific place: overwriting a meal found
  by duplicate detection writes over a meal the builder **never showed**, so it sends `undefined`.
  Sending the builder's (empty) list there would silently wipe that meal's tags.

**Untagged means every slot, not none.** `eligibleForSlot` already returns true for an untagged meal
and is well tested; what this entry had to get right is the *copy*, because chips with nothing ticked
read as "excluded from everything". The hint under them changes with the selection and says which it
is.

## The bug the new test found

`handleSave(overwrite?: ComparableMeal)` was wired as `onClick={onSave}`. React hands the click event
to the first parameter, so **`overwrite` was truthy on every save from the footer button**. Two
consequences, both silent:

1. `if (!overwrite && !duplicateAnswered)` never ran — so **BF-11d's duplicate prompt, shipped
   yesterday in v1.387.0, had never fired once**. Its pure half (`findDuplicateMeal`) is well tested;
   the wiring was not.
2. Once this entry added tags, `mealTypeIds: overwrite ? undefined : mealTypeIds` sent `undefined`.

Neither TypeScript nor `check-memo-prop-stability.js` can see this: `() => void` accepts a handler
taking *more* parameters, and `onClick` accepts a nullary one. What caught it was the new e2e
round-trip failing and the **Playwright network trace** showing a PUT body with no `mealTypeIds` key
at all — not a wrong value, an absent one, which is what pointed at the argument rather than the
state.

Fixed at the boundary in `meal-builder-footer.tsx` (`onClick={() => onSave()}`), because that is
where the event is introduced.

## The sweep, and what it is honest to claim

Two greps over `app/` and `components/` for a handler with an optional first parameter passed bare as
an `on*` prop:

```
function [a-zA-Z]+\([a-zA-Z]+\?:      # declared functions
const [a-zA-Z]+ = useCallback\(\(?[a-zA-Z]+\?:   # arrow handlers
```

Three hits, one benign (`onLogged: (log?) => void` — the prop type declares the parameter and every
caller passes a log). The second real one: `food-list.tsx`'s `onClick={onBuildFirst}`, wired to
`openBuild(meal?)`, which does `meal.items.map(...)` — an event has no `.items`. Fixed the same way.

**That second site was fixed by inspection and NOT reproduced** when this shipped — it is only
reachable with an empty meal library and no spec had one (`food-row-shared.spec.ts:109` matches
`/^(New|Build your first meal)$/` and always lands on `New`, because the seed has meals), so **LB-20**
was filed for the gap.

> **Closed the same day, v1.388.1 — and the reproduction changed one claim here.** With the fix
> reverted, React **swallows** the TypeError: nothing reaches `pageerror`, the sheet stays on an
> empty Meals tab, and the only symptom is a dead button. So the prediction above ("throws") was
> right about the mechanism and wrong about what a user would see — this would have been reported as
> *"the button does nothing"*, not as a crash. See
> [that entry](history-2026-09-01.md).

## Verification

- `pnpm check:rules` — **Ran 60 of 60**.
- Vitest — **5,220 passed**, 57 skipped, 631 files. Five new tests in
  `components/nutrition/__tests__/save-meal-tags.test.ts` assert the tags reach the local upsert
  **and** the outbox payload from one call, that `[]` survives both, that `undefined` omits the key
  on both, that the web fallback carries them, and that Q-216's inner catch still does.
- Playwright — **the full suite**, not a hand-picked subset. That is this session's own correction:
  #567 was verified with nine chosen specs for a change to a shared write path, and a failure reached
  CI. This PR changes the save path for every meal, and the duplicate prompt now fires where it never
  could before, so a subset would have proved nothing about the six other specs that save a meal.
- `e2e/saved-meal-tags.spec.ts` is the round-trip: tap a chip, save, read `saved_meal_meal_types`
  back out of Postgres, then **reopen the meal and assert the chip is ticked**. The reopen half is
  the one a write-only test cannot see — without seeding from the stored tags, the next save sends an
  empty list and clears what was just written.

## Not exercised

The APK. `getLocalStore` returns null in the browser, so e2e covers the route and the read-back;
the local upsert and the outbox payload are covered by unit tests at the call site, not on a device.
Tags are a plain write to an existing synced domain with no new migration, so the device risk is the
ordinary one for this area — but it is unverified, and stays that way until the S25 pass.

<a id="2026-08-26-log-food-one-screen"></a>

# 2026-08-26 — Log Food became one screen, and the list it holds became two

**Branch:** `feat/log-food-one-screen` · **Entries:** LB-16, BF-37 · Implementation Lane B

Two entries that had to ship together. LB-16 collapses the Log Food capture step onto one screen;
BF-37, filed the same morning from an owner report, un-merges the list that screen shows. They touch
the same file, the same tab strip and the same device pass, so building them apart would have meant
cutting the same screen twice.

## LB-16 — five tiles become an action row

The capture step asked **"How would you like to log food?"** and offered five tiles — `Scan Photo`,
`Barcode`, `Describe it`, `Manual Entry`, `My Foods` — before showing any food at all. The list is
the screen now, with `Photo · Barcode · Describe or enter` as an action row above it.

**Describe and manual entry are one panel.** They were two tiles leading to two screens, and which
one you want is not a decision anyone can make *before* seeing the fields. The decided action row
called the pair `Describe or enter` for exactly that reason; the panel now shows the description box
and an explicit way into the manual form together.

### The structuring decision, and where the recorded recommendation was incomplete

The entry offered three shapes and starred the third — *invert: put the capture screen inside
`SavedMealsSheet`*, on the grounds that nothing has to move. That is right, and it understated one
thing: `SavedMealsSheet` is **stacked on** `FoodLoggerSheet`, so putting the capture screen inside it
would have left the logger rendering an empty sheet behind the list — a second scrim and a wasted
back press, on the entry whose title is *six entry points become one*.

So the inversion shipped with one addition: **`FoodLoggerSheet` renders no sheet of its own at the
capture step.** `open && step !== 'capture'` on its own `<Sheet>`, `open && step === 'capture'` on
the list. One screen is one sheet is one back-stack layer.

## BF-37 — the merged list, un-merged

Owner, on v1.382.0: *"my foods combined saved meals + history thats not right they are 2 seperate
things."*

The BugFix entry makes the distinction worth repeating: the question that produced the merge —
*"whats the difference"* — was read as *one list wearing two names*, and it says something narrower.
Two lists that could not be told apart. The fix was to name them so the difference is obvious.

**They are two tabs of one screen, not two sheets.** That is the shape the entry lists first and it
is the one the collapse above makes available: the strip does the telling-apart that two separately
reached surfaces never could, because you can see both names at once.

`Recent` · `Meals` · `Single foods`.

- **The labels drop the possessive deliberately.** `My Foods` against `My Meals` is the pair the
  owner could not tell apart, and two labels differing only in their last word are hard to tell
  apart wherever they appear. `Meals` against `Single foods` names the actual distinction — a
  composition against one thing.
- **`food-list.tsx` was not rewritten**, per the entry: the separation already existed inside it (a
  food row opens the assign step, a meal row opens its own screen). It gained one `show` prop.
- **The page's library button is `My Meals` now** and lands on the Meals tab, so its name matches
  where it goes. Every *save-to-library* string followed it back — 13 occurrences across five files,
  all of which are about saved meals specifically.

## `Recent` reads a meal bucket, and that is a data limit rather than a design choice

There is no unfiltered "recent food items" query on either side: the route is
`recent-for-meal?mealTypeId=…` and the local store is `getRecentFoodItemsForMeal`. Adding one touches
`app/api/**` and `lib/local-store/**` — **Lane A's**, not this lane's.

So the parent resolves a bucket (the preselected one, else `mealTypeForHour`) and the panel reads
that. It is defensible rather than merely tolerable: opening Log Food at 7 pm and being shown what
you usually eat at dinner beats a global list topped by breakfast coffee. If use says otherwise, the
swap is one fetch. **Filed as LB-18** so the option is on the record rather than in a comment.

## What this cost, stated rather than buried

**The nutrition back-dismiss nest is two layers now, not three.** `Add food` → logger → `My Foods`
tile → list → meal was three; `Add food` → list → meal is two. That is what collapsing the screen
was *for*, but it means `back-dismiss-sweep.spec.ts` no longer has a three-deep path to assert on,
and its two nest tests became one.

The three-deep case LB-17 was written for is asserted directly, without a browser, in
`lib/hooks/__tests__/sheet-back-stack.test.ts` — seven cases including the sibling swap and the
StrictMode double-mount, none of which a coordinate tap reached reliably. The surviving e2e test
gained a new assertion in exchange: **a tab switch pushes no history entry.** If it ever did, back
would spend presses on tabs and the unwind would stop matching what the user sees.

## Verification

- `npx tsc --noEmit` clean · lint clean on `components/nutrition`
- `pnpm check:rules` — **Ran 59 of 59**, all passed (one fix: `module-map.md` still named the deleted
  `capture-step.tsx` as the meal-label scan branch)
- `check-component-size` — nothing over 800 beyond the four recorded hotspots;
  `saved-meals-sheet.tsx` is 737
- Unit suite — **5,065 passed / 57 skipped**, unchanged
- Full Playwright suite run locally against the new screen

### Failure surfaces NOT exercised

- **The S25.** Every part of this is layout and gesture: a new tab strip, a rebuilt action row, and
  one fewer sheet in the back stack. `Gate: device`, written into
  [`device-verification-queue.md`](../device-verification-queue.md) — it **replaces** N2's
  three-press check, which is now a two-press check, and rewrites N4 around the split.
- **The native local store.** `getRecentFoodItemsForMeal` returns null in the web sandbox, so the
  `Recent` tab's local-first branch is only exercised on the device.
- **The camera.** `handleCapturePhoto`'s native branch moved file-to-file unchanged; the web branch
  (a hidden file input) is what runs here.

<a id="2026-08-26-manual-bedtime-engine"></a>

# 2026-08-26 — Manual bedtime, the engine half (Q-519)

**Lane A · branch `feat/manual-bedtime-entry` · migrations 233 + 234 · no version bump (no UI yet)**

The owner forgot the ring and fitted it at ~4 am. The session reads 04:23–08:03, 3 h 5 m, and their
concern was narrow: *"I don't want it to change estimated bed time values."* One such night moves the
14-day bedtime mean by **~23 minutes for a fortnight**, and that estimate pre-fills bedtime
everywhere.

## The design changed, because the audit the entry commissioned falsified it

Q-519 proposed writing the remembered bedtime into `sleep_start` at `manual` rank and letting the
per-field merge leave the measured columns alone. That rested on an invariant the entry stated
itself, and warned about: *"if anyone later recomputes duration or efficiency from the span, this
silently produces a 9-hour night at 34% efficiency."*

**Something already did.** [The audit](../reviews/2026-08-26-manual-bedtime-write-audit.md), run
before building and shipped separately, found `aggregateNight` deriving both from the span, the
daytime-HRV model classifying samples by window membership off **stored** rows, and `primaryCluster`
unioning same-date rows within an hour of the window. Reproduced in a test rather than argued: on the
owner's own night plus one fragment, the rejected design gives **10.0 h at 35%** where the measured
window gives **4.62 h at 75%** — same night, same 3.48 h of measured sleep.

So the value gets its own column. **The per-field merge exists to let a better *measurement* of the
same quantity win; a remembered bedtime is a different quantity**, and sharing the observed window's
column was the entire cause.

## What shipped

- **Migration 233** — `sleep_sessions.manual_sleep_start timestamptz`, with a column comment saying
  what may read it. **234** — the `claude_ro` regen (default-deny, so a new column is invisible to
  the audit endpoint until a view carries it); diffed against 232 and it is exactly the one column.
- **`setManualSleepStart(userId, date, at|null)`** — user-scoped, writes one column, **creates
  nothing**, returns `false` when no night exists for the date. A night with no measured sleep has no
  bedtime to correct, and inventing a row would put a duration-less session into every consumer that
  counts nights.
- **`POST /api/sleep/manual-bedtime`** — Zod-validated (`.strict()`, both date separators, since the
  client's `localDateString()` emits slashes), rate-limited, 404 rather than a silent success.
- **The `manual_bedtime` outbox domain** and its `pushMutations` branch, calling the same repo
  function as the route — the two paths cannot drift, and a mutation for a date with no night is a
  permanent 4xx, so it quarantines rather than retrying forever.
- **The local column** via `RECONCILE_COLUMNS`, **no version bump** (additive — the Batch F pattern
  every other sleep column uses), plus the pull mapping and the read.
- **`bedtime-estimate` reads `manualSleepStart ?? sleepStart`** — and it is the only read site in the
  codebase, which is the property the whole design turns on. It substitutes *after* `nightSessions`,
  so the aggregation still decides which rows are one night.

## Verification

Full suite against local Postgres: **628 files / 5,201 tests, exit 0**. `tsc --noEmit` clean.
`check-reconcile`, `check-local-column-upgrade-path`, `check-push-mutations`, `check-api-no-store` all
pass.

**Eight mutations, each with an asserted anchor.** Two survived the first pass and both were real:

- **Nothing covered the local pull at all.** Deleting `manual_sleep_start` from the applyDelta upsert
  changed no test — the exact sync-drift shape the standing rule names, where the server has the data
  and the device silently never sees it. Now covered both ways.
- **Counting placeholders does not catch a column-list skew.** Dropping a column *name* while keeping
  its `?` leaves placeholder count and params length agreeing, and only the column list short — so
  every value after it lands one slot to the left. The assertion now compares the column list against
  the VALUES arity.

## Not exercised

**On-device.** The local column arrives through `reconcileSchema` on a real device and no APK has run
— recorded as a `Keep:` on the entry. Nothing else here is device-dependent.

## What is deliberately not done

**The UI, which is Lane B's**, so nothing can write a bedtime yet. What it needs is on the entry: a
control to set and clear it, the POST, and a `queueMutation({domain: 'manual_bedtime'})` beside it so
the write survives offline. Whether a remembered bedtime should also *display* on the sleep card is a
separate question nobody has asked — the card shows the measured start today, and that is defensible.

Q-520 (the partial-night flag) stays parked behind this: the 3 h 5 m still reaches the sleep score,
readiness's `previousNight`, resilience and the Body Battery anchor. That was always its scope.

<a id="2026-08-26-measured-rmr"></a>

# 2026-08-26 — somewhere to put a measured RMR, and a rule for how it ages (BF-33)

**Branch:** `feat/measured-rmr` · **Lane A** · migrations **225** + **226**. No APK.

The owner has a DEXA + RMR test booked. Every resting rate the app used was **predicted** — Cunningham
when lean mass is known, Mifflin-St Jeor otherwise — and there was nowhere to put a measured one.
The entry is explicit that this gets built *before* the appointment, so the numbers have somewhere to
go on the day rather than afterwards.

## The decision the entry left open: how a measurement ages

A measurement cannot be trusted forever — an RMR measured at 71 kg is not the RMR at 78 kg, and a
stale number silently outranking a live estimate is worse than having no measurement. The entry named
two candidates: *a validity window, or re-scaling by lean mass.*

**Re-scaling, and the reason is not preference.** A validity window fails at both ends: full trust the
day before expiry, total discard the day after — while the thing that actually invalidates the
measurement is a change in body composition, which has no fixed relationship to elapsed time. Someone
weight-stable for two years has a better measurement than someone who gained 8 kg in three months.

Cunningham is **linear in fat-free mass** (`ffm·21.6 + 370`), so a measurement carries exactly one
thing the prediction does not: **this person's residual from it.** Keep the residual, re-apply it at
today's fat-free mass. The measurement then ages by how much the body changed rather than by the
calendar, degrades smoothly instead of falling off a cliff, and a second test simply supplies a
better residual. That is `personalRmr` in `packages/shared/src/health/body-composition.ts`, beside
`cunninghamBmr` — one place, because **two** call sites compute a resting rate today
(`goal-recommendation.ts` and `energy-balance-service.ts`).

Without a fat-free mass from the test there is no residual, so the raw measurement is returned
unchanged. That is honest about what was measured; re-scaling it anyway would invent precision.

## Its own table, not a column on `body_metrics`

`body_metrics` is one row per calendar day of ordinary readings. A clinical measurement is a
different kind of thing — a handful of events, each with a provider and a method — and the entry is
explicit that **a second test must sit beside the first**, because two measurements at different body
compositions are how you learn whether the first still describes this person. A column on a daily
table is overwritten by the next day's upsert and has nowhere to record who measured it. `UNIQUE
(user_id, measured_on)` makes "beside, not over" true at the schema level: same date corrects a typo,
a later date is a new row.

## Verified

- **13 new tests, all green.** Eight pin the ageing rule — that the measurement reproduces exactly at
  the FFM it was taken at, carries its residual up *and* down by Cunningham's slope, returns the raw
  value when either FFM is unknown, and refuses junk rather than propagating it. Five are DB-backed:
  storage round-trip, a second test sitting beside the first, same-date correction, user scoping, and
  **the entry's actual bar — that `calculateBaseline` returns a different calorie target with the
  measurement than without.** Storing it and not moving the goal would have been the failure mode.
- **Full suite 602 files / 4,921 tests green** — exactly +13. `tsc --noEmit` clean ·
  `pnpm check:rules` **Ran 59 of 59**.
- Both migrations applied to the local DB and the views regenerated **after** it, since the generator
  reads the live schema rather than `schema.ts` — the first run produced 85 views without the new
  table for exactly that reason.

## Three gates caught things a review would have had to

Worth recording because each is a rule that fired rather than prose that was remembered:
`check-export-coverage` refused a new table classified in neither EXPORTED nor EXCLUDED;
`check-strict-request-schemas` refused the route's Zod schema without `.strict()`;
`check-dead-repo-methods` — the guard shipped yesterday — refused `getLatestMeasuredRmr` while it
had no caller, which is what made the wiring into `goal-recommendation` part of *this* PR instead of
a follow-up nobody files.

## Two stale details in the entry, corrected

`HEALTH_SOURCES`' warning that the TS ladder and "the inlined SQL `CASE` at line 45" must move
together is **already fixed** — `RANK_WHENS` is generated from `SOURCE_RANK`, so they cannot drift.
And a measured RMR does not join that ladder at all: it is its own table, not a `body_metrics` column
merge.

## What is NOT done — BF-33 stays in the queue

- **No way to enter it yet.** The API route exists (`POST /api/measured-rmr`) and nothing calls it.
  The typed-number field and the AI results-sheet photo path are scope item 3; the 2×2 panel is item
  4 and is Lane B's.
- **The AI path's constraint, so it is not lost:** `generateObject` with a schema, never
  `JSON.parse` of model text, and **no parsed number shown as fact until the owner confirms it** —
  a model handed a score of 80 once called it *"perfect"*.
- **No version bump and no changelog entry**: nothing user-visible ships until there is an input.

## Not exercised

Neither migration has run against production — that happens on the Railway deploy; both are additive
(a new table, a view rebuild) with no data loss. Nothing native, offline-first, safe-area or
gesture-related, so **no device smoke run is owed**.

<a id="2026-08-26-one-food-list"></a>

# 2026-08-26 — One food list: My Meals and the food library merge (Q-395c)

**PR:** `feat/one-food-list` · **v1.382.0** · **Lane B**

## What shipped

The owner's question was *"So im picking up a discrepancy between My Meals and My foods? Whats the
difference"*, and there wasn't one a user could hold: `My Meals` listed `saved_meals`, the library
listed `food_items`, and which list a thing was in came down to how it had been added.

They are **one list called My Foods** now, newest-first across both sources.
`components/nutrition/food-list.tsx` (new) is one list over **two sources**, not one shape over a
merged type — a food row opens the assign step, a meal row opens its own screen.
`food-library-sheet.tsx` is deleted, its search and local-first seed folded in. `/nutrition`'s button
opens the logger onto the list; `capture-step.tsx`'s `History` and `Saved Meals` tiles became one
`My Foods` tile. The rename swept 8 files — nothing user-facing says *Saved Meals* or *My Meals*.

## Two constraints, both measured rather than assumed

**MRU is unavailable.** `food_logs` carries no `saved_meal_id`, so a saved meal has **no last-used
timestamp at all**. `createdAt DESC` is the only recency signal the two sources share; it still keeps
a newly-saved meal off the bottom. True MRU needs a column that does not exist — Lane A's to add.

**The list had to live in the logger**, because a food's tap needs the assign step and that step is
`FoodLoggerSheet`'s. `handleLibrarySelect` closes the list first — without that the assign step
renders *behind* the list sheet. `saved-meals-sheet.tsx` was 753 lines against the hard 800-line
ceiling, so the list was extracted rather than appended; it is 696 now.

## The bug this uncovered: back-dismiss was wrong at three layers (LB-17)

Log Food → My Foods → a meal is the app's first three-deep nest, and one back press closed **two**
layers. `useSheetBackDismiss` decided "my entry is gone" by comparing the arriving state's `sheetId`
against its own, so every sheet that was not the one we landed on closed itself. At two layers that
is right by accident — back from the top lands on the only other sheet's entry, with nothing under it
to be wrong about. At three, it lands on the **middle** sheet's entry and the **bottom** sheet reads
a foreign id and closes, taking the middle one with it because it renders inside it.

"Gone" has to be a **depth**, not an id mismatch: each entry now carries the depth it was pushed at,
and a sheet closes only when it arrives at something shallower than itself. The page is depth 0, so a
lone sheet still closes on back.

Found by instrumenting `pushState`/`back`/`popstate` in the browser, not by reading — the Playwright
symptom was `element was detached from the DOM` on a button just asserted visible, which reads as an
animation-timing problem and is not one.

**Regression test:** `back-dismiss-sweep.spec.ts` — *back unwinds a three-layer nest one press at a
time*, asserting press-by-press on what is on screen. It cannot count dialogs: Radix aria-hides every
covered layer, so `getByRole('dialog')` sees one whatever the depth is, and a collapse looks
identical to a correct unwind. Verified by reverting the fix: the new test fails, the rest pass.

## Not exercised

- **No device run.** Pure UI on the canonical runtime, and the nest is a **new three-layer unwind on
  the real back gesture** — the sandbox models that and does not prove it.
- Safe-area insets render as 0 here; the nest's unwind was never watched against a gesture bar.
- Samsung's WebView compositor has not been shown one scroller interleaving meal rows carrying
  data-URI tiles with plain food rows.

## Files

`food-list.tsx` (new) · `saved-meals-sheet.tsx` (753 → 696) · `food-library-sheet.tsx` (deleted) ·
`food-logger-sheet.tsx` · `capture-step.tsx` · `nutrition-content.tsx` ·
`lib/hooks/use-sheet-back-dismiss.ts` · the rename across `nutrition-action-row.tsx`,
`meal-plan-edit-sheet.tsx`, `meal-plan-section.tsx`, `plan-meal-row.tsx`, `my-meals-picker.tsx`,
`use-plan-meal-saving.ts`.

<a id="2026-08-26-persist-activity-contributors"></a>

# 2026-08-26 — The Activity score stores its own breakdown (Q-526)

**Lane A · branch `fix/persist-activity-contributors`**

## What was wrong

`oura_daily_derived.activity_contributors` held `{base, adjustment, trained}` — the *blend wrapper*
that folds an Oura Cloud activity score into ours — and not one of the six component sub-scores
`computeActivityScore` produces. The components were already in memory on the same request; the route
even serves them to the client as `activityContributors`. They were simply never written.

Activity was the only score with the gap. Sleep stores 10 real sub-scores, readiness stores its
contributors (and since Q-501, each contributor's own input), illness stores all four biomarker
z-scores on every scored row.

**The cost is a measurement that cannot be made afterwards.** Rebuilding a past day's contributors
means recomputing from raw inputs at *today's* goals — and `strengthFreqGoal` went 3 → 5 and the
volume target changed basis on 2026-08-11. So *"what did `strengthFreq` score on 2026-08-02?"* has no
answer, and the 2026-08-19 contributor audit had to report a *predicted* sd ceiling instead of the
real historical spread.

## Premise re-verified, and it got sharper

Measured against production before building:

| | |
|---|---|
| derived rows | 100 |
| rows with an activity score | **30** (the entry said 23) |
| rows carrying any component key | **0** |
| rows where `adjustment` is 0 | **30 of 30** |
| rows where `base` equals `activity_score` | **30 of 30** |

So the column was not merely storing the wrong thing — **it was storing the score twice and a
constant zero.** The blend only ever adjusts an Oura *Cloud* activity score, and no such row has
existed since the BLE re-key (the 30 rows span 2026-07-28 → 08-26, all post-re-key). The entry's
caveat that the wrapper "is real information — it is how a Cloud-era adjustment is distinguished from
our own base" is right in principle and describes no row that exists.

The wrapper is kept anyway: the entry asks for a merge rather than a replacement, `trained` is the one
bit the components cannot re-derive, and keeping it costs nothing.

## What shipped

One object at the existing persist site in `lib/health/readiness-payload.ts`:

- the six component sub-scores, spread in — **absent contributors stay absent**, because weights
  renormalise over whichever lanes ran and a stored zero would read as "scored nothing";
- **`preTaper`** — what the components reproduce under the model's weights;
- **`acwr`** — the over-exertion taper's only input;
- `base` / `adjustment` / `trained`, unchanged.

`preTaper` and `acwr` are what turn an itemisation into a re-derivation: the components reproduce
`preTaper`, and `score = round(preTaper × (1 − taper(acwr)))` closes the loop from the row alone.

**No score moves** and there is no migration — the column is JSONB and the write already existed.

## Verification

`pnpm check:rules` **Ran 59 of 59**; `tsc --noEmit` clean; full suite green.

Six mutations, each with an asserted anchor. **One survived the first pass**: dropping `acwr` changed
nothing, because every fixture had a null ACWR — the route only resolves it for a program older than
28 days, and the harness returned no program. That is precisely the untested half, since the taper is
the only thing standing between `preTaper` and the stored score, and it bites on the overreaching days
most worth auditing later. A fixture with a light month, a heavy last week and a 60-day-old program
pushes ACWR past the threshold; the mutation dies there.

**Not exercised:** nothing on-device (this is a server write path), and the pre-2026-08-26 rows, which
are addressed below rather than fixed.

## What this does not do

**It is forward-only.** Every row before today still holds `{base, adjustment, trained}`, and those
days cannot be recovered — that is the same loss the entry describes, now bounded rather than
growing. Q-505 (the Activity redesign) carried a `⛔ Do Q-526 FIRST` constraint so the old model's
contributor history would exist for a before/after comparison; that constraint is satisfied **from
today**, and the comparison window starts here. Which inverts its urgency: the longer Q-505 waits, the
better that window gets.

<a id="2026-08-26-readiness-contributor-inputs"></a>

# 2026-08-26 — Readiness contributors record the input they were scored from (Q-501)

**Lane A · branch `fix/readiness-contributor-inputs` · v1.383.6**

## What was wrong

A persisted readiness contributor was `{score, provisional}` and nothing else. So the only way to ask
"what produced this 58?" was to read today's `oura_daily_summary` and assume it had not been
recomputed since — and it often had. Summaries get re-rolled and the derived rows built from them are
not recomputed in step, so the admin day-review paired a **stored** score with **today's** raw inputs
and called them "the inputs that produced it". On a drifted day that pairing is simply false, and
nothing on the panel said which of the two had moved.

That mattered beyond the panel: a stored score disagreeing with a fresh recompute has two causes
needing opposite responses — the inputs were rewritten (a data question) or the model moved (a
calibration question) — and neither was distinguishable from the row.

## Premise re-measured first, and it was wrong

The entry claimed **5 of 33** stored recovery-index contributors disagreed with the summary they
derive from. Measured against production before building anything:

| population | n |
|---|---|
| derived rows | 100 |
| carrying a `recoveryIndex` contributor | **42** |
| match the current anchor (5 h) | 9 |
| match the previous anchor (6 h) | **27** |
| match neither — genuinely un-re-derivable | **7** |

So the original figure conflated *an older model* with *genuine drift*. 27 of the "disagreements" are
a previous anchor doing exactly what Q-273's version stamp exists to record. The un-re-derivable
population is **7**, and those are the rows no model applied to the stored hours reproduces.

## What shipped

The entry's own "First action" offered two options — recompute derived rows with their summary, or
store the inputs they actually used. The second was taken: it is cheaper, self-describing, and does
not silently re-score history.

- `ReadinessContributor` gains `input: number | null` — the number the score was computed **from**: a
  z-score for the four baseline-relative terms, a 0-100 value for the pass-throughs, raw hours for the
  Recovery Index. It is `null` when the contributor fell back to neutral, **including when a z existed
  but the baseline was cold** — recording the z there would make the row look re-derivable when the
  score was never a function of it.
- `rederiveReadinessFromStored(stored)` asks a persisted row whether its own score follows from its
  own inputs, returning the drifted contributors, the ones with no stored input, and the composite the
  current model gives for those inputs.
- The readiness audit uses it to emit one of three notes — **MODEL moved**, **INPUT change**, or
  *these contributors carry no inputs and cannot be checked*. The admin panel already renders
  `notes`, so this surfaces with no UI change.

**No score moves.** `input` sits beside the score and never participates in it. The four existing
shape assertions that broke were `toEqual` checks whose diff showed one added key and an unchanged
`score` — which is itself the proof.

**No migration.** `readiness_contributors` is JSONB on Postgres and TEXT JSON in the local store; the
field rides in the object that was already being persisted.

## Verification

- Full suite green; `pnpm check:rules` **Ran 59 of 59**; `tsc --noEmit` clean; lint clean.
- **Nine mutations, each with an asserted anchor**, all caught after two rounds. Two survived the
  first pass and both were real coverage gaps, now closed:
  - a pass-through storing `Math.round(input)` — re-derives to the same score, so nothing noticed,
    while reporting an input the day never had. Pinned with a fractional input.
  - the "INPUT change" note firing alongside "MODEL moved" — two contradictory verdicts, which leaves
    the reader exactly where this finding found them. Pinned by asserting their exclusivity.

## Not exercised

Samsung WebView rendering of the new notes (they are plain text in an existing list), and the
production backfill described below.

## What is still owed

The ~100 rows written before this shipped carry no inputs and can never be checked retroactively. The
audit names them `uncheckable` rather than passing them silently — the honest reading, not a fix.
Refreshing them means running `POST /api/admin/backfill-derived-scores` against production, which
**rewrites stored scores**: an owner call, not code work. Q-501 stays in the queue carrying only that.

<a id="2026-08-26-saved-meal-duplicate-detection"></a>

# 2026-08-26 — A meal you already have, asked about rather than added again

**Branch:** `feat/saved-meal-duplicate-detection` · **Entry:** BF-11d · Implementation Lane B

A recipe link is easy to paste twice. BF-11c made that cheap enough to do by accident, and a
multi-dish page pasted twice adds every dish again in one press. Both save paths now check first.

## What "close" means, and why it is two tests

`fitDistance` (`packages/shared/src/nutrition/meal-macro-fit.ts`) is reused rather than a new
threshold invented: it already reduces a macro comparison to one relative number, and its own doc
says it exists *"so two candidate versions of the same meal can be compared without a second opinion
about what 'better' means"*. That is this question.

**But macros alone match every protein shake against every other one**, so a normalised name match is
required alongside — and both must pass. `DUPLICATE_MAX_FIT_DISTANCE` is 0.15, an average of 5% per
macro: inside the rounding noise a re-import produces, well outside a different meal of similar size.

**The name test is equality after normalisation, not fuzzy.** BF-38 measured 19 redundant
`food_items` rows and its guidance is explicit — *prefer under-merging*, because collapsing *Greek
Yogurt Plain* into *Greek Yogurt Vanilla* silently corrupts the macros of every past log. The
asymmetry decides it: under-matching costs a duplicate the owner can delete, over-matching offers to
overwrite the wrong meal.

## Two save paths, two ways of asking

BF-11c added the second one, and the entry carried a warning about it into this session.

- **The builder's Save** gets the prompt the plan describes: *"You already have X"* → **Update it** /
  **Save as new**. Save as new is one tap and is the safe answer, so the dangerous one takes a
  deliberate press. It runs on save, never per keystroke, and never again on the way through its own
  answer.
- **The multi-dish picker** does not get four dialogs for four dishes — that is nagging, not asking.
  The ask is the tick already there: duplicates start **unticked** and say *already in your meals*,
  and one tap keeps a copy anyway. The choice is presented before the action, in the UI that exists
  for choosing.

**Update keeps the existing id.** `meal_plan_meals.saved_meal_id` references it, and so does a
printed QR label that may already be stuck on a container — a new id orphans the label.

## The builder hit its ceiling four times in two entries

`saved-meals-sheet.tsx` crossed 800 lines on nearly every step of BF-11c and BF-11d. Four children
came out of it: `meal-batch-size.tsx`, `meal-builder-footer.tsx`, `meal-builder-header.tsx`, and
`save-meal.ts`. That is the size rule working rather than failing — a hotspot absorbs new features
into children instead of growing. The file ends at **784**.

**Nibbling did not work and the log shows it**: three of those extractions were chosen to reclaim
ten or twenty lines and the file went straight back over. What finally held was moving the whole
save *write* out — logic rather than markup, so it travelled without threading a single prop.

**`DuplicateMealPrompt` is deliberately NOT memoised**, unlike its siblings there. They sit above an
ingredient list and re-render on every keystroke; this one is mounted only while the question is on
screen. `check-memo-prop-stability.js` flagged an inline arrow into it, which was the right prompt to
ask whether the `memo()` was earning anything. It was not.

## The Q-216 guard followed the code

`local-store-write-fallback.test.ts` scans source text for the offline-first fallback shape, and it
named `saved-meals-sheet.tsx`. Moving the write broke three of its assertions.

**It was re-pointed, not relaxed.** The invariant is that a local write which throws must reach the
server rather than an error toast — and it now has two legal shapes: a `savedLocally` flag consulted
after the try, or an early return from the successful local path with the API call at top level.
`save-meal.ts` takes the second because it is a function with a return value rather than a handler
mutating component state. The test states both, and gained an assertion neither had: the API call
must never be the `else` of the store check, which is the exact arrangement Q-216 was about.

## Verification

- `npx tsc --noEmit` clean · lint clean on `components/nutrition`
- `pnpm check:rules` — **Ran 60 of 60**, all passed
- Unit suite — **5,215 passed / 57 skipped**, including 7 new tests on the matching rule
- `check-component-size` — nothing over 800 beyond the four recorded hotspots

### Failure surfaces NOT exercised

- **The S25.** A new inline prompt in the builder and a changed default tick state in the candidate
  list. `Gate: device`.
- **A real duplicate import.** The matching rule is tested directly, but no test pastes the same
  live recipe URL twice — the scan is a live AI call, so that path is only exercised on the phone.
- **The native local store.** `saveMealToLibrary`'s local branch is device-only; the web fallback is
  what ran here, and the Q-216 guard is a source-text check rather than an executed failure.

<a id="2026-08-26-shared-food-row-last-call-site"></a>

# 2026-08-26 — The shared food row's last call site, and the warning that had nowhere to go (Q-406)

**PR:** `docs/device-queue-all-gated` · **v1.383.5** · **Lane B** · **Gate: device**

## What was blocked

Three of `FoodRow`'s four call sites converted over the preceding days. The fourth — the external
food-database result in `ingredient-search.tsx` — stayed a bespoke `<button>`, blocked on a design
question rather than on effort.

The decided treatment (option A) was an amber icon before the calorie column, with the explanatory
sentence moved **to the food's detail**. That destination does not exist here: tapping the row runs
`addExternalFood` → `createFoodItem` + `accept()`, which adds the food outright with no inspect step
in between. Building A would have deleted the only visible explanation on a warning whose whole
purpose is to be read *before* use.

## The owner's answer, and what it costs

Asked between three ways forward, the owner chose **keep the sentence in the row**. It is what
already shipped, so there is no regression, and option B's losing reason — that it *replaced* the
serving line — does not apply to keeping it *alongside*.

**That knowingly overrides one bullet of the old design, and it is worth saying so plainly.** The
design said *"do not add a warning slot to `FoodRow`"*, written on the assumption the sentence was
leaving the row. It is not. So a slot is what keeping it costs: **one optional
`warning?: string | null`**, which three call sites omit exactly as they omit the six other optional
props already on that component. The alternative was leaving the fourth row bespoke forever, which
is the thing this entry existed to end.

## What the conversion dropped, and why nothing was lost

The bespoke row had a trailing `+` and a per-row spinner. Both are gone. `SearchResultRow`, sitting
directly above it and drawing `FoodRow` since v1.338.0, has had neither: **the tap adds the food**,
and an add affordance on top of that is precisely the per-screen difference converting these rows
exists to remove. The tapped row still identifies itself, through the `highlighted` prop that
already existed.

That check mattered — this entry's own history includes a conversion that had to wait until a delete
had been moved somewhere else first, so that no capability was dropped.

## Also

- **A hex literal went with it** — `#f59e0b` became `var(--accent-amber)`, so
  `check-hex-literals.js` drops that file's baseline row. 427 across 85 files now.
- **The row had no e2e cover at all**, which is why it survived bespoke: its search reaches Open
  Food Facts, so a live test would be non-deterministic and offline-fragile.
  `e2e/food-row-shared.spec.ts` now **stubs the route** and asserts the shared shape (calories in
  their own column), the sentence, and that the macros stay readable beside it.

## Not exercised

- **The S25.** The amber caution line is new markup inside a list, and the row lost an affordance.
  Carried as `Gate: device` and written into the device queue as N7: search the food database for a
  product whose macros disagree, confirm the sentence renders, and confirm a tap still adds.
- Real Open Food Facts responses — the spec stubs them by design, so the *presentation* is covered
  and the *matching* is not.

<a id="2026-08-26-sibling-sheet-back-dismiss"></a>

# 2026-08-26 — The dialog that closed on the frame it opened (BF-34)

**PR:** `feat/capture-one-screen` · **Lane B** · **Gate: device**

## What the owner saw

*"the delete feature doesnt work. so its not removing from my.UI"*, then the detail that decided it:
*"when I press the delete button; it opens up the confirm dialog; but then instantly minimizes so we
cant click it."* Opens and is then dismissed — not the `pointer-events: none` variant, where it would
sit there ignoring taps.

## The cause, and why it was app-wide

The diary's quantity sheet closes itself and opens the confirm dialog **in the same tick**
(`quick-edit-log-sheet.tsx:140`). React runs the unmounting cleanup before the mounting effect, so
the sheet's `history.back()` is already in flight when the dialog mounts. The dialog then receives a
pop carrying a state that is not its own — indistinguishable from a real back gesture — and closes
itself.

The flag that marks *"this pop is one of ours"* was **per-instance**. That is exactly why the dialog
could not see it: a sheet closing and a dialog opening are different hook instances. Since BF-27 put
`BackDismiss` inside every `SheetContent` and `DialogContent`, every close-one-open-another
transition in the app ran this sequence; the diary delete is only the first one pressed.

It is a **module-level counter** now, consumed by whichever surface receives the pop, which then
re-pushes the entry the surface still open needs. One listener owns the stack rather than one per
instance — and keeping it attached for the life of the page is what stops the counter leaking, since
our pop is consumed even when it arrives with nothing open. Before, a stale flag made the next sheet
skip its push and left it with no entry at all.

## Two corrections to the entry's own analysis

**The prescribed fix had an ordering trap.** "Share the flag across instances" is right, but `absorb`
— the listener that clears it — is registered by the *closing* sheet, so it runs **before** the
newly-mounted dialog's handler and would clear a shared boolean too early. Consuming it reliably
needs one listener that always exists, which is what turned a one-word change into a small rewrite.

**LB-17 (v1.382.0) did not fix this**, though it changed the same line hours earlier. That was the
*nested* case — a back landing on the middle sheet's entry, closing the bottom one too. This is the
*sibling* case. Different failures through one guard; the fix keeps both mechanisms, depth and
counter.

## Why the logic moved to its own file

`lib/hooks/sheet-back-stack.ts` now holds the decision — when to close, when a pop is ours, how deep
a surface sits — and `use-sheet-back-dismiss.ts` is React wiring and nothing else. All three failures
this primitive has carried (LB-10, LB-17, BF-34) were in *when to close*, and every one was found on
a device or in an e2e run because while the logic sat inside an effect there was nothing smaller to
aim at.

Seven tests drive the sequences directly, with an injected fake history that models `back()` as the
async traversal it is. **Reverting to the per-instance flag fails both sibling tests and the
StrictMode one** while the nested tests keep passing — which is the check BF-34 asked for, that a fix
does not trade one case for the other.

## What I got wrong on the way, since it will be tried again

I claimed a web reproduction and did not have one. The sibling sequence **cannot be staged through
the web UI**: the bin that triggers it is not actionable in Chromium at all — `locator.tap()` times
out on it. A raw coordinate tap "worked" only in the sense that it landed on the overlay, closed the
sheet, and never called `onDelete`, so the dialog never mounted. That reads exactly like the bug and
is not it. A `MutationObserver` installed before the tap is what settled it: one transition, the
sheet closing, and no dialog mount to close.

## Not exercised

- **The S25.** Verified against the state machine and the nested/StrictMode e2e specs, never on
  device. The device press: tap a diary row, tap the bin, the confirm dialog must **stay** open and
  be tappable, and Cancel must cancel. Then the LB-17 nest (Log Food → My Foods → a meal) must still
  unwind one layer per press.
- Samsung's WebView popstate timing, which is where BF-27's gate always pointed.

## Files

`lib/hooks/sheet-back-stack.ts` (new) · `lib/hooks/use-sheet-back-dismiss.ts` (now wiring only) ·
`lib/hooks/__tests__/sheet-back-stack.test.ts` (new, 7 tests).

<a id="2026-08-27-coach-multi-select"></a>

# 2026-08-27 — "Select all", and the six lists the Coach was paying to retype (Q-407)

**Lane A + B · branch `feat/coach-multi-select-options`**

The owner, on the meal-plan wizard: *"there should be options for 'select all' as I keep clicking
each grocery store."* Q-407 diagnosed it precisely and the diagnosis held on re-reading:
`ChoiceListSchema` had `prompt`, `source`, `sourceId`, `options[]` and **no multi flag**, and
`ChoiceList`'s callback was `onChoose?: (option) => void` — one option, singular. There was no
configuration that produced a multi-select; the widget had never had one.

## What shipped

- **`multi` and `selectAll` on `ChoiceListSchema`** — flat optional booleans, not a discriminated
  union of single/multi variants. The schema's own comment says why: *"Gemini's function-declaration
  schema is fussy about unions, and this feature has already lost a day to one."* Both absent by
  default, so every existing call site parses byte-identically.
- **`ChoiceList` gained checkbox rows**, a Select-all row carrying `n of m`, and a Continue button.
  Select-all sits **above** the scroll region — with more rows than fit, a control you have to
  scroll to find is one you will not find, and saving taps is its entire purpose. Continue sits
  **below** it, always reachable however long the list is, disabled rather than hidden at zero picked
  so the rows do not jump under a finger on the first tap.
- **One callback for both modes**, taking an array. A second `onChooseMany` would have made every
  call site handle two shapes for one question.
- **`WidgetResultSchema`'s `chose` carries `ids`** alongside the existing `id`, both optional under a
  refine. `id` staying required and holding the first of five is the kind of quiet lie that is true
  until someone reads it.
- **Six new choice sources** — `grocery_stores`, `proteins`, `carbs`, `fats`, `vegetables`,
  `dietary_restrictions` — served from `/api/coach/options`. The five staple lists moved out of
  `meal-plan-setup-sheet.tsx` into `@trainingai/shared/nutrition/grocery-catalogue`, one copy read by
  both. This is the measured half: a nine-option picker the model typed out cost **~554 output
  tokens**, and output tokens are essentially all of Coach's latency.

## The catch, which only appeared once the branches were placed

`/api/coach/options` opens with `const program = await repo.getActiveProgram(userId); if (!program)
return { options: [] }`. That is right for `sessions`, `exercises` and `swap_candidates` — they *are*
the program. Put the catalogue branches below it and **a grocery picker comes back empty for anyone
without a training program**: a nutrition question failing on a training precondition, for exactly
the new user most likely to be asking it.

The catalogue branches sit above the gate, and a test asserts `getActiveProgram` is never even
called for them — asserting the returned list alone would still pass if the gate ran first and
happened not to fire.

## The dead branch a mutation found

`joinChoiceLabels` — extracted to a `.ts` because both vitest projects are `environment: 'node'` and
cannot parse JSX, so a join living in `widget-registry.tsx` could not be asserted at all — was
written with a `length === 2` special case. A mutation deleting that line **passed**, which is what
said it was dead rather than defensive: `slice(0, -1)` on two labels is one label and joins to
itself, so the general line already produces *"Coles and Aldi"*. Removed, with the reasoning kept
above it.

Ten mutations in total, each with an asserted anchor. One anchor missed and reported as a miss rather
than a pass — which is the guard working; it was redone by locating the line rather than
string-matching through a shell.

## Verification

Full suite green. `tsc` and lint clean. Route and schema behaviour covered by 26 tests across
`coach-options-catalogues`, `widgets` and `choice-label`.

**Not exercised: the widget rendering.** JSX cannot be unit-rendered here, and the widget only draws
inside a live Coach conversation, so the checkbox rows, the Select-all row and the Continue button
have not been seen. The logic behind them is asserted; the pixels are not. That wants the S25 pass
Q-407 will need anyway.

## Deliberately not done

**The conversation.** Q-407's larger half — the seven-step sheet becoming at most three exchanges,
the plan arriving as a widget rather than prose, and the nutrition scope as a *named record* of
prompt section + tool subset + patch domains + widget sources — is untouched. What shipped is the
widget that half needs and could not have been built without. The entry keeps it.

<a id="2026-08-27-day-review-one-door"></a>

# 2026-08-27 — `feat/day-review-one-door` (Q-112a) — one evening flow, one door

**Lane B · v1.393.0 · one entry shipped (Q-112a), two filed (LB-23, LB-24).** Every file is
`app/**`, `components/**` or `lib/**` outside storage — Lane B throughout, no engine half.

The day review had two entrances. Home's "Your day in review is ready" banner opened
`components/day-review-sheet.tsx`, a thinner sheet that only Home had; Nutrition's End of Day button
opened `EndOfDayReview`, the real one. **Both local reminders' `extra.route` was `'/'`** — tapping
either notification put you on Home and left you to notice a banner.

Everything now reaches `/nutrition?review=day`, and the weekly one reaches `/?review=week`.

## The plan hosted the review on Home, and that was wrong

§4 of [`2026-08-25-unified-day-review.md`](../superpowers/plans/2026-08-25-unified-day-review.md)
says the reminders deep-link to `/?review=day` and *"Home opens the matching surface from the query
param"*. Reading `EndOfDayReview`'s props settles it against the plan: it needs `mealTypes`, the
day's `logs`, `targets` and an `onLogged` callback — all Nutrition's state, none of it Home's.
Hosting it on Home meant duplicating three fetches onto a screen that has none of them, to render a
component Nutrition already renders correctly.

**So the door moved instead of the review.** Home's banner navigates (`navigateToTab(router,
"/nutrition?review=day")`) and the evening reminder points at the same URL. The weekly recap *does*
live on Home, so `/?review=week` stays — `WeeklyRecapBanner` gained a `forceOpen` prop that opens it
expanded.

`forceOpen` deliberately overrides `dismissed`: tapping the notification is a clearer request to see
the recap than an earlier dismissal was a request never to. It cannot override `error` or an empty
recap, because there would be nothing to show.

## The digest came across with the error state it never had

`day-review-sheet.tsx` was the only consumer of `/api/daily-digest`, and its fetch had a
`.finally()` and **no `.catch()`** — a rejected request left `digest` null and the card silently
absent, which is Q-499's class exactly. `day-digest-card.tsx` adds the `.catch()`, treats `!res.ok`
as a failure rather than a null digest, and renders *"Couldn't write today's summary."* instead of
vanishing.

It is placed **above** `DaySummaryCard` — the narrative opener sits above the numbers it is talking
about, and Q-112b puts the read-through in that same position, so it is where that entry wants it
rather than somewhere b would have to move it from.

## The older deep link still works, and that is the point of the third test

Notifications already scheduled on the phone carry the old params. Changing
`lib/day-review-reminders.ts` only affects notifications written from here on, so
`nutrition-content.tsx` accepts `?review=day` **and** the pre-existing `?chat=backfill` from
`lib/meal-reminders.ts`. Dropping the latter would have stranded every pending meal reminder.

`chatOpen` → `reviewOpen` while there: it opened the review, not a chat, and the name was a leftover
that would have misled the next reader.

## Two tests, because the failure modes are different

`lib/__tests__/reminder-deep-links.test.ts` (7 tests) is a **cross-file agreement** check: for each
of the three routes it asserts the scheduler writes it *and* that the screen named as its reader
parses that exact param, plus that no scheduler still writes a bare `route: '/'`. This is the class
a unit test cannot catch — both halves are individually correct and disagree with each other, and
the only symptom is a notification that opens the wrong screen on a phone.

`e2e/day-review-one-door.spec.ts` (4 tests) drives the URLs. One is the inverse: `/nutrition` with
no param must open no dialog, because a param check that matched anything would open the review on
every visit. The fourth is the tab-shell case below.

**The spec matches on `getByRole('dialog')`, not the heading.** The review carries two nodes reading
"End of Day" — Radix's `sr-only` `SheetTitle` and the visible `<h2>` — so a heading query is a
strict-mode violation. That duplication is real and is filed as **LB-23** (three sheets do it;
`quick-edit-log-sheet.tsx` is the one that does not), not fixed here.

## The deep link crosses a shell that does not use the router, and `forceOpen` had a hole

Two things about `/?review=week` needed checking rather than assuming, and one of them was a bug.

**Does the param survive the tab shell?** Home's banner calls `navigateToTab`, which the tab shell
intercepts: it flips the tab and writes the URL with `window.history.replaceState`
(`tab-shell.tsx:78`) — the raw History API, not the Next router. That is normally invisible to
`useSearchParams()`. It works because **Next 15 patches `replaceState`** to reflect external history
changes in the router (`next/dist/client/components/app-router.js`, *"Patch replaceState to ensure
external changes to the history are reflected in the Next.js Router"*). Read in the source, then
driven: the fourth E2E test replaces the URL on an already-mounted Nutrition tab and the review
opens. Every other spec for this shape uses `page.goto`, a full document load, which cannot tell a
working patch from a broken one.

**Writing that test found the trap it now documents.** The first draft drove Health's `?tab=body`
instead — same mechanism, not hour-gated, and it passed. Then renaming the `searchParams.get` inside
Health's effect **left it passing**, because Health also reads the param in a `useState` lazy
initializer and that was quietly doing the work. The tab shell keeps a tab mounted once activated, so
the initializer is exactly what does *not* re-run on the second visit — and Nutrition's review has no
initializer at all. Aimed at the real feature, the discriminating mutation lands: changing the effect
deps from `[searchParams]` to `[]` fails that one test and leaves the other three green.

**`forceOpen` only reached `expanded` through a `useState` initializer, which never re-runs.** Home
is statically imported and the tab shell never unmounts it, so a notification tapped while the app is
open re-renders `WeeklyRecapBanner` with `forceOpen` true against an `expanded` that was initialised
false — the banner would have appeared **collapsed**, which is the state the user already had before
tapping. The effect sets it now. The `dismissed` half was already correct, because it lives in that
effect and `forceOpen` is in its deps; it is the half that goes through `useState` that failed, which
is the same shape as Q-402 one layer up.

There is no React Testing Library in this repo, so that fix is guarded by the comment beside it
rather than by a test.

## Deleting the sheet orphaned three things, and only one of them is wrong to keep

`day-review-sheet.tsx` also drew an HR day chart and a workout-load comparison chart.

- `HrDayChart` has three surviving renderers (`/health/heart-rate`, `home-card-widget.tsx`,
  `hr-day-card.tsx`), so that deletion cost no surface.
- `workout-load-comparison-chart.tsx` now has **zero** call sites, and `/api/workout-load-history`
  **zero** client callers. `invalidateWorkoutSummaries()` still prefix-clears
  `workout-load-history:`, now inert.

Kept rather than swept, and filed as **LB-24**: Q-112c's plan names `/api/workout-load-history` as
one of the series it reuses for the 7-day window, so deleting it now is work Q-112c would undo. The
entry sets the decision point — if Q-112d has not re-homed the chart, delete all three together.

## Paying for the two lines

`session-select-content.tsx` sits on a 1458-line ratchet and the change landed at 1460 — despite
*removing* a feature, because two explanatory comments cost more than the dynamic import, the
`useState` and the render they replaced. Both comments were compressed rather than the baseline
raised: the reasoning lives here and in the spec header, and raising a hotspot's number while
deleting one of its features would have been the wrong record.

## Not exercised

- **Not device-verified.** `extra.route` only does anything on Android — `scheduleEveningReminder`
  returns early off `Capacitor.isNativePlatform()`, so the sandbox cannot reach the line that
  changed. Whether the tap lands on `/nutrition?review=day` is unverified on the phone.
- `WeeklyRecapBanner`'s `forceOpen` path was not driven in Playwright: rendering it needs a
  `/api/weekly-digest` response, which is an AI call. Nor was **Home's day-review banner**, which
  only renders after 17:00 local (`session-select-content.tsx:354`) — a spec written now would
  pass this evening and fail every morning, which is the hour-dependence class `CLAUDE.md`
  warns about. The mechanism under both is covered indirectly by the shipped `/health?tab=body`
  tile, which takes the identical `navigateToTab` → `replaceState` → `useSearchParams` path.
- Safe-area: no anchored control moved. The review's footer is unchanged.
- **One local E2E failure, not this branch's.** `goal-invalidation.spec.ts` failed locally in both
  full runs — 94 passed, 1 failed — and it is the aged-fixture class `CLAUDE.md` documents. That
  spec's own header records the dependency: the seed inserts `body_metrics` for `current_date - d`,
  so **today** must carry a steps value or the row it asserts on never renders. `SELECT max(date)
  FROM body_metrics WHERE steps IS NOT NULL` returns **2026-08-25** against a `current_date` of
  2026-08-27, because the seed dates everything relative to the day it ran and nothing back-fills.
  CI provisions a fresh database per run, which is why it is green there. Nothing in this diff is
  reachable from that spec — it drives `/more` → goals → `/health?tab=progress`.

<a id="2026-08-27-day-review-read-through"></a>

# 2026-08-27 — `feat/day-review-read-through` (Q-112b) — the wrap-up shows the day it is wrapping up

**Lane B · v1.394.0 · one entry shipped (Q-112b), one filed (LB-25).** Every file is `app/**`,
`components/**` or `e2e/**` — no engine half.

The evening wrap-up asked how the day felt without ever showing the day. Q-112b puts the
read-through — training, activity, energy, sleep, heart rate, body — inside it as step 1, drawn by
**the same component `/health/day` draws**, off the same `day-log:<date>` cache key.

## One implementation, two hosts

`components/health/day-detail/day-read-through.tsx` is the section stack lifted out of
`day-detail-content.tsx` verbatim: same order, same charts, same empty case. `/health/day` renders
it now too, which is what makes "one implementation" a fact rather than an intention — a second copy
would look identical the day it was written and drift from the next section change onward.

**The extraction was cheap for a reason worth recording.** `DayEntryControls` was already
all-optional and already documented *"absent → the section renders read-only"* (LB-1). So the
wrap-up hosts the same markup without growing a second set of write paths, and without a prop
becoming optional for its benefit.

The fetch is deliberately **not** shared. `/health/day` guards each response against a swipe that has
already moved on; the wrap-up is one day and has no way to exercise that guard. Folding them into one
hook would have put a date-race in a component that cannot race.

## The three fetches are gated by the sheet being open, and that took a second component

`EndOfDayReview` is rendered unconditionally by `nutrition-content.tsx` — `open` only drives Radix —
so a `useCachedValue` in its body would have fired **on every Nutrition visit**, three requests, for
a sheet nobody opened. `SheetContent` does not `forceMount`, so a child of it mounts only while open:
`day-read-through-section.tsx` exists to sit on that side of the boundary. The first draft did not,
and that is the kind of regression that never shows up as a failing test.

`useCachedValue` rather than a hand-rolled seed-then-fetch, because this sheet lives in the
persistent tab shell and an empty-dep effect would hold its first payload until the app was killed
(Q-402).

## HR min/max is labelled as what it is, which is not min/max

The entry asked for "HR min/max — derived from the `data.hr` points `DayHrTrace` already receives".
Those points are **15-minute means**: `/api/day-log:271` buckets the per-minute series by average,
deliberately, so one spike cannot become a whole bucket. Averaging is exactly what removes extremes —
a three-minute resting dip to 48 surfaces as about 55, a workout peak of 175 as about 150.

So the pair reads **Low / High** with *"15-min averages"* beside it, rather than a number the payload
cannot support on a screen whose whole job is telling the user what their day was. The true extremes
exist as `oura_bucket.hr_min` / `hr_max` and are recorded in **LB-25** as nearly free if that route
change is ever taken.

## Three steps, and the skip rule lives in a tested function

`review-steps.ts` decides which steps exist. Only the meals step is conditional today, which makes
the module small; it exists anyway because the predicate is *"no meal type is empty"* — a negated
quantifier, the kind of expression that gets inverted in a refactor and reads plausibly either way.
Six tests pin it, including the two shapes a count-based check would get wrong: three logs all
against breakfast (two meals still empty), and a log against a meal type that has since been deleted.

`stepIndex` is **clamped, not trusted**: backfilling the last empty meal removes the step the user is
standing on. And it resets when the sheet closes — reopening on "How it felt" would skip the
read-through the flow exists to show, which is the persisted-transient-state class one level down
from the Zustand rule.

## Two naming collisions, both found by looking rather than by reading

**"Previous", not "Back".** The step-back control cannot say *Back*: the wrap-up step's sore-muscle
chips include one labelled **Back**, so two buttons on one screen would share an accessible name.
Playwright found it as a strict-mode violation; it is an accessibility defect first. Same class as
**LB-23**, from the other direction — there a control collides with itself, here with user-facing
content.

**"The day", not "Your day".** Screenshotting all three steps at 412 dp is what surfaced the second:
the step-1 title read *Your day* and the digest card **on that step** carries a *Your day* eyebrow.
Renaming it then failed the spec for a *third* reason worth writing down — `getByText` matches
substrings, and "The day" is inside the summary card's *"Totals are the day's figures…"* one line
below. The assertion is exact and includes the separator the header renders. A short English phrase
as a step title is ambiguous by default; only an exact match makes it a locator.

## What did not ship, and why it is a Lane A entry

**Body temperature.** The plan wanted it via Q-105's derived-first precedence. Checking that against
`main`:

- `oura_daily.temperature_deviation` is the frozen Cloud column the plan forbids.
- The live values, `oura_daily_summary.temp_mean_c` / `temp_dev_c`, are returned by **no route**.
  `app/api/ai/health-insight` reads `tempDevC` and puts it in a prompt — that is not a payload.
- They *are* in the local store, so a device-only local-first read would work and would be
  unverifiable in `pnpm dev` or Playwright, where `getLocalStore` returns null.

A field on `/api/day-log` is the honest fix and `app/api/**` is Lane A, so it is **LB-25** rather
than a local-first read taken quietly. The AI digest, the entry's third stat, shipped with Q-112a.

## Driven, not inspected

- Removing `<DayReadThroughSection>` fails `the wrap-up shows the day it is wrapping up` and leaves
  the other three green.
- `e2e/day-detail-sheets.spec.ts` + `e2e/day-entry-edit-delete.spec.ts` — **8 passed**, which is the
  plan's own gate on `/health/day` surviving the extraction unchanged.
- The stepping test presses Next until Save appears rather than a fixed number of times, because the
  meals step is data-dependent; encoding the seed's meal coverage into the test would make it lie on
  any other day.

`pnpm check:rules` **Ran 61 of 61**, all passed. `npx vitest run` **5,272 passed, 57 skipped**.

## Not exercised

- **Not device-verified.** The sheet's footer gained a second button and the content is much taller;
  neither is provable in the web harness, and `SheetContent side="bottom"` owning the bottom inset is
  exactly the thing that only fails on the phone. No `pb-safe*` was added inside it.
- The **empty** read-through was not driven: the seeded day always has something. `emptyLabel` is
  passed but unproven.
- The meals step is skipped on the seeded data whenever every meal has a log, so the *three*-step
  path is exercised only when the fixture leaves one empty — the test tolerates both, which is the
  point, but it means one of the two shapes is untested on any given run.

<a id="2026-08-27-e2e-api-stub-service-worker"></a>

# 2026-08-27 — `fix/food-row-spec-flake` (PS-14) — the flake was the service worker, not a remount

**Lane B · v1.389.1 · one entry closed (PS-14), one CI check added.** Test-only; no product code
changed.

## What PS-14 proposed, and why it was wrong

The entry theorised that `IngredientPicker`'s `key={buildSession}` remount discarded the typed
query before the 700 ms debounce could see it, and proposed wrapping the `fill` in a `toPass` loop
that re-types until the value sticks. It was careful to say the mechanism was **a hypothesis, not a
diagnosis**, and had never been reproduced locally. Good instinct: it was wrong.

**Testing it is what found the real cause.** A probe asserting the value survived the fill —
`await expect(search).toHaveValue('spec mismatch')` — passed **8 runs out of 8**. The query was
never being discarded, so the proposed patch would have added a retry loop around a step that was
already working, and the flake would have continued.

## What it actually is

`public/sw-template.js:108` answers **every** `/api/` request with
`e.respondWith(fetch(e.request, { cache: 'no-store' }))`. That fetch is issued *by the service
worker*, and Playwright cannot intercept those — its own types say so (1.62.1, `types.d.ts:10184`:
route *"will not intercept requests intercepted by Service Worker"*, recommending
`serviceWorkers: 'block'`).

The worker calls `skipWaiting()` then `clients.claim()`, so it takes control **mid-page-life**
rather than on the next navigation. Whether a given fetch is stubbed therefore depends on whether
the claim has landed yet — and the picker's 700 ms debounce puts the food-search request right
around that moment. That is the whole flake, and it explains the shape PS-14 measured: fail → pass →
fail across three CI runs on a Bluetooth branch touching no nutrition file.

**Reproduced directly**, rather than inferred: with a stub counting its own hits, a page-context
fetch **before** the claim reached the stub, and the identical fetch **after** the claim did not —
the real route answered, returning `{"results":[]}` where the stub would have returned a row.

## The part that stings

**This rule was already written down.** `e2e/README.md` has stated it since
`recipe-url-to-meal.spec.ts` hit the same thing. Six specs stub an `/api/` route; three carried the
guard and three did not — and **two of those three were written by me earlier today**
(`empty-meal-library.spec.ts`, `meal-plan-library-surface.spec.ts`), because I wrote new e2e specs
without reading the e2e README first. They passed, which is exactly what a race looks like before it
bites; PS-14's own text predicted it of them.

So this is not "a rule nobody knew". It is a rule prose could not hold, which is the repo's standing
argument for a script. `scripts/check-e2e-api-stub-sw.js` now fails the Custom Rules job on any spec
that stubs `**/api/…` without `serviceWorkers: 'block'` — **Ran 61 of 61** after adding it.

## Verification

- The check **fails on a real offender** (guard removed from `food-row-shared.spec.ts` → exit 1
  naming that file) and passes with it restored. Run both ways, not just the green one.
- All three previously-unguarded specs fixed; all six now carry it.
- `pnpm check:rules` — Ran 61 of 61.
- The probe spec and the temporary `toHaveValue` assertion are both removed — they were instruments,
  not tests.

## Postscript: the entry came back

**PS-14 was resurrected by #574**, which merged 40 minutes after #575 removed it. Traced with
`git log -S`: #566 added it, #575 removed it, #574 restored it — a branch cut before #575 landed,
whose backlog conflict was resolved by keeping the side that still had the entry.

That is the two-deletions trap `CLAUDE.md` documents, now on its **fifth** recorded instance
(LB-4 twice, Q-454, Q-455, Q-465). It is also the shape `check-backlog-pointers.js` deliberately
cannot catch: the check fails on a heading with *nothing under it*, and this restored the **full
entry**, bullets and all. The file says so in as many words — *"a resurrection that restores a full
entry still passes"* — and the general check it rejected wants git history, which CI cannot reach at
depth 1.

Removed again. Worth noting that a rule cannot reach a branch that predates it, which is the
argument for the check rather than against it, and that the four other entries this session removed
(BF-11f, LB-20, BF-11h, BF-40) all survived — so the practice of grepping after every merge is what
caught this, not luck.

## Not exercised

**Whether this fully closes the flake on CI.** The mechanism is proven and the guard is the
documented remedy, but PS-14's failure was CI-only and eight local runs never reproduced it, so the
only real confirmation is `food-row-shared.spec.ts` staying green across future CI runs. Nothing
here can prove that today.

The other three `/api`-stubbing specs were latent, not observed failing — they are fixed on the same
mechanism, not on their own evidence.

<a id="2026-08-27-meal-plan-library-surface"></a>

# 2026-08-27 — `feat/meal-plan-library-surface` (BF-11h) — the wizard can finally reach the library, and stops dropping pins silently

**Lane B · v1.389.0 · one entry shipped (BF-11h), closing Part 2 of the library-first planner.**

BF-11g shipped the engine — the library pass, `matchReason`, `libraryMatchCount`, `droppedPins` —
and **nothing on the client sent `useLibrary` or read any of it.** A grep across `app/`,
`components/` and `lib/` returned zero hits for all four. The library search was off for every real
request since the day it landed. This is the surface.

## The four things

**1. "Use my saved meals" (→ `useLibrary`).** A switch in the *Yours* step, above the pin
checkboxes rather than below, because the distinction only reads if you meet the broad question
first: **ticking a meal forces it in; the toggle lets the planner choose.** The pin list's own
heading changed from "Keep meals from your library" to **"Always include these"** for the same
reason, and its help text now says which of the two you are looking at when the toggle is on. Off by
default — on changes what every generation returns, so it is the user's call, not a new default.

**2. Why this meal.** `matchReason` renders under the meal — but the more important half is a bug it
exposed. The existing badge keyed off `savedMealId != null` → **"Yours — kept"**, and a *library*
pick carries a `savedMealId` too. So the moment BF-11g shipped, a meal the planner **chose** started
claiming to be one the user had **pinned** — you would read it as your own decision and never
question the fit. The badge now keys off `source`, in `meal-source-badge.tsx`, with three states:
kept, chosen-for-this-slot, and (on an AI slot) *"No saved meal fitted this slot."*

That last one is only shown when `matchReason` is non-null, which the route sets **only when the
library was actually searched**. `null` and "nothing fitted" are different answers and the
distinction is load-bearing: it is the difference between *the planner ignored my meals* and *none
of them fitted here*.

**3. Reroll offers the library first, AI second.** The refresh button opens a two-way choice —
**One of mine** / **Something new** — instead of going straight to the model. `library-swap.ts`
runs `selectLibraryMeals`, the generator's own matcher, on data the client already has cached: **no
route, no model call, no cost**, which is exactly why it goes first. A second matcher would have
drifted from the one that built the plan.

`replaceMealInDraft` now carries provenance with the food. An AI reroll drops the `savedMealId`,
sets `source: 'ai'` and clears `matchReason` — carrying the old reason would explain a match that is
no longer there. A library swap sets the new link and the new reason instead, because the slot still
holds a meal the user owns.

**4. The meal-count reduction prompt.** The live silent drop, and the part the entry insisted be
*driven rather than inspected*.

`MyMealsPicker` caps pins at `mealCount - 1` **at the moment you pick** — one slot always stays open
for the plan to work with. Nothing re-checked it, and `setMealCount(Number(v))` was the entire
handler. Pin six meals at seven, go back, drop to three, and three pins vanished. The server capped
them (`kept.slice(mealCount)`) and reported `droppedPins`; nothing on the client read that field.

Now lowering the count runs `reductionNeeded(pins, next)` and, if the pins overflow, asks which to
keep — pre-ticked with the first `M - 1` in pick order so agreeing is one tap, Cancel restoring the
**previous** count (not `count + 1`: `5 → 2` is one tap on that chip row). A dropped typed meal is
**unticked, not deleted** — losing text the user typed, to answer a question nobody asked them,
would be its own small betrayal.

**Two thresholds, and the prompt uses the stricter one.** The client's is `K > M - 1`; the server's
is `K > M`. Both are correct for what they guard — the server's is a backstop against any client —
and `droppedPins` is now rendered in the review step as the last place a bypassed pin can still be
named.

## Verification

- **The regression was driven, not inspected.** With `changeMealCount` reverted to `setMealCount`,
  **both** reduction e2e tests fail; with it, all three pass. Run both ways, as with LB-20.
- 21 new unit tests: `meal-count-reduction` (9 — including that the prompt fires at `K = M`, which
  the server would have accepted), `library-swap` (8 — a swap never returns the meal already in the
  slot, never one used elsewhere in the day, respects meal-type windows, and offers an untagged meal
  anywhere), `draft-provenance` (4).
- `e2e/meal-plan-library-surface.spec.ts` stubs the library with two known meals rather than reading
  the seed: the whole reduction case turns on *how many* meals exist to pin, so a seed-dependent
  spec would pass or skip for reasons unrelated to the code.
- `pnpm check:rules` — Ran 60 of 60. Full vitest and full Playwright suites.
- Component sizes: review step 379, setup sheet 433 — both well under the 800 ceiling, with four new
  small files rather than growth in either.

## Not exercised

**The APK**, and here that matters more than usual: the reroll's library swap reads `saved-meals`
and `nutrition-meal-types` from the client cache, and on device those are also hydrated from the
local store. The web path is verified; the device path is not. No migration, no new route, no write
— so the risk is a swap offering nothing where it should offer something, not data loss.

Also untested: a plan generated with `useLibrary` **on**, end to end. `grep -rl useLibrary
--include=*.test.ts` returns nothing — BF-11g shipped the flag untested and this entry made it
settable, so the route wiring has never been exercised even though `selectLibraryMeals` itself is
well covered. **Filed as LB-21**, Lane A (the work is in the route). The e2e here stubs the library
for the wizard steps but does not generate.

The instinct that this needs an AI call is wrong and the entry says so: the library path is the half
that does *not* call the model, so a fully-filled request is cheap and deterministic to test.

<a id="2026-08-27-nutrition-energy-card"></a>

# 2026-08-27 — Artboard 1's energy block, and the number it did not change (BF-24 ②)

**Lane A working Lane B's surface at the owner's request · branch `feat/nutrition-energy-card`**

BF-24 shipped artboard 1's header and meal grouping and kept four items. ② was the energy block: the
drawing puts a 104 px donut and the day's numbers in **one card**, where the screen had
`CalorieBalanceBar` and `MacroRing` as two rows of one grouped section. The entry deferred it because
`CalorieBalanceBar` also renders on `/health`, so merging the two components would have changed two
screens.

**That risk never arose, because the merge did not have to touch the shared component.** The day
screen gets a new `components/nutrition/energy-card.tsx`; `CalorieBalanceBar` is untouched and still
serves `/health`. `MacroRing`, whose only call site was the day screen, is deleted.

## The premise I got wrong, on my own reasoning this time

Reading the two components side by side, they appeared to show **two different "left" numbers**:
`MacroRing` drew `targets.calories − eaten`, a static goal; `CalorieBalanceBar` leads with
`remainingKcal`, which accounts for what you actually burned. On an active day those differ by
hundreds of kcal and both were labelled "left" — Q-401's exact shape, one row above the other. I
wrote a component doc saying so, and a resolution for it.

**It was already handled.** `nutrition-content.tsx` computes `effectiveTargets` with
`calories: effectiveCalorieGoal` — the burn-aware `budgetProvenance(...).total` — substituted in, so
`MacroRing` was drawing the same number all along. The two agreed by construction:
`budget.total − intake` on one side, `expenditure + targetNet − intake` on the other, which is the
same subtraction written twice.

Worse, my first draft called `budgetProvenance` **inside the card**. That is precisely the fourth
number Q-417 warns about (*"this used to be `targets.calories + activeEnergyKcalToday`, and it
produced a third budget"*), and it would have bypassed Q-323's earned-scaled macro targets — the fix
for a day with 551 kcal earned reporting fat *over* when it was well under.

The card now takes `goalCalories`, `earnedKcal` and the **effective** targets as props and derives
none of them. Three findings put that discipline there; a component that re-derives is how a fourth
gets added.

## What shipped

- **`EnergyCard`** — one card: 104 px conic donut (`intake of goal`, arc split by macro share), the
  headline `N kcal left` / `over` with `+N burned` opposite, and three macro columns (`%` in the
  macro colour, grams, name). Below a divider, still inside the card: the zone label and
  `CalorieZoneBar`, with Eaten/Burned/Net and the maintenance line behind the existing info toggle.
- **Two deliberate differences from the drawing, both stated per BF-28's verification rule:**
  1. **The zone band is kept**, below the two drawn rows. The artboard stops at the fold and the band
     is the only thing that says whether "left" is on track rather than arithmetic. It went inside
     the card rather than into a second one, because a second card is what Q-395b already found reads
     as two unrelated things.
  2. **The macro target rides on the grams line** (`87 /150 g`) rather than becoming a fourth line.
     Dropping it would leave the day screen with nowhere to see protein against target, which on a
     training app is a daily number; Profile is where it is *set*, not tracked.
- **One correction to the drawing.** The artboard's headline is plain foreground and
  `CalorieBalanceBar` coloured it by zone. Kept plain: colouring it paints the headline red at 10 am
  on a day that is legitimately "well under **so far**" — the qualifier `CalorieBalanceBar`'s own
  comment says exists so the bar is not read as a verdict. The verdict keeps its colour, on the label
  below where it is qualified.

## Verification

Rendered at **412 dp in Chromium, dark**, logged in as the seeded user with four food logs, and read
against the artboard: donut, headline, `+burned`, three macro columns, band. **Zero page errors** on
both `/nutrition` and `/health`. `tsc` clean, lint clean, and the UI ratchets —
`check-hex-literals` (427, unchanged: the macro palette is imported, not pasted),
`check-component-size`, `check-memo-prop-stability` — all pass.

**A local-environment trap worth recording.** The first full-suite run failed one file with
`role "claude_readonly" already exists` — `claude-ro-owner-bootstrap.test.ts`, whose `beforeAll` does
`DROP ROLE IF EXISTS` (swallowed) then `CREATE ROLE`. Cause: **`pnpm dev` was running against the
same local Postgres**, and its `ensureSchema` re-applies the `claude_ro` views migration. It passed
6/6 alone with dev stopped. That is a third signature for the same class as the advisory-lock and
`rate_limits` ones already in `CLAUDE.md`: **stop the dev server before believing a DB test failure.**

## Not exercised

**The S25.** Safe-area insets render 0 in the sandbox and Samsung's compositor is not Chromium — and
this card is a conic-gradient donut, which is exactly the construct the repo prefers *because* of that
compositor, so it wants a look. BF-24's device gate already covers artboard 1 and now covers this too.

<a id="2026-08-27-recipe-screenshot-import"></a>

# 2026-08-27 — `feat/recipe-screenshot-import` (BF-40) — a recipe from a picture, and the prompt that assumed a plate

**Lane B · v1.390.0 · one entry shipped (BF-40).** Includes one prompt line in
`app/api/nutrition/scan/route.ts` — Lane A by path, trivial by size, and the entry pre-authorised
taking it in the same PR.

Owner, with a screenshot of a Google recipe overview: *"id like to be able to upload an image like
above to the meal creator and have it make it — i see we dont have that upload option yet."*

## Most of it was already built

BF-11c shipped recipe import, `/api/nutrition/scan` already accepted `{ image, mimeType }`, and both
branches already shared one `ScanSchema` carrying `ingredients[]` and `candidates[]`. Two things were
missing: the image branch's prompt said *"Analyse this food photo"* — which, handed a screenshot of a
word list, instructs the model to estimate a finished **plate** rather than read the **list** — and
the builder had no way to hand it an image at all.

**Why the URL path could not already cover it.** The owner's screenshot is a Google AI overview: the
ingredients are rendered into Google's own results page with the source behind a `YouTube · MOMables`
chip. There is no recipe URL to paste, so the image is the only handle on that content.

## The yield trap was already handled, which is the finding worth recording

The entry's ⚠ is a documented four-fold calorie error: a screenshot has no JSON-LD, so nothing can
read a yield off it, and defaulting to one portion turns a loaf into a slice plausibly enough that
nobody notices.

**Reading the route showed it is structurally safe already.** `recipeYield` initialises to `null`
(route.ts:157) and is only ever set from JSON-LD in the URL branch, so an image returns
`recipeYield: null` and `servings` stays 1 — meaning **no divide**. The whole-batch figures reach the
client, `recipeBuilderPatch` sets `unstatedYield: true`, and BF-11c's amber *"that page didn't say
how many this serves"* prompt fires. `ScanSchema` has no yield field and this entry deliberately did
not add one: a model-reported yield is a hallucination risk that would divide silently, and the
builder already asks.

So the danger was never the route defaulting to 1. It is someone building a **second** import path
that does — which is why `importRecipeFrom(...)` is now shared rather than copied.

## The regression that mattered more than the feature

One prompt line served both acts. Changing it wholesale would have made the photo scan read dinner as
a recipe — silently, and plausibly.

`packages/shared/src/nutrition/scan-prompt.ts` makes the choice a tested pure function, the same
shape BF-11c used for `recipeBuilderPatch` and for the same reason: both prompts are correct in
isolation and getting the choice wrong fails without an error. **Absent means `'plate'`**, and the
plate strings are reproduced **verbatim, note-case included** — an earlier draft of this change
reordered the with-note variant, which would have made "byte-identical for existing callers"
approximately true rather than true. Two tests pin the literals.

The photo path is otherwise **provably untouched**: its only diff is importing `SCAN_IMAGE_MAX_DIM`
rather than declaring it, and it sends no `imageKind`.

## Two smaller decisions

- **The affordance shows only on an EMPTY search.** A typed query means the estimate row, a pasted
  link means the import row; a permanent third button would crowd the one control that matters on
  that screen.
- **No `capture` attribute, `CameraSource.Prompt` on device.** `capture="environment"` forces the
  camera, and a screenshot lives in the gallery — it would have made the owner's own example
  unreachable. Prompt covers both readings of "an image of ingredients": a written list, and the raw
  ingredients laid out.

## Verification

- 8 unit tests on the prompt decision, including the two verbatim plate pins.
- `e2e/recipe-image-to-meal.spec.ts`: a picture becomes ingredients at their own weights, the request
  carries `imageKind: 'recipe'`, **and the builder asks how many it serves** rather than assuming.
  Plus that the affordance yields to both a typed query and a pasted link.
- `pnpm check:rules` — Ran 61 of 61. Full vitest and full Playwright.

## The full suite caught a defect in this PR's own spec

`recipe-image-to-meal.spec.ts` passed 4 of 4 alone and then **failed in the full run** — a
strict-mode violation, two `Spec Flour` elements. The accessible names identified them: one was the
ingredient row (`Spec Flour 2.5 servings · 250 g`), the other a search-result row
(`Spec Flour 10g P per 100 g`).

The import mints a real `food_item` per ingredient and the spec never cleaned up, so from the
**second** local run onward its own leavings reappeared in the picker's list and the bare-name
assertion matched both. It passed alone because that was the first run — and **CI provisions a fresh
database every time, so CI would have stayed green indefinitely** while every local run after the
first failed. That is the inverse of the aged-fixture trap `CLAUDE.md` documents, and it hides just
as well.

Fixed on both sides rather than only the visible one: `beforeAll`/`afterAll` cleanup so the spec
stops accumulating rows in the shared local database, and assertions matched to the ingredient row's
own shape rather than a name anything can carry. Verified by three consecutive solo runs — run 2 is
where it previously broke — with zero residue left in `food_items` afterwards. The rule is now in
`e2e/README.md`, including the cheap habit that would have caught it: **run a new spec twice before
believing it.**

**A subset run would have shipped this.** It is the second time tonight the full suite has earned
its fifteen minutes.

## Not exercised

**The model's actual reading of an image.** The e2e stubs `/api/nutrition/scan`, because a live run
costs a model call per run and is non-deterministic — so this proves everything downstream of the
response and nothing about the prompt working. The owner's own screenshot end to end is the check
that is still owed, and it needs a real call.

**The APK**, where the native `Camera.getPhoto` branch lives. The web path uses the file input; the
Capacitor branch is unverified, and it is the one the owner will actually use.

<a id="2026-08-30-apk-banner-tap-target"></a>

# Home's APK banner link was a 33 px tap target (LB-26)

**Branch:** `fix/apk-banner-link-height` · **Lane B**

The finding `e2e/touch-target-size.spec.ts` produced on the morning it shipped, closed the same day.

## The defect

Home's *Download Android App* banner rendered its body link at **258×33**, against this repo's 48 dp
floor. It is an `<a>`, and `globals.css`'s floor is `button, [role="button"]` — `<a>` is excluded on
purpose, because a 48 px minimum on an inline prose link would wreck paragraph layout wherever one
appears mid-sentence. So nothing raised it, and until that spec existed nothing measured it either.

It was the only one. Across all five tabs every other undersized control is a `button` carrying a
documented compensating hit box (`tap-target-dot` on the 7×7 carousel dots, `tap-target-44` on More's
photo control).

## The fix, and the one it is not

`min-h-[48px]` on that `<a>`, with `justify-center` because two short lines would otherwise sit at
the top of their own tap target. **Not** widening the CSS floor to `a`, which would reach every prose
link in the app to raise the handful that are actually controls.

That reasoning moved into `globals.css`, beside the floor rule itself — the previous version of this
note lived in the banner's JSX, which is not where someone tempted to widen the selector will be
looking. It also kept the change to **net zero lines** in `session-select-content.tsx`, a baselined
hotspot on a shrink-only ratchet.

**The spec's allowlist is now empty**, and that was part of the fix rather than bookkeeping: an
allowlist that never empties is a backlog wearing a test's clothes. Removing the row is what makes
the spec fail again if the floor is ever lost.

## Proved both ways

With the fix: 7 passed. With `min-h-[48px]` removed and everything else unchanged, the spec fails
with exactly the reported measurement — `a 258×33 "Download Android AppGet the latest APK"`. So the
guard is anchored to this defect and not to the page merely rendering.

`pnpm check:rules` — Ran 62 of 62. Typecheck clean. (One lint warning in that file, an unused `idx`
at the `HomeCardWidget` call, is pre-existing on `main` — verified by stashing.)

## A rule that failed to fire, and where it now lives

**LB-26 was filed with `Gate: device` on an entry that had never been built** — by the session that,
hours earlier, had read BF-45's warning block about exactly that mistake and corrected four entries
for it. A gate *parks* an entry, so it hid this one from `next-item.js`, which is where an
implementer starts. A device requirement on unbuilt work belongs in **Verification**, not in `Gate:`.

The warning existed; it was buried inside the entry that found it, where nobody *writing* a new entry
would see it. It is now in the backlog's protocol header, next to the `Gate:` definition. That is the
whole correction: the knowledge was not missing, it was in the wrong place.

## Not exercised

**Not seen on the S25.** The web harness measures the box; it cannot say how the banner reads under a
thumb, and the link now claims 15 px more height inside a banner whose dismiss button sits beside it.
That is the check this entry always owed — and it is a Verification requirement, not a gate.

<a id="2026-08-30-device-comparison-phase-and-units"></a>

# 2026-08-30 — Two rings that were never compared, reported as two rings that disagree

**Lane A · branch `fix/device-comparison-phase-and-units` · PS-15 (phase + units halves)**

`GET /api/admin/device-comparison` returned `overlap: 0` for the two rings' daytime stress, which
reads as total disagreement. They had never been placed on the same axis.

## The cause, measured before it was fixed

Production, over the window PS-15 was filed from: Oura's daytime-stress buckets land at **:15 and
:45** (`oura_daytime_stress_buckets`, 173 rows); the Colmi's at **:00 and :30**
(`colmi_readings`, 95 rows). Permanently fifteen minutes apart. The route bucketed at a hardcoded
`DEFAULT_BUCKET_MINUTES = 5`, so no pair could form at any point in either device's history.

`lib/health/device-comparison.ts` has said, in its own header, since the day it was written:

> Bucket to the COARSEST cadence among the devices being compared, not the finest.

Nothing implemented it. The sentence was true, prominent, and inert — which is the whole reason
this took a backlog entry to notice rather than a reading.

## What shipped

**The width is measured.** `coarsestCadenceMinutes(series, fallback)` takes each series' **median**
inter-sample gap and returns the coarsest. Median, not mean: one overnight gap in an otherwise
five-minute series drags a mean past 25 minutes and would bucket a whole day into one row. An
explicit `?bucket=` still wins — a caller may want the whole-day view — and the response now carries
`bucketMinutes`, `bucketSource` (`derived-from-cadence` | `requested`) and `derivedMinutes`, so a
hand-set width is always comparable against the measured one. `DEFAULT_BUCKET_MINUTES` survives as
what to do when a series is too short to have a cadence at all.

**Zero overlap has three causes and `pairSummary` now names which.** `verdict` is `no-data` (one
device reported nothing), `out-of-phase` (both reported all window and never shared a bucket — a
grid problem, not a device problem) or `compared`. The old output could not distinguish "they
disagree" from "they were never compared", and those call for opposite next actions.

**Mixed units suppress the magnitudes.** Oura's stress is normalised **−1..+1**; the Colmi's is raw
**0..100** (measured range 30–65). A mean bias across those scales is not a weak measurement, it is
not one — and it prints exactly as confidently as a real number. `NamedSeries.unit` declares the
scale; where two differ, `meanAbsDelta` / `maxAbsDelta` / `meanBias` come back `null` with
`unitsDiffer` naming both, and `spearman` is what is left. Omit `unit` and nothing changes, so the
heart-rate pairings (all bpm) are untouched.

**`stress` became a metric.** It is what makes the other two useful rather than theoretical, and it
needed one new read: `getOuraDaytimeStressBuckets` (user-scoped, read-only). At the derived
30 minutes the two rings agree at **rho = 0.64** over the eight afternoon buckets of 2026-08-27 —
the number PS-15 was filed with, computed by hand, now reachable from the endpoint.

## Adding rank correlation removed a duplicate

`spearman` went into `packages/shared/src/health/correlation.ts` beside `pearson`, and
`averageRanks` — which `model-report-calibration.ts` had kept private — moved there with it and is
now imported. So the module that owns correlation owns all of it, and the count of rank
implementations went from one-in-the-wrong-place to one-in-the-right-place rather than to two.

`spearman` was written with its own `if (points.length < 3) return null`. Mutation testing showed
that line could not change an outcome — `pearson`, which it delegates to, already refuses under 3 —
so it was **deleted rather than tested around**. Two copies of one threshold is how the two drift.

## Steps are still not a metric, on purpose

PS-15's third half is steps: Oura writes a daily scalar, the Colmi an hourly series, and pairing
them means summing the Colmi side to a day. **PS-16 has not settled whether those buckets are
cumulative** — and its own words are the reason to stop: *"summing a cumulative counter gives a
number that is badly wrong and still looks plausible."* Building the summation now would put
precisely that number in front of a reader, under a heading that says the two devices were compared.
`METRICS` rejects `steps` with a 400 naming what it accepts, rather than falling back to heart rate.

PS-15 therefore stays in the queue with `Needs: PS-16` and a `Keep:` line naming only the steps half.

## Verification

- Full suite: **642 files, 5321 tests passed** (3 files / 57 tests skipped).
- `pnpm check:rules` — **Ran 61 of 61**, all passed. `tsc --noEmit` clean, lint 0 errors.
- **14 mutations, every anchor asserted before running, all 14 caught.** Among them: reverting the
  bucket width to the constant (the shipped bug), taking the finest cadence instead of the coarsest,
  median → mean, dropping the `out-of-phase` verdict, disabling the unit suppression, letting
  `maxAbsDelta` escape it, withholding `spearman` where it is the only usable statistic, and four
  route-wiring mutations. Two survived a first pass — both in the newly-shared `correlation.ts`,
  whose tie handling had been untested in *both* homes — and were closed with real tests rather than
  waved through.
- New route-level tests (`app/api/admin/device-comparison/__tests__/`) use a **fixed** UTC fixture
  day named by the window params: both sides fixed, so this is not a rolling-window time bomb.

**Not exercised:** the S25 and the APK — this is an admin JSON endpoint with no UI, reached in a
browser, and nothing here touches the local store, safe-area, gestures or notifications. Not
exercised against **production** data either: the phase and range figures above were measured
earlier from production, but the code paths ran only against fixtures and the local seed.

## Filed, not fixed

**LA-35** — `docs/module-map.md` points at `lib/health/…` for **34** modules that live in
`packages/shared/src/health/`, the exact Q-153 trap `CLAUDE.md` sends readers to that map to avoid.
It survives because `scripts/check-index-doc-paths.js` ends its `resolves()` with a
`'packages/shared/src/' + p.replace(/^lib\//, '')` fallback — so the one error class the map exists
to prevent is the one the check whitelists. Found while correcting that map's row for this change.

<a id="2026-08-30-e2e-fixture-not-time-budget"></a>

# 2026-08-30 — `fix/e2e-fixture-not-time-budget` (LB-19) — the flake was the fixture, not the clock

**Lane B · v1.395.2 · test-only.** No product file changes. LB-19's premise is replaced by
measurement; half of it is fixed, half is re-scoped with a mechanism.

LB-19 said two e2e specs fail in-session because they "fit comfortably on CI's runner and do not fit
here", and prescribed `test.setTimeout` on both. **Neither half survived being measured, and the
prescription would have fixed neither.**

## `goal-invalidation.spec.ts` — the row it asserts on cannot render

The failure is `getByText('/ 7,000')` **element(s) not found** after 60 s, inside a test with more
than a minute of its 180 s budget unused. The page snapshot is the tell: the Steps card renders with
**no value line at all**, while Body Weight beside it shows `81.6 kg`.

`seed.sql` writes fourteen days of `body_metrics` ending at `today - 0` — but *its* today is the day
the **seed ran**. Nothing back-fills, and `setup.sh` skips seeding a non-empty `users` table, so an
aged container simply has no row for the current day. `goals-progress-card.tsx` filters `visibleRows`
on `value != null`, so the row the spec is about does not exist to be found.

Measured: `max(date) FROM body_metrics WHERE steps IS NOT NULL` was **2026-08-25** against a
`current_date` of **2026-08-30**.

`ensureStepsToday()` in `e2e/fixtures.ts` now guarantees it. Three things it does deliberately:

- **The date is the USER's, not the runner's** — the same derivation `suppressMorningCheckin`
  already uses. The screens read `todayInTz(session.user.timezone)`, and the container's zone is not
  the seeded user's.
- **8000**, which is exactly what the seed writes for `d = 0`, so the spec reads the same on a fresh
  database and an aged one, and the 7,000/9,000 goals stay distinct from it.
- **Non-destructive**: an existing steps value is left alone, and `restore()` puts back precisely
  what was there — deleting a row it created, nulling a column it filled, or doing nothing.

Verified: passes twice consecutively at **1.4 min**, and `SELECT count(*)` for that day is **0**
afterwards.

## `meal-label.spec.ts:111` — intermittent, and not time either

It failed once in a whole-file run with *"Ingredients · centred's code must decode off the rendered
label"* — a zxing decode returning **null**. It then passed alone (2.8 min) and passed again as a
full file (3.1 min), 5 of 5. So it is a flake, and when it passes the file finishes well inside its
budget; the old "exceeds its own 180 s timeout" reading does not survive a re-run.

**The mechanism came from reading the loop, not from guessing.** Each iteration clicks the style
radio, waits on `expect.poll(inkFraction).toBeGreaterThan(0.01)`, then reads the canvas and decodes.
That poll **cannot distinguish the new style's paint from the previous style's** — the canvas already
carries ink from the last iteration, so the condition is satisfied instantly and the read can land
mid-repaint. Under file-level load the window widens, which is the shape of an intermittent null.

**The obvious fix is wrong and the entry says so.** Polling the decode until it succeeds would pass
on the stale paint: every style encodes the same meal, so the previous canvas decodes to the same
token. What is needed is a signal that *changes* with the style — canvas dimensions, or the sheet's
reported physical size. Establishing which of those differ per style needs the spec's own fixture
meal, so it is left as work rather than guessed at.

## The finding worth more than either spec

A spec that depends on the seed having run **recently** is the hardcoded-timestamp rule in
`CLAUDE.md` wearing a different hat: one side of the comparison is the real clock, the other is
frozen. It fails only on a container old enough to have drifted, and CI provisions a fresh database
every run — so it is invisible exactly where it would otherwise be caught, and it presents as a
locator that never resolves rather than as a wrong value.

**Another session reached the same class from the other side while this was in flight:** #593,
*"Derive the heart-rate collapse fixtures from the clock"*. That is what the local suite was failing
on when this branch was still behind `main` — a reminder that a red local run is worth attributing
before it is believed.

## Not exercised

- No product code changed, so nothing new to verify on device.
- `meal-label` is not fixed, only characterised. It remains in LB-19.
- The restore path was driven for the **insert** case (no row for today). The two other branches —
  an existing row with a null `steps`, and an existing row with a value — are covered by reading,
  not by a run, because the local database only presents one of the three.

<a id="2026-08-30-feat-claude-ro-stat-statements"></a>

# 2026-08-30 — query timings reach the audit role (BF-21), Lane A

**Branch:** `feat/claude-ro-stat-statements` · **Lane A** · migration **242** · no version bump
(nothing user-visible).

## What this is

BF-21's second half. The owner cleared the gate the same day — `shared_preload_libraries` includes
`pg_stat_statements` on the production Postgres and the extension is installed — but the read-only
role still could not see it: `claude_readonly`'s `search_path` is `claude_ro` alone and that schema
is **default-deny**, so anything without a view is unreachable. This adds the view.

## Two decisions, and both are the reason it is not a one-liner

**It goes in the GENERATOR, not in a hand-written migration.** `scripts/generate-claude-ro-views.js`
DROPs and rebuilds the whole `claude_ro` schema on every run. A view written by hand into migration
242 would survive exactly until the next table was added and regenerated — then vanish, with nothing
to say so. `_meta_withheld_columns` is the existing precedent for a non-table view living there.

**It is guarded on `to_regclass('public.pg_stat_statements')`.** The extension is production-only: it
needs a preload and a restart, so neither the local dev DB nor CI's Postgres container has it, and an
unguarded `CREATE VIEW` over a missing relation fails. This migration runs through `ensureSchema` on
cold start, so that is not a warning — it is the app down. The mutation that removes the guard fails
the whole test file rather than one case, which is the failure mode demonstrating itself.

## Not user-scoped, deliberately

Every other view in `claude_ro` is row-scoped to one user because production holds other people's
health data. This one is not, and that is correct rather than an omission: `pg_stat_statements`
stores **normalised** query text — literals are replaced with `$n` placeholders — so it carries query
shapes and timings and never a parameter value or a row.

That safety is a property of the **column list**, so the column list is tested. Five columns:
`query, calls, total_exec_time, mean_exec_time, rows`. A test refuses `queryid`, `userid`, `dbid`
and the block-I/O counters — `queryid` in particular is the one that would let a reader join back to
something.

## Verified

Both branches of the guard exercised against the local Postgres:

| | views in `claude_ro` | `claude_ro.pg_stat_statements` |
|---|---|---|
| extension absent (the local default) | 94 | absent |
| extension created | 95 | present, exactly the five columns |

`CREATE EXTENSION` succeeds without the preload and only errors when the table is *queried*, which is
what made the positive branch testable at all here. Restored afterwards with `DROP EXTENSION …
CASCADE` — noted in the migration, because the view makes `claude_ro` depend on the extension.

Mutation-proven, anchors asserted first — three mutations, all killed: guard removed (fails the file,
as the real failure would), `queryid` exposed, `SELECT *`.

`claude-ro-readonly-role.test.ts` 22/22 — **run with the TCP `DATABASE_URL`**, since it re-points the
URL at another Postgres role and skips under the session hook's socket form. Its "every base table
has a view" count now excludes `pg_stat_statements` for a second reason beyond the `_meta_` one: the
view exists only where the extension does, so counting it would make the assertion depend on which
database it ran against.

Full suite green; `pnpm check:rules` Ran 62 of 62; `tsc --noEmit` clean.

## One thing the naming forced

The migration is `242_claude_ro_views_pg_stat_statements.sql`, not `242_claude_ro_pg_stat_statements`.
The drift-gate test picks the newest file matching `^\d+_claude_ro_views.*\.sql$` and asserts it
carries no bare owner uuid — a name outside that pattern would have left the gate checking migration
**241** while 242 was the live schema. Renamed before it left the branch.

## Not exercised

- **Production.** The counters live there and start empty from the restart; nothing here can read
  them from a sandbox. The entry's own pass test — a session running
  `SELECT query, calls, mean_exec_time FROM claude_ro.pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20`
  and getting rows — is satisfiable only after this deploys and a day of normal use has accumulated.
  Check `pg_stat_statements_info.dealloc` is 0 before treating the table as complete: the default
  5,000-statement cap silently evicts the least-executed shapes.
- **No device surface**; no UI, no client code.
- **Do not close the slow-load question on a clean read here.** BF-19 already measured the database
  and it is not where the reported slowness is (`SELECT 1` in 3 ms, 99.90 % cache hit, nothing idle
  in transaction). This is a baseline that will catch a future regression.

<a id="2026-08-30-feat-clinical-intake-storage"></a>

# 2026-08-30 — DEXA storage (BF-41 / BF-2), Lane A

**Branch:** `feat/clinical-intake-storage` · **Lane A (Implementation)** · migration **240** +
`claude_ro` regeneration **241** · no version bump (nothing user-visible ships).

## What this is

BF-41's second slice. The entry's sequencing is RMR → DEXA → blood; BF-33 shipped the RMR *engine*
already, its UI is Lane B, so DEXA storage is the next thing Lane A can build. It also unblocks
**BF-2**, which sits at the head of the queue and needs somewhere to put the scan half of its first
calibration pair.

## What shipped

| Piece | Where |
|---|---|
| Tables | `lib/data/postgres/migrations/240_dexa_scans.sql` — `dexa_scans` (~40 columns) + `dexa_scan_regions` |
| Audit views | `241_claude_ro_views_dexa.sql`, regenerated; the child's FK path added to `scripts/generate-claude-ro-views.js` |
| Drizzle | `dexaScans` / `dexaScanRegions` in `lib/data/postgres/schema.ts` |
| Repository | `saveDexaScan` / `getLatestDexaScan` / `listDexaScans` (+ `DexaScanInput`/`DexaScanRow`/`DexaScanRegion`) |
| Route | `app/api/dexa-scans/route.ts` — GET (the series) and POST (a `.strict()` Zod gate) |
| Export | `dexa_scans` / `dexa_scan_regions` classified in `lib/export/export-map.ts` |
| Tests | `lib/data/postgres/__tests__/dexa-scans.test.ts` (16, DB-backed) · `app/api/__tests__/dexa-scans-route.test.ts` (13) |

## Decisions, and why

**The schema was written from the printout, not from a description.** BF-41's own rule, and the
same rule this repo applies to external API field names. The fixture in the DB test is the owner's
actual Hologic Horizon A report from `docs/clinical-baseline-2026-08-27.md` — every number in it is
one the report prints — so the round-trip test can show "keep every field" (BF-43) survived a
migration, a Drizzle schema, an insert, a select and a mapper. `rowToDexaScan` is the one of those
five that fails silently, as "save doesn't persist".

**Typed columns, not JSONB.** `measured_rmr` is the template BF-41 names, and the reason is that
BF-2's calibration and BF-33's FFM comparison both do arithmetic on named columns.

**Grams stay grams and percentiles stay percentiles.** The report prints fat as `20,547.5 g`;
converting on the way in would make the stored number something the printout does not say.
`pct_fat_young_normal` (93) and `pct_fat_age_matched` (89) are **percentiles**, share the 0–100
range with the percentages beside them, and the column names are the only thing that says so.

**Regions are a child table, and two of its rows are aggregates.** A region set is N rows, not N
columns — the same reasoning BF-41 gives for a blood panel's analytes, and it makes a twelfth region
a data change rather than a migration. `subtotal` and `total` arrive in that table too, so anything
summing it must exclude them; the migration and the route both say so where someone would look.

**A re-save replaces the region set rather than merging it.** A re-extraction that reads ten regions
must leave ten, or a scan quietly keeps two rows from a parse nobody confirmed.

**Negative T and Z scores.** A `min(0)` would reject every osteopenic result, which is most of the
ones worth storing; the owner's is −1.6. Bounded at ±15 instead.

**No source document is stored.** BF-41 recommends against it outright: extract, confirm, save the
fields, discard the file. The report carries a name, a date of birth and a patient reference; none
of those has a column, and none should get one.

**`source` is `manual` or `extracted`, with no third value** for a model's unconfirmed output — the
confirm step is what makes it one of those two.

## What the tests are actually for

Mutation-proven, anchors asserted first. Eleven mutations, all killed:

- dropping one field from `rowToDexaScan` · not clearing regions on re-save · dropping the `userId`
  scope from `listDexaScans` · taking the oldest scan instead of the newest;
- on the route: a dash-only date regex, `tScore: min(0)`, removing the duplicate-region check,
  dropping `.strict()`, dropping the slash normalisation, dropping the `no-store` header.

**One survived and changed the tests.** Handing every region row to every scan passed, because the
only batching test listed a user with a single scan — true of the leak it was written for and not of
the mis-attribution. A second test with two scans in one `inArray` read kills it.

**Two checks in the local gate did work here** rather than merely passing: the `claude_ro` generator
**failed closed** on `dexa_scan_regions` (a table that is neither user-scoped nor FK-registered is a
refusal, not an unscoped view), and `check-export-coverage.js` refused both new tables until they
were classified in `lib/export/export-map.ts`.

## Verified

- Full suite **655 files / 5,422 tests** green; `pnpm check:rules` **Ran 62 of 62**; `tsc --noEmit`
  clean; eslint 0 errors.
- `pnpm dev` against the local Postgres: POST with the real report (slashed date) → 200 and the
  dashed date stored; GET returns the series with `Cache-Control: private, no-store`; re-POST of the
  same date leaves one scan; duplicate region → 400; unknown field → 400; malformed date → 400;
  no session → 401; a 30 KB body → 413.

## Not exercised

**No device surface exists to exercise.** There is no UI, no local SQLite table and no outbox
domain for this — the route is reachable only by a client that has not been built. So the
device-verification gate has nothing to run against here, and this is not a change hiding behind
"not verified on device": it is server-only by construction, and the phone reaches it through a
Railway deploy with no APK.

Also not exercised: production data (the local DB is a fresh seed) and extraction (nothing extracts
yet).

## Next for this entry

BF-41 stays queued with a `Keep:` naming three things: DEXA **extraction** (Lane A, `generateObject`
against this route's schema), the **blood panel** tables (BF-1, Lane A), and the **upload / crop /
confirm surface** (Lane B) — which still owes the app's *own* crop-before-upload step even though the
owner hand-scrubbed the reports. Those are two different redactions and conflating them is the
security bug BF-41 names.

<a id="2026-08-30-feat-hr-tile-nightly-resting"></a>

# 2026-08-30 — the Heart Rate tile shows last night, as a delta (TN-13), Lane A

**Branch:** `feat/hr-tile-nightly-resting` · **Lane A**, both halves — the entry required it · no
migration · patch version bump.

## What was wrong

`const hr = readiness.restingHr ?? readiness.hrCurrent` — the **7-day mean** of the signal that best
predicts how the owner feels (r = +0.557 against their own check-in, the best of nine), shown as a
bare bpm.

Two defects, and the second is the one that decided the design:

**The number barely moved.** Re-measured against production over **71 nights**: the nightly value
changes on **61 of 70** night-pairs, the rounded 7-day mean on **29**. Mean absolute night-to-night
change 2.50 bpm against the mean's 0.58 — **77 % of the daily movement discarded**, and the tile
standing still on nearly six days in ten.

**A bare bpm says nothing.** Against `perceived_recovery`, expressing either HR candidate as a
deviation from the owner's own baseline roughly **doubles** its correlation with felt state (+0.291
vs +0.176 for waking-rest HR; +0.278 vs +0.129 for the nightly value). Which metric you pick moves
the number far less than raw-versus-relative does. 69 means nothing without knowing the usual is 63.

## Both halves, because half fails the entry

TN-13 says it outright: *"a change that keeps the 7-day average and merely adds a cue beside it fails
this entry"* — and the payload field it needs did not exist, which is what moved the entry to Lane A
in the first place. CLAUDE.md's rule for an entry spanning both lanes is *"Lane A, engine half
first"*, so this is one PR: the field, then the tile. No Lane B PR was open in
`oura-score-chip-row.tsx`, checked before starting.

- **`restingHrLastNight` + `restingHrLastNightDate`** on the payload — the latest single night,
  bounded to 7 days so a stale reading is never presented as last night's, with the date so a
  consumer can say *when* rather than implying it is today's.
- **The tile** reads `restingHrLastNight ?? restingHr ?? hrCurrent`. `hrCurrent` stays last because
  it is a live BLE sample rather than a resting rate — a desk reading, not a night.
- **The cue renders a delta**: `50 · −7 vs usual`, `62 · +5 vs usual`, `same as usual` at zero. The
  band thresholds are unchanged; only what is *shown* changed.

## Two things the code review of my own draft caught

**Order.** The first draft took `recentRhrRows[length - 1]`, on the assumption that `bodyMetrics` is
ascending. It is not guaranteed to be — the module defines its own `asc()` helper before building any
series, which is the tell. Taking the last element would have read whatever the query returned last
and shown a plausible bpm from the wrong night, with nothing on screen to say so. Now picked by max
date, in an exported `latestRestingHrRow` so the ordering property is pinned by a test.

**Home.** `restingHrCue` lived inside `oura-score-chip-row.tsx`, where **no test can reach it** —
both vitest projects run in `node` and the component pulls in Next/React chrome. Proved by trying the
import before moving it. It is now `packages/shared/src/health/resting-hr-cue.ts`, which is where it
belongs anyway: it is domain math over `scoreBand`, and that already lives there.

## The entry's headline number had drifted, so it is restated rather than quoted

TN-13 recorded 2.11 bpm / 0.33 / **84 %** over 50 nights. Re-measured over 71: 2.50 / 0.58 /
**77 %**. Same direction, same conclusion — the figures are restated in the code comments because a
number nobody re-measures drifts, and this one is quoted in three places.

## Verified

22 tests across two files, 6 mutations, all killed: the tile back to the 7-day mean, the cue back to
a tier word, the delta computed on unrounded values, the last-element pick, a null/zero reading
counted as a night, and the empty-state guard forgetting the new field.

`pnpm dev` against the local Postgres, with three nightly readings inserted out of date order:

| | |
|---|---|
| `restingHrLastNight` | **50**, from `2026-08-30` — the newest, not the last inserted |
| `restingHr` (7-day mean, the old tile value) | 55 |
| `restingHrBaseline` | 57 |
| the tile would read | **50 · −7 vs usual** |
| change **only** last night to 62 | tile → **62 · +5 vs usual** (12 bpm) while `restingHr` → 57 (2 bpm) |

Full suite green; `pnpm check:rules` Ran 62 of 62; `tsc --noEmit` clean; eslint clean.

## Not exercised

- **The device**, which is the one thing left. The cue text grew from one word to five, and the score
  row has **20 layout styles** — several of them narrow. Check the Heart Rate tile on the S25: a
  number that moved since yesterday, a signed cue beside it, legible at the tile's type size.
  No new APK; it reaches the phone through a Railway deploy.
- **The AI routes.** `readiness-payload.ts` feeds `readiness-score`, `body-battery` and
  `ai/health-insight`. The two new fields are additive and nothing reads them there, so those
  responses are unchanged — reasoned from the diff, not observed.
- **The owner's "average awake resting HR"** stays a separate entry, deliberately. It moves 6.24 bpm
  night to night, 2.5× the nightly resting HR, which makes it the better *stress* candidate — but
  nothing computes it and it does not belong on a tile labelled Heart Rate.

<a id="2026-08-30-feat-self-contained-meal-label"></a>

# 2026-08-30 — the whole meal in the QR (BF-57, engine half), Lane A

**Branch:** `feat/self-contained-meal-label` · **Lane A** · no migration · **no user-visible change
yet** — nothing calls the new payload until Lane B builds the label and the scan branch, so no
version bump.

## What was wrong

The printed label's QR carries a `saved_meals.id` and nothing else, and the scan path resolves that
against the **scanning** user's own meals — local store first, then `GET /api/nutrition/saved-meals`,
which returns only their rows. Another person's id is never in that list, so a shared label fell to
*"That saved meal no longer exists"*: wrong twice over, since the meal exists and the real answer is
"not yours".

Q-389 built it as a **private bookmark** and nothing about it is broken. Sharing was never in scope.

## The design, and the one that was rejected

Making ids globally resolvable would turn a photograph of a label into read access to someone's meal
— name, ingredients, macros — on an app heading for a Play Store health-data declaration, and it
couples two users' data so the author editing theirs reaches into everyone else's history.

The owner chose the opposite: **put the meal in the code.** No round-trip, so it scans offline and
for a user with no account; no privacy surface, because the data is on paper physically handed over;
and it is inherently a copy, so nothing stays coupled. What it costs, plainly: a printed label cannot
be updated (already true), no photo travels in the QR, and the ingredient list has a cap.

## Two rules carry it

**The totals are sacred; the detail is negotiable.** Dropping an ingredient to save bytes changes the
meal's calories with nothing on the label to say so. Nothing is dropped — the tail rolls into one
remainder entry carrying its combined weight and macros. Tested at 1, 2, 3, 5, 8, 12 and 25
ingredients: a trimmed copy's totals equal the original's exactly.

Rolling beats truncating names and it is not close. Cutting names to 8 characters leaves a
10-ingredient meal at **version 16**; rolling the same meal to 4 named plus a remainder fits
**version 11**, and keeps brands readable.

**Both formats, one decoder, indefinitely.** Labels already printed carry the 22-character id token
and must keep working for whoever printed them. `decodeMealLabelScan` is the single entry point; the
shapes cannot collide (22 base64url characters, a leading `[`, 13 digits).

## The budget is a label problem, not a format one

167 bytes needs QR version 9 — 53 modules. What decides whether a phone reads it is millimetres per
module, and today's circle-safe layout gives the code 12.2–16.4 mm, i.e. **0.31 mm/module**, below
the 0.49–0.66 mm this design was built to.

Given the code ~30 mm, version 11 (61 modules) is **0.49 mm/module** — the largest version still
inside that range; version 12 is 0.46 and falls out. So the budget is **251 bytes**, and the payload
is what gives way. **Growing the code on the label is Lane B's half and is the half that matters.**

## Verified

54 tests across two files, 7 mutations, all killed: the tail dropped instead of rolled, the budget
raised to version 12, the format version unchecked, old-format labels no longer resolving, an
over-long name not trimmed, `qrVersionForBytes` off by one, malformed numbers accepted.

**The capacity table is checked against the real encoder.** `packages/shared` stays dependency-free,
so the table comes from the QR spec rather than from the `qrcode` package — which leaves two sources
for one fact. An app-side test makes them agree for **all 20 versions**, asserting both that a
payload of exactly the stated capacity fits and that one byte more does not. It also independently
reproduces the five version figures the entry measured (69→v5, 167→v9, 265→v12, 412→v15, 510→v18)
before this table existed, so the agreement is corroboration rather than a restatement.

Full suite green; `pnpm check:rules` Ran 62 of 62; `tsc --noEmit` clean.

## Not exercised — and this is most of the feature

**Nothing calls any of it.** The label still prints the old token, the scan path still takes only the
id branch, and no user can share a meal yet. BF-57 stays in the queue with the surface as its
`Keep:`: give the QR ~30 mm, say on the label when the list was trimmed, route the `shared-meal`
branch into creating the scanner's own meal, and fix the message on the other one — *"That meal
belongs to someone else"* rather than *"no longer exists"*, which an old-format label scanned by
another user will still hit.

No device pass and no `pnpm dev` check, because there is no runtime surface to exercise: this PR is a
pure module plus its tests.

<a id="2026-08-30-feat-supplement-dose-on-log"></a>

# 2026-08-30 — the dose goes on the log (BF-3 gap 1), Lane A

**Branch:** `feat/supplement-dose-on-log` · **Lane A** · Postgres **244** + `claude_ro` **245** ·
local SQLite **v32** · patch version bump.

## Why this was urgent

The owner is about to start retatrutide. `supplements.dose` is free text on the **definition** and
`supplement_logs` carried no dose at all, so editing the dose rewrote history: titrate 2 mg → 4 mg →
8 mg and every past log retroactively read 8 mg. For a drug whose entire clinical story is the
escalation schedule, the escalation is exactly what was destroyed — and it could not be
reconstructed, because nothing recorded it. The entry's advice was to keep the schedule in a
spreadsheet until this shipped. That is no longer needed.

## What shipped

`supplement_logs` gains `amount`, `unit` and `dose_text`; `supplements` gains `default_amount` and
`unit`. All nullable, all additive, **nothing back-filled** — back-filling would stamp today's dose
onto history and manufacture the very claim this exists to stop.

**`dose_text` is the column that makes this work today.** Every existing supplement carries only
free text, so a structured-only fix would have required the owner to re-enter each one as a number
before their history was safe. The snapshot freezes the dose as it read, with no data entry and no
UI change.

`amount`/`unit` are the half the correlation ask needs — an exposure variable has to be a number on
a date — which is why the entry's *"id like it tracked well to correlate"* is now unblocked rather
than separate work.

## The chain, in one pass

Local table → `upsertSupplementLog`, which **stamps from the local definition when the caller omits
a dose** → outbox payload → `enrichPayload` at push time → `pushMutations` → `getSyncDelta` →
`pullDelta` → `applyDelta` → `listSupplements`.

Two of those deserve their own sentence.

**The store-side stamp is why today's UI needed no change.** `supplements-section.tsx` passes no
dose and does not need to; doing the stamp in the store rather than at the call site means the
shipped surface starts freezing doses immediately, and the Lane B work becomes *showing* the value
rather than recording it.

**The push enrichment closes the window the server fallback leaves open.** `logSupplement` falls
back to the definition's *current* dose when the payload carries none — correct for the web route,
where the log and the stamp are the same instant, and wrong for a mutation queued offline and
drained after a titration, which would write the new dose onto an old act. `enrichPayload` reads the
local row back, so the installed client gets this without changing.

`listSupplements` returns `loggedDose` **beside** `dose`/`defaultAmount`. A screen reading the
definition shows what you would take now; a log has to show what you actually took. Both are true and
they differ, which is the distinction the whole entry rests on.

## The chain gap TypeScript could not see

The `pullDelta` mapping in `sync-engine.ts` dropped all three columns and **compiled clean**, because
the fields are optional on `LocalSupplementLog` — optional so the Lane B call sites that build these
literals keep working. A fresh device would have pulled every past log and shown it at the
definition's current dose: the exact bug, reintroduced at the one point in the chain nothing checks.
Found by walking the chain rather than by the compiler, which is why CLAUDE.md says to walk it.

## The regression the dev server caught and the tests did not

The log route takes an **optional** body, and the first version treated only `no_body` as absent.
`fetch(url, { method: 'POST' })` and curl's `-X POST` both send `Content-Length: 0`, so the request
has a readable stream of zero bytes, `JSON.parse('')` throws, and the route **400'd every request the
shipped client makes**. The tests could not see it — they call the repository, not the route.

Fixed in `readJsonLimited` rather than by papering over it locally: zero bytes is now its own
`empty` reason, because *absent* and *malformed* need different answers and the helper was the only
place that knew the difference. Additive for every existing caller — they branch on `too_large` and
treat the rest as 400, which is what an empty body already produced. Two routes echo the reason
token into their 400 body (`feedback`, `scale-ble/samples`), so an empty body there now says
`empty` instead of `invalid_json`: same status, different string.

## Verified

22 tests across two files, 8 mutations, all killed: nothing stamped (the pre-fix behaviour, 9
failures), re-log not re-stamping, an explicit dose ignored (the offline-replay bug), the screen
reading the definition instead of the log, the sync delta dropping the dose, **the pull mapping
dropping it** (the gap actually found), the push enrichment unwired, and the local store no longer
stamping.

`pnpm dev` against the local Postgres — the sequence that is the entry's definition of done:

| Step | Result |
|---|---|
| create with `dose: "2 mg", defaultAmount: 2` | 201 |
| log with **no body** (what the shipped client sends) | **200** |
| titrate to 4 mg, then 8 mg | 200 |
| the earlier log | still **4 mg / "4 mg"** — unmoved |
| `GET /api/supplements` | definition `8 mg`, `loggedDose {4, mg, "4 mg"}` |
| log with an explicit `{amount: 6}` | stored as 6 |
| malformed / negative / unknown-key body | 400 / 400 / 400 |

Full suite **666 files / 5,583 tests** green; `pnpm check:rules` **Ran 62 of 62**; `tsc --noEmit`
clean; eslint clean.

## Not exercised

- **The device.** Local SQLite goes to **v32**, which is the highest-risk kind of change this repo
  has — a dead local store shows as an empty Nutrition tab. Not verified on the S25 and it needs to
  be: open Nutrition, confirm supplements list, tick one, force-close, reopen, confirm it is still
  ticked. **No new APK** — this is JS and reaches the phone through a Railway deploy.
- **Production data.** The dev check ran against a locally created supplement, removed afterwards.
- **Gaps 2 and 3** (multiple logs per day, weekly cadence) are untouched and stay queued, along with
  the Lane B surface — nothing in the UI enters or shows a dose yet.

<a id="2026-08-30-fix-db-footprint-real-counts"></a>

# 2026-08-30 — the console counts rows instead of guessing them (BF-54), Lane A

**Branch:** `fix/db-footprint-real-counts` · **Lane A** · no migration · admin-console only, so no
version bump.

## What this is

BF-54, from the owner's D2/D5 device screenshots and then measured against production. Two sites in
`lib/data/postgres/slices/oura.ts` read `n_live_tup` — a planner **estimate** maintained by
autovacuum, which CLAUDE.md already documents as untrustworthy here because `last_analyze` is NULL
on every table in this database.

The gap is not marginal:

| Table | `n_live_tup` | real `count(*)` | under-read |
|---|---|---|---|
| `oura_raw_samples` | 552 | 180,415 | 327× |
| `rr_intervals` | 0 | 87,015 | ∞ |
| `error_events` | 1 | 6,102 | 6,102× |

## The display was the smaller half

`getOuraStorageStats` printed the estimate under a column headed **rows** — the owner's screen showed
297 directly below a line reading "0 / 180,160", three orders of magnitude apart on one screen.

`vacuumTableFull` used the same counter to **justify a VACUUM FULL**, and its own comment states the
reasoning: *"A huge `before` against a handful of live rows is the signature of pure bloat."* Against
`oura_raw_samples` that read 67 MB against 552 rows and said *pure bloat*, on a table holding 180,415
real rows. Acting on it takes an **ACCESS EXCLUSIVE lock** with the timeouts deliberately lifted, and
reclaims nothing.

## The fix

`count(*)` at both sites. The footprint gets one `UNION ALL` of counts across the 14-table allowlist,
joined to the size query by name; the reclaim counts the one table it is about to rewrite.

**Cost was checked rather than assumed.** Counting 14 tables is a seq scan of tens of MB on a screen
pressed occasionally — and the same function already does a *far* more expensive full scan with
`pg_column_size` over the largest table in the set. The count before a VACUUM FULL is trivial beside
the rewrite it justifies.

**The sizes are untouched, and that distinction is the point.** `pg_total_relation_size` is read from
the filesystem and is exact; only the ROW columns of `pg_stat_user_tables` are estimates. Conflating
the two cost a session before (Q-528, a data-loss incident filed against a table that had never lost
anything), so a test pins the sizes still matching too.

## Verified

Six tests in `lib/data/postgres/__tests__/storage-footprint-real-counts.test.ts`. The one that
matters **reproduces the estimate being wrong** rather than assuming it: ANALYZE, insert 9 rows,
never ANALYZE again — the state this database is permanently in — then assert `estimate < real` and
that the reported figure is `real`. If autovacuum ever runs mid-test that assertion fails rather than
silently proving nothing, which is deliberate.

The VACUUM path is asserted at **source**, not run: it takes an ACCESS EXCLUSIVE lock with
`statement_timeout = 0` against a database every other test file in this directory shares — the wedge
CLAUDE.md warns about — for a change that is one expression. The prohibition strips comments first,
because this file now *explains* `n_live_tup` at length and a check that could not tell an
explanation from a use would force the next reader to delete the explanation to keep it green.

Mutation-proven, anchors asserted first — four mutations, all killed: the estimate restored in the
size query, counts dropped on the way out, the reclaim reverted to the estimate, sizes zeroed. **One
survived and is left surviving:** the identifier guard in front of the `sql.raw` interpolation. Its
input is a module constant of valid identifiers, so no fixture can reach it — it is there because it
guards a raw interpolation and because `vacuumTableFull` twenty lines below applies exactly the same
belt-and-braces for the same reason.

**Sibling sweep complete:** `grep -rn n_live_tup` over the tree found two call sites and both were in
this file. A test freezes that at zero outside comments.

`pnpm dev` against the local Postgres: `GET /api/oura-ble/db-stats` as an admin returns
`oura_raw_samples: rows 4226`, matching `count(*)` exactly.

Full suite green; `pnpm check:rules` Ran 62 of 62; `tsc --noEmit` clean.

## Not exercised

- **Production**, which is where the divergence actually is. On the local dev DB autovacuum keeps up
  on tables this small, so the dev-server check confirms the route works and *not* that it changed
  the answer — the unit test is what forces the divergence, deterministically.
- **The VACUUM FULL itself** was not run, for the reason above.
- **No device surface**; this is an admin console reached in a browser.
- BF-55 — the 84 MB-index / ~7×-trend growth finding measured beside this one — is **not** addressed
  here. It stays in the queue, and its first move is measurement, not a VACUUM.


## One thing found after the fact, and it is not about BF-54

`GET /api/admin/db-query` against **production**, minutes after BF-21 deployed, confirms
`claude_ro.pg_stat_statements` exists and returns rows — the entry's own pass test. But every row's
`query` reads **`<insufficient privilege>`**: the extension redacts query text for anyone outside
`pg_read_all_stats`, checked against the *session* role inside its own function, so neither the view's
owner nor `security_invoker` affects it. Verified on production (PostgreSQL 18.6):
`pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER')` is **false** and `claude_readonly` holds no
role memberships at all.

Calls and timings are real; the column that says *which* query is not. Filed as **LA-39**, gated on
the owner, because the fix is `GRANT pg_read_all_stats TO claude_readonly` — superuser work done out
of band, like the role's own creation — and because it is a widening worth deciding rather than
assuming. The entry carries the trade-off and a recommendation.
