# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-31 · **By:** the eighteenth Lane B run · **Next ID:** `LB-32`

## Now
**Merged: BF-66 (#662, v1.404.2) and BF-65/LB-23/LB-30/LB-31 (#664, v1.405.1). Open: BF-71 (v1.406.0). Nothing has been near a device.**

**BF-71: a route with no caller fails no test.** Both clinical routes shipped complete — schema,
repo reads, a live consumer — and nothing called either, so two tables were empty in production
while every resting rate stayed predicted. An empty table is a valid state; nothing surfaces it.
**When an entry says a storage half shipped, grep for a client caller before believing the feature
exists.** Only `scannedOn` and `pctFat` are read by anything (`getBodyFatCalibration` selects exactly
those); the 12 per-region bone rows are deliberately absent, being 36 typed fields nothing reads.

**When Lane B work wants a Lane A file, check whether it actually needs one.** BF-71 wanted an
invalidation group (`lib/cache-groups.ts`) and a TTL constant (`packages/shared/**`). Neither key
needs invalidating: `cachedFetch` always revalidates, neither passes `freshWithinTtl`, neither is
seed-only — so both are first-paint accelerators and clearing one buys a blank paint.

**`parseVoice` is a tokenizer, never a character denylist again** — a keyword claims the number
before it, loose numbers fill what is left weight-first, a lone bare number parses to nothing on
purpose. **`useExerciseMedia` is the ONLY fetch of `/api/exercise-gif`** (it replaced four copies);
its shared `exercise-media:<name>` key is what makes the ready screen instant, and `unoptimized` on
a `.gif` fails **silently** — the picture appears, looks right, never moves.

**The sandbox cannot render any exercise clip**: the dataset is on `raw.githubusercontent.com`, which
the egress proxy drops, so clips are blank **including the warm-up screen's own, untouched for
months** — that is how it was pinned to the environment rather than the component. Verify with
same-origin substitutes asserting `naturalWidth > 0`.

**Start from `node scripts/next-item.js --lane B`, never a hand-scan — re-run after every merge.**
Next: **BF-52** (planning), **Q-407**, **LB-12**, and the `nutrition-ui-uplift` residue — all of
which are nutrition/body UI in the area whose device pass is still outstanding, so expect to ship
them unverified or wait for the owner.

**Three things are blocked on the owner, each with a written recommendation. Do not decide them
yourself and do not build past them:**
- **BF-51 ③.** The picker has ONE collection shown two ways (`Recently used` empty, `Your foods`
  typed) plus the food database, which appears only while typing — so Log Food's three-tab strip does
  not map onto it, and a database tab hides what BF-48 shipped to expose. **Recommended: fold into
  BF-52's planning session**, which redesigns the top of the same screen.
- **LB-29.** Recommended: a dirty mark that re-PATCHes the local value. Seed-if-absent cannot
  clobber but gives up cross-device updates. **They promise different things.**
- **The device pass.**

## The finding that should change how you start
**A test suite can be complete and incapable of failing.** Seven passing `parseVoice` cases were all
adjacent numbers or explicit keywords, so the app's most natural phrasing was **untested by
construction** and the file did not look thin; a spec asserting a clip's `src` passed against a
picture that never loaded; and BF-71's caller guard matched `/api/dexa-scans-DISABLED`. Ask what your
tests are true of — and **mutate them**, because none of those three showed up by reading.

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

**W4/W5 (voice logging, exercise clips) and now BF-71's form are all enumerated in that queue** —
per screen, which is where they stay. **Nothing animated has been rendered anywhere in this work**,
and BF-71's `<input type="date">` and decimal keypads have never been on the phone. The previous
run's whole **Nutrition** section is still owed, best done in one sitting.

Carried: Q-467, Q-499, Q-538, Q-305 at S25 width, Q-477 across local midnight, BF-10, LB-5, Q-328/Q-321/Q-486, Q-389, a TalkBack pass, Q-450/Q-418 (Polar H10). **Q-315 needs a DESKTOP.**

## Claimed paths
None held.

## Gotchas worth carrying
- **`main` will land a PR under YOUR open one**, and `total_count: 0` follows. That zero has
  **three** causes: stale base, runner backlog, **wedged run** (`rerun` 403 / `cancel` 409; the only
  way out is a new commit with real content, never an empty one).
- **E2E takes 15–40 min and CATCHES REAL BUGS** — three across two PRs one run. **Never dismiss a
  red E2E as flake without reading the log.** When it cannot be informative (docs/scripts; a re-push
  whose diff against an already-green head is version/changelog only), merge on the five and say so.
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
  opens is a position the element is still travelling through (`swipeRowLeft` waits for the rect to
  settle; `toBeInViewport()` does not). Also **centre a row** (its natural spot is under the tab bar),
  **hide the dev overlay**, **scope assertions to the sheet** (three mounted layers say "Protein"),
  and **`getByText` matches SUBSTRINGS**.
- **`deleteFoodLog` writes a tombstone** — a count ignoring `deleted_at IS NULL` *passes* on a broken delete.
- **`SegmentedTabs` renders `role="tab"`**, takes `orientation="vertical"`, and the 48 dp floor is
  per segment — a stacked toggle is 96 px and its neighbour must match.
- **Never merge `main` or edit the tree while a local e2e run is live** — the tell is
  `Parsing ecmascript source code failed` with tests at **0ms**.