# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-30 · **By:** the seventeenth Lane B run · **Next ID:** `LB-30`

## Now
Merged: **#628** (LB-26), **#633**, **#640** (BF-45 ⑤), **#631** (Q-392), **#641** (BF-46 ①b),
**#642** (BF-46 ② ③). Open, queued to merge on green: **#643** (BF-46 ①a), **#644** (BF-39).
Filed: **LB-27**, **LB-28**, **LB-29**.

**The whole `nutrition-ui-uplift` batch is shipped** — BF-24, BF-45, BF-46, BF-51 ①②④, BF-39 — **and
every one owes the same single thing: the on-device pass.** That is this lane's binding constraint,
not a queue of unwritten code.

**Three things are blocked on the owner, each with a written recommendation. Do not decide them
yourself and do not build past them:**
- **BF-51 ③.** The picker has ONE collection shown two ways (`Recently used` empty, `Your foods`
  typed) plus the food database, which appears only while typing — so Log Food's three-tab strip
  does not map onto it, and a database tab hides what BF-48 shipped to expose. **Recommended: fold
  into BF-52's planning session**, which redesigns the top of the same screen.
- **LB-29.** Recommended: a dirty mark that re-PATCHes the local value. Seed-if-absent cannot
  clobber but gives up cross-device updates. **They promise different things.**
- **The device pass.**

**Almost nothing else is startable.** Past the nutrition entries `next-item.js --lane B` holds
BF-52 (**planning**), LB-12 (Orchestrator's), and a readiness/DB cluster (Q-275, Q-272, Q-276,
Q-279, Q-283) the path rule puts in **Lane A**. **Q-278** is the one plausible B item — an audit
narrowed it to a one-layer addition with **one** migration site
(`components/health/readiness-breakdown.tsx`) — but it has **no plan** and an open scope question
(two of its five "pillars" have no score surface). Plan it before building it.

## The finding that should change how you start
**A precondition satisfied by the state it is meant to replace cannot fail.** Three investigations
in one day, one of which had already cost a previous session:
- `meal-label`'s ink gate read the **previous** style's canvas, so it passed on the wrong label.
- `quantity-editor-option-a`'s "builder is open" marker was its `Ingredients` heading — the detail
  sheet underneath has one too, so the gate opened before Edit was tapped.
- `meal-photo-picker` waited for the picker's accessible name. The screen being **left** is still in
  the DOM while it closes and carried the same name, so the file went there — which is the "the
  picture reaches nothing" failure a previous session held BF-46 ①a for. **The app was right and the
  harness was wrong.**

Ask what your gate is true of *before* the thing you want. Pick a marker that exists **only** in the
target state (`Update Meal`, `Log this meal`).

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
- **The diary groups on `meal_group_id`, never `saved_meal_id`.**
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
the *native* branch for the first time and it now toasts instead of failing silently; **Option A**
at 412 dp, tallest of the three and may scroll; an ingredient row reading **grams only**; a logged
meal as **one nested row** whose name survives **offline** (that branch never ran in the sandbox).

Carried: Q-467, Q-499, Q-538, Q-305 at S25 width, Q-477 across local midnight, BF-10, LB-5,
Q-328/Q-321/Q-486, Q-389, a TalkBack pass, Q-450/Q-418 (Polar H10). **Q-315 needs a DESKTOP.**

## Claimed paths
None held.

## Gotchas worth carrying
- **`main` will land a PR under YOUR open one.** Both PRs open at the end of this run went
  `total_count: 0` — a stale base — because a sibling merged after their last `main` merge. That
  zero has **three** causes: stale base, runner backlog, **wedged run** (`rerun` 403 / `cancel` 409;
  the only way out is a new commit with real content, never an empty one).
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
- **In a spec: centre a row before a coordinate tap** (its natural spot is under the tab bar),
  **hide the Next.js dev overlay** near the bottom-left, **scope assertions to the sheet** (three
  mounted layers say "Protein"), and remember **`getByText` matches SUBSTRINGS**.
- **`deleteFoodLog` writes a tombstone.** A count ignoring `deleted_at IS NULL` would *pass* on a
  broken delete.
- **`SegmentedTabs` renders `role="tab"`** and takes `orientation="vertical"`; the 48 dp floor
  applies per segment, so a stacked toggle is 96 px and its neighbour must match.
- **Never merge `main` or edit the tree while a local e2e run is live** — the tell is
  `Parsing ecmascript source code failed` and tests at **0ms**.
