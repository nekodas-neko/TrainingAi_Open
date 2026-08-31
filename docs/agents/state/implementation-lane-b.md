# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-31 · **By:** the seventeenth Lane B run · **Next ID:** `LB-31`

## Now
Merged: **#628** (LB-26), **#633**, **#640** (BF-45 ⑤), **#631** (Q-392), **#641**, **#642**,
**#643** (BF-46 ①b ② ③ ①a), **#644**, **#647** (BF-39 + LB-30), **#653** (LB-28). **Open: #659** —
BF-60/61/62/63, v1.404.0. Filed: **LB-27**, **LB-29**, **LB-30**.

**BF-39's hold was a harness race and its recorded conclusion was wrong in every part.**
`SwipeActions` mounts once, the drag handler is **never invoked**, and no `saved-meals` invalidation
fires — `Input.dispatchTouchEvent` skips the stability check `locator.tap()` does, so the spec
measured a row still travelling with the sheet's `enter` animation (read y=605, landed at y=503).
`swipeRowLeft` (`e2e/fixtures.ts`) now waits for the rect to settle; **LB-30** audits the other 46
coordinate reads. Then #659: BF-61 (the tray stacks above the row), BF-62 (**not** the `92vh` its
entry proposed — the sheet bakes `.pb-safe-action`, whose floor loses to an inset reporting the nav
bar's own height), BF-60, BF-63.

**The whole `nutrition-ui-uplift` batch now owes exactly one thing: the on-device pass** — BF-24,
BF-45, BF-46, BF-51 ①②④, BF-61, BF-62, BF-63 — and that is this lane's binding constraint, not a
queue of unwritten code. **BF-62 needs BOTH navigation modes** (the inset differs, and checking one
is what lets this class through); **BF-61 needs the fast tap on BOTH trays** (BF-29's pass was the
meal list, tapped slowly); `useSavedMealSummaries`'s local-store read has **never run in any test**.

**Three things are blocked on the owner, each with a written recommendation. Do not decide them
yourself and do not build past them:**
- **BF-51 ③.** The picker has ONE collection shown two ways (`Recently used` empty, `Your foods`
  typed) plus the food database, which appears only while typing — so Log Food's three-tab strip does
  not map onto it, and a database tab hides what BF-48 shipped to expose. **Recommended: fold into
  BF-52's planning session**, which redesigns the top of the same screen.
- **LB-29.** Recommended: a dirty mark that re-PATCHes the local value. Seed-if-absent cannot
  clobber but gives up cross-device updates. **They promise different things.**
- **The device pass.**

**Start from `node scripts/next-item.js --lane B`, never a hand-scan — and re-run it after every
merge**: BF-60/61/62/63 were all filed into the top of this lane mid-session. Past the nutrition
entries it holds BF-52 (**planning**), LB-12 (Orchestrator's), and a readiness/DB cluster (Q-275,
Q-272, Q-276, Q-279, Q-283) the path rule puts in **Lane A**. **Q-278** is the one plausible B item —
one layer, **one** migration site (`components/health/readiness-breakdown.tsx`) — but it has **no
plan** and an open scope question (two of its five "pillars" have no score surface).

## The finding that should change how you start
**A precondition satisfied by the state it is meant to replace cannot fail**, and four
investigations in two days went to it: `meal-label`'s ink gate read the **previous** style's canvas;
`quantity-editor-option-a`'s `Ingredients` marker is on the sheet underneath too;
`meal-photo-picker` waited for a name the screen being **left** still carries, so the file went
there; and BF-39's swipe measured a row the sheet had not finished moving. **Four times the app was
right and the harness was wrong.** Ask what your gate is true of *before* the thing you want, and
pick a marker — or a moment — that exists **only** in the target state.

## Do not re-litigate
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
**Nothing from the last four runs is device-verified.** [`device-verification-queue.md`](../../device-verification-queue.md)
groups by screen — work a section, not an entry.

**This run adds one coherent nutrition pass**, best done in a sitting: a food row **swipes** to a
Delete that opens on the **first** tap and stays gone across a screen swap and a force-close (BF-47
reasoned, not reproduced); the meal photo from **both** the meal's screen and the builder — the CSP
fix runs the *native* branch for the first time; a **barcode scan** in the builder; **Option A** at
412 dp; an ingredient row reading **grams only**; a logged meal as **one nested row** whose name
survives **offline**; and the takeover sheets' bottom clearance in **both** navigation modes.

Carried: Q-467, Q-499, Q-538, Q-305 at S25 width, Q-477 across local midnight, BF-10, LB-5, Q-328/Q-321/Q-486, Q-389, a TalkBack pass, Q-450/Q-418 (Polar H10). **Q-315 needs a DESKTOP.**

## Claimed paths
None held.

## Gotchas worth carrying
- **`main` will land a PR under YOUR open one**, and `total_count: 0` follows. That zero has
  **three** causes: stale base, runner backlog, **wedged run** (`rerun` 403 / `cancel` 409; the only
  way out is a new commit with real content, never an empty one).
- **E2E takes 15–40 min and it CATCHES REAL BUGS** — two on one PR this run, a third on another.
  **Never dismiss a red E2E as flake without reading the log.** When it cannot be informative
  (docs/scripts; a re-push whose diff against an already-green head is version/changelog only),
  merge on the five required checks and say so.
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
  settle; `toBeInViewport()` does not). Also **centre a row** (its natural spot is under the tab
  bar), **hide the Next.js dev overlay**, **scope assertions to the sheet** (three mounted layers
  say "Protein"), and remember **`getByText` matches SUBSTRINGS**.
- **`deleteFoodLog` writes a tombstone** — a count ignoring `deleted_at IS NULL` *passes* on a
  broken delete.
- **`SegmentedTabs` renders `role="tab"`**, takes `orientation="vertical"`, and the 48 dp floor is
  per segment — a stacked toggle is 96 px and its neighbour must match.
- **Never merge `main` or edit the tree while a local e2e run is live** — the tell is
  `Parsing ecmascript source code failed` with tests at **0ms**.