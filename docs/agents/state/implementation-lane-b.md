# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-31 · **By:** the seventeenth Lane B run · **Next ID:** `LB-31`

## Now
Merged: **#628** (LB-26), **#633**, **#640** (BF-45 ⑤), **#631** (Q-392), **#641** (BF-46 ①b),
**#642** (BF-46 ② ③), **#643** (BF-46 ①a), **#644** (the BF-39 hold, docs only). Filed: **LB-27**,
**LB-28**, **LB-29**, **LB-30**.

**BF-39 shipped: its hold was a harness race, not a defect.** `SwipeActions` mounts once, the drag
handler is **never invoked**, and no `saved-meals` invalidation fires — `Input.dispatchTouchEvent`
skips the stability check `locator.tap()` does, so the spec measured a row still travelling with the
sheet's `enter` animation (read y=605, landed at y=503). `swipeRowLeft` (`e2e/fixtures.ts`) waits
for the rect to settle and the three swipe specs share it; **LB-30** audits the other 46 reads.

**The `nutrition-ui-uplift` batch is now shipped in full** — BF-24, BF-39, BF-45, BF-46, BF-51 ①②④ —
**and every one owes the on-device pass.** That is this lane's binding constraint, not a queue of
unwritten code. BF-39 also has a branch **no test has ever run**: `useSavedMealSummaries`'s
local-store read, unreachable from the web harness.

**Three things are blocked on the owner, each with a written recommendation. Do not decide them
yourself and do not build past them:**
- **BF-51 ③.** The picker has ONE collection shown two ways (`Recently used` empty, `Your foods`
  typed) plus the food database, which appears only while typing — so Log Food's three-tab strip
  does not map onto it, and a database tab hides what BF-48 shipped to expose. **Recommended: fold
  into BF-52's planning session**, which redesigns the top of the same screen.
- **LB-29.** Recommended: a dirty mark that re-PATCHes the local value. Seed-if-absent cannot
  clobber but gives up cross-device updates. **They promise different things.**
- **The device pass.**

**Startable without the owner: LB-28 and LB-30.** LB-28's `Needs: LB-27` parks it in
`next-item.js`, and that dependency is worth re-reading rather than obeying — LB-27 asks *why* one
request strands a launch burst; the rule is about a helper whose network cost is invisible at the
call site, and stands either way. Past those, `--lane B` holds BF-52 (**planning**), LB-12
(Orchestrator's), and a readiness/DB cluster (Q-275, Q-272, Q-276, Q-279, Q-283) the path rule puts
in **Lane A**. **Q-278** is the one plausible B item — narrowed to a one-layer addition with **one**
migration site (`components/health/readiness-breakdown.tsx`) — but it has **no plan** and an open
scope question (two of its five "pillars" have no score surface). Plan it before building it.

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
**Nothing from the last three runs is device-verified.**
[`device-verification-queue.md`](../../device-verification-queue.md) groups by screen — work a
section, not an entry.

**This run adds one coherent nutrition pass**, best done in a sitting: a food row **swipes** to a
Delete that confirms **and stays gone across a screen swap and a force-close** (BF-47, reasoned not
reproduced); the meal photo picks from **both** the meal's screen and the builder — the CSP fix runs
the *native* branch for the first time; **Option A** at 412 dp, tallest of the three and may scroll;
an ingredient row reading **grams only**; a logged meal as **one nested row** whose name survives
**offline** (that branch never ran in the sandbox).

Carried: Q-467, Q-499, Q-538, Q-305 at S25 width, Q-477 across local midnight, BF-10, LB-5,
Q-328/Q-321/Q-486, Q-389, a TalkBack pass, Q-450/Q-418 (Polar H10). **Q-315 needs a DESKTOP.**

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