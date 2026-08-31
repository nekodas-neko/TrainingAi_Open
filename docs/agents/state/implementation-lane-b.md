# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-31 · **By:** the nineteenth Lane B run · **Next ID:** `LB-35`

## Now
**Merged this run: BF-57 (#692, v1.408.0), BF-82's IA plan (#693), BF-75 (#694, v1.409.0), BF-52's
plan (#695), BF-52 (#696, v1.410.0). Nothing has been near a device, and the device queue grew by
three.**

**FOUR TESTS THIS RUN COULD NOT FAIL AS FIRST WRITTEN, and every one surfaced from mutating rather
than reading.** This is the habit to carry above all else.
- An e2e `elementFromPoint` hit-test meant to prove a layer sits *behind* content — defeated by
  `pointer-events-none`, which makes hit-testing skip the layer whatever its paint order. It passed
  with the guard deleted. Assert the **computed z-index**.
- A 0.01-floor test using a **0.5 g** ingredient, where `ingredientToEntry` already returns 0.01 and
  `Math.max` is a no-op. **0.4 g** is the weight that rounds to zero.
- **Three** source greps that matched their own explanatory comments — the doc block naming the
  thing it explains why is absent. Match the CALL (`/name\s*\(/`) or slice past the prose.

Three more from the run before, same shape: seven `parseVoice` cases that were all adjacent numbers
or explicit keywords, so the app's most natural phrasing was **untested by construction** and the
file did not look thin; a spec asserting a clip's `src` that passed against a picture which never
loaded; and BF-71's caller guard matching `/api/dexa-scans-DISABLED`. **Ask what your tests are true
of.** Seven in two runs, none found by reading.

**Before moving or renaming a user-visible affordance, `grep -rln` the OLD accessible name across
`e2e/`, not just the source.** BF-52 moved the recipe-photo button out of the ingredient search; a
sibling sweep of the *code* missed `recipe-image-to-meal.spec.ts`, whose whole subject is that
button. All five required checks passed and only E2E caught it. One of its two tests then needed
**rewriting rather than repointing**: it asserted the button *yields* to a typed query, and that
yielding was the defect.

**An entry's premises are not evidence.** Four in a row were stale or wrong: BF-57's binding
constraint was arithmetically impossible (a pre-Q-411 figure — the five print styles are each
already at the largest code clearing their content by 6 units); BF-82 had three wrong premises
including a 2026-08-16 owner decision it read as an oversight; BF-52 treated two renders of ONE slot
as two problems. **Correct them IN the entry, not only in the plan** — the entry is what a hand-scan
finds. And when a plan's instruction is wrong, decline it in writing: BF-52 says to fold the barcode
into the new capture row, and it must not be (whole ingredient list vs one product).

**`min-h-[Npx]` does nothing on a `<button>` or a `role="button"`** — `globals.css` sets a bare
element-selector floor that beats the utility (48 px on a button, 84 px on a div). Drive height with
padding; LB-32 holds the general case. **A bottom sheet is `fixed bottom-0`**, so its height moves
only its TOP edge — `vh`→`dvh` cannot fix bottom clearance.

**A route with no caller fails no test** (BF-71). **When an entry says a storage half shipped, grep
for a client caller before believing the feature exists.**

**The sandbox cannot render any exercise clip**: the dataset is on `raw.githubusercontent.com`, which
the egress proxy drops, so clips are blank **including the warm-up screen's own, untouched for
months**. Verify with same-origin substitutes asserting `naturalWidth > 0`.

**Start from `node scripts/next-item.js --lane B`, never a hand-scan — re-run after every merge.**
The queue was reordered six times in one day, so a plan formed before a merge is stale by definition.
Next: **Q-407** (the meal-plan wizard — its widget half shipped 2026-08-27, the seven-step stepper is
what remains) then **LB-12**. **A "Planning item" means a plan in `docs/superpowers/plans/` plus a
`Plan:` pointer on the entry, not an implementation** — that is BF-82 and BF-52's shape, and both are
done. **LB-33** (split the 1,049-line `meal-label-render.ts`) and **LB-34** (a re-scanned share label
makes a second copy of the meal) are this run's own findings, filed low.

**Three things are blocked on the owner, each with a written recommendation — do not decide or build past them:**
- **BF-51 ③.** The picker has ONE collection shown two ways (`Recently used` empty, `Your foods`
  typed) plus the food database, which appears only while typing — so Log Food's three-tab strip does
  not map onto it, and a database tab hides what BF-48 shipped to expose. **Recommended: fold into
  BF-52's planning session**, which redesigns the top of the same screen.
- **LB-29.** Recommended: a dirty mark that re-PATCHes the local value. Seed-if-absent cannot
  clobber but gives up cross-device updates. **They promise different things.**
- **The device pass.**

## Do not re-litigate
- **`stableBox`/`tapCentre` (`e2e/fixtures.ts`) before any coordinate dispatch OR geometry assertion** — neither `touchscreen.tap` nor `Input.dispatchTouchEvent` checks actionability. CI proved it on `food-log-swipe-delete:175` after it passed 3/3 locally: **a local pass is not evidence against this race.** The 21 taps inside a `toPass` retry re-measure and are already safe.
- Both of the above are held by tests (`use-exercise-media.test.ts`, `voice-log-parse.test.ts`).
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**` are Lane A** whatever the edit
  looks like — the **path**, not the nature of the edit. `lib/health/readiness-payload.ts` counts.
  `scripts/**` is not answered by the rule; record the claim if you take one.
- **`hydrateUserPreferences` NEVER deletes a key the bag lacks.** The PATCH is in the background, so
  the bag legitimately lacks a key just chosen — and offline it never arrives. The one pair the app
  clears is brand preset / custom hue, via `EXCLUSIVE_GROUPS`. *An exclusion list is what you reach
  for when you have mistaken a rule's failure for a single key's.*
- **A mirror effect uses `usePersistedPreference`, never `savePreference`** — the same line is a
  PATCH **on every mount**, and one such site stranded it and a GET behind it past sixty seconds,
  failing nine specs that never mention preferences. **The guard compares the VALUE:** StrictMode
  invokes an effect twice, so a first-run ref is already spent.
- **A `fetch()` of a `data:` URL is a `connect-src` request** and the CSP forbids it. Use
  `dataUrlToBlob` or `CameraResultType.Base64`; `no-data-url-fetch.test.ts` fails on the next one.
- **A `SwipeActions` row owns horizontal gestures starting on it** (`[data-swipe-actions]`). The
  nutrition container's own drag steps the DAY and is **invisible on today** — test on a past day.
- **BF-39's grouping rule** — `meal_group_id`, never `saved_meal_id`; a group needs a resolvable
  meal; one row is not nested. The "a sibling re-render drops an in-flight `useDrag`" claim that
  held it for a week was **wrong in every part**; `SwipeActions` is not implicated at all.
- **Back-dismissal's logic is [`sheet-back-stack.ts`](../../../lib/hooks/sheet-back-stack.ts)**, the
  hook only React wiring: **depth** and a **module-level self-pop counter**, both load-bearing.
  Never call `useSheetBackDismiss` at a call site; its three-deep case is covered ONLY by unit tests.
- **`EndOfDayReview` renders unconditionally** — `open` only drives Radix; fetches go in a child of
  `SheetContent`. **Log Food is one sheet per screen** (`SavedMealsSheet` is the screen).
  **`kept` and `library` both carry a `savedMealId`** — provenance reads `DraftMeal.source`.

## Owed (device / physical)
**Nothing from the last five runs is device-verified.** [`device-verification-queue.md`](../../device-verification-queue.md)
groups by screen — work a section, not an entry.

**W4/W5 and BF-71's form are enumerated there per screen.** The whole **Nutrition** section is owed
and is best done in one sitting — this run added three more items to it:
- **BF-57 needs TWO PHONES AND TWO ACCOUNTS**, which nothing else here does, **and a printer**. No
  label of any style has been through one, so `MIN_MM_PER_MODULE` (0.49) is a convention and the
  whole QR payload budget derives from it. If a real print disagrees, that one constant moves.
- **BF-75:** body and secondary text ≥4.5:1 over the sheet palette + `ScrimLayer`. ⚠ Wallpapers ship
  `enabled: false`, so **nothing about them can be judged in the sandbox** — the e2e switches them on
  to assert anything at all.
- **BF-52:** whether three tiles plus an expanded input read well at 412 dp, and whether the
  recipe-photo picker still reaches the gallery now that it draws as a tile.

Carried: Q-467, Q-499, Q-538, Q-305 at S25 width, Q-477 across local midnight, BF-10, LB-5, Q-328/Q-321/Q-486, Q-389, a TalkBack pass, Q-450/Q-418 (Polar H10). **Q-315 needs a DESKTOP.**

## Claimed paths
None held.

## Gotchas worth carrying
- **`main` will land a PR under YOUR open one**, and `total_count: 0` follows. That zero has
  **three** causes: stale base, runner backlog, **wedged run** (`rerun` 403 / `cancel` 409; the only
  way out is a new commit with real content, never an empty one).
- **E2E takes 15–40 min and CATCHES REAL BUGS** — three across two PRs in one run. **Never dismiss a
  red E2E as flake without reading the log.** When it cannot be informative (docs; a re-push whose
  diff against an already-green head is version/changelog only), merge on the five and say so.
- **`git add -A` with two items in flight sweeps the other into your commit.** It happened: an
  untracked spec rode onto the wrong branch and was pushed. Stage paths.
- **`docs/doc-size-baseline-history.md` is APPEND-ONLY** — a conflict is two *additions*: keep both,
  order them chronologically, and **correct the from→to figures to the merged reality**. Re-derive
  the `.size` from the merged document rather than picking a side. **A backlog conflict is not
  always two deletions** — read the headings.
- **`projectOverview.md` sits ON its ratchet** — tighten when a compaction leaves slack, expect to
  raise it when a sibling's paragraph lands under you. **Rebuild `package.json`/`changelog.ts` from
  `git show origin/main:...`; never splice a hunk.** **`git fetch origin main` RE-SHALLOWS this
  clone** — the tell is `merge-base` returning nothing.
- **Two file inputs on one screen is a silent hazard** — name them; `input[type="file"]` takes
  whichever is first and the wrong one fails without a sound.
- **In a spec: a coordinate tap has no actionability check** — `boundingBox()` right after a sheet
  opens is a position still being travelled through (`swipeRowLeft` waits for the rect;
  `toBeInViewport()` does not). Also **centre a row**, **hide the dev overlay**, **scope assertions to
  the sheet** (three layers say "Protein"), and **`getByText` matches SUBSTRINGS**.
- **`deleteFoodLog` writes a tombstone** — a count ignoring `deleted_at IS NULL` *passes* on a broken delete.
- **`SegmentedTabs` renders `role="tab"`**, takes `orientation="vertical"`, and the 48 dp floor is
  per segment — a stacked toggle is 96 px and its neighbour must match.
- **Never merge `main` or edit the tree while a local e2e run is live** — the tell is
  `Parsing ecmascript source code failed` with tests at **0ms**.
- **Playwright needs `DATABASE_URL` prefixed in** — the session-start hook unsets it, and the failure
  surfaces in `zero-data.setup.ts` while your spec reports `did not run`.
  `DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' npx playwright test …`
- **Changing a DEFAULT argument silently changes what existing tests assert** — `mealLabelCodeMetrics`
  defaulting to a derived budget turned a 0.49 mm floor into a tautology. Pin the old value there.
- **`expect.poll` over a canvas is pathological.** Reading pixels ships ~5.5 M numbers over CDP, so a
  200 ms poll cannot finish an iteration between ticks and stalls the page — it failed a run the
  single read had passed twice. Use a bounded retry with a real gap.
- **A red local e2e that is green in CI is probably the aged seed.** `body_metrics.steps` ends days
  before "today", so week charts render empty columns; `training-load-day-flags` is the first to
  break. Check `select max(date) from body_metrics where steps is not null` before believing it.