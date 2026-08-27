# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-27 · **By:** the fifteenth Lane B run · **Next ID:** `LB-23`

## Now
Merged this run: **#568** (BF-11f meal-type tags), **#570** (LB-20), **#573** (BF-11h the planner's
library surface), **#575** (PS-14), **#576** (BF-40 recipe pictures), **#577** / **#578** / **#579**
(queue corrections). Filed: **LB-21** (Lane A), **LB-22**. Nothing open.

**Read this before picking an item: Lane B's queue has no startable, correctly-laned work at the
top.** Positions 1–10 are a reference entry (BF-28 — that is LB-22), LB-19 (deliberately
unscheduled), LB-12 (the sweep is the Orchestrator's), four device-gated entries, TN-13 (moved to
Lane A, #578), and unlaned rows that resolve to Lane A by the path rule (Q-275 → `readiness-payload.ts`
which three routes consume; Q-524 → both halves, so A first; Q-272 → scoring).

**The one genuinely Lane B item is Q-282, and it is blocked on a DECISION, not on work.** Its
linter half shipped; what is left — touch targets and contrast — needs a rendered page. Its Espresso
scope needs the emulator (Q-250, unlanded), while `@axe-core/playwright` against the existing E2E job
would do it today. The entry says re-scoping *and* implementing in one pass wants the owner or the
Orchestrator. **Do not decide it yourself.** Put it to the owner: axe-core on the current harness,
shrink-only baseline so existing violations record rather than block; the cost is one dependency and
a gate that could go flaky; reversing it is deleting a CI step.

**So the honest state is that Lane B is blocked on an S25 pass.** Five gated entries want it, plus
everything below.

## The finding that should change how you start
**Treat every entry as a hypothesis. Ten premises were wrong or stale this run** — and two of them
decided *whether the work was even mine*. TN-13's *"the payload field already exists"* was false, and
that is why it is Lane A's. BF-11's ⚠ described two live defects, both already closed, one by a
different entry than it credited. PS-14's stated mechanism was wrong outright, and **testing it is
what found the real one** — a probe passed 8 for 8 where the entry predicted failure.
**Check the file/line claims before writing code, and re-read an entry's own pass test before
shipping half of it**: TN-13's forbids the half Lane B could have done alone.

## Next
`node scripts/next-item.js --lane B` first — but read past position 6, which is where I stopped and
was wrong to. Then apply the path rule to each candidate yourself.

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**` are Lane A** whatever the edit
  looks like. The rule is the **path**, not the nature of the edit. `lib/health/readiness-payload.ts`
  counts: three routes consume it.
- **Back-dismissal's decision logic is [`lib/hooks/sheet-back-stack.ts`](../../../lib/hooks/sheet-back-stack.ts)**,
  with the hook reduced to React wiring. Two mechanisms, both load-bearing: **depth** and a
  **module-level self-pop counter**. Reverting either fails its own tests. Never call
  `useSheetBackDismiss` at a call site. **Its three-deep case is covered ONLY by those unit tests.**
- **Log Food is one sheet per screen.** `FoodLoggerSheet` renders **no sheet of its own** at
  `capture`; `SavedMealsSheet` is the screen.
- **`kept` and `library` both carry a `savedMealId`.** Anything deciding provenance reads
  `DraftMeal.source`, never the id — that check is what made the planner's picks claim to be the
  user's own pins.

## Owed (device / physical)
**Nothing this run is device-verified**, and that is now the binding constraint rather than a note.
[`device-verification-queue.md`](../../device-verification-queue.md) groups Lane B's `Gate: device`
entries by screen — work a section, not an entry. **Start at N4**, the rebuilt Log Food screen;
several Nutrition items are reached *through* it. This run adds: meal-type tags, the planner's
library toggle / why-this-meal / reroll swap / reduction prompt, and the recipe-picture import —
whose **native `Camera.getPhoto` branch is the path the owner will actually use and is unexercised**.
Carried: Q-467, Q-499, Q-538, Q-305 at S25 width, Q-477 across local midnight, BF-10, LB-5,
Q-328/Q-321/Q-486, Q-389, a TalkBack pass, Q-450/Q-418 (needs a Polar H10). **Q-315 needs a DESKTOP.**

## Claimed paths
None held.

## Gotchas worth carrying
- **`get_check_runs` returning `total_count: 0` has THREE causes** — a stale base, a runner backlog,
  and a **wedged run**. A run that has not started creates no check runs, so the zero says nothing;
  read `actions_list`/`get_workflow_run` before concluding, and never re-push on the strength of it.
- **A run can wedge in a state GitHub will neither cancel nor re-run.** `rerun` → 403 "already
  running", `cancel` → 409 "not been queued yet" is the signature. No dispatch trigger exists, so the
  only way out is a **new commit**; `concurrency: cancel-in-progress` supersedes the wedged run.
  **Push real content, never an empty commit.**
- **E2E takes 15–40 min and the base WILL drift under it.** Merge on the five REQUIRED checks when
  E2E cannot be informative — a docs/scripts change, or a re-push whose diff against an
  already-E2E-green head is version/changelog only. Say so plainly when you do.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:...`; never splice a hunk.**
  Then check every earlier version string still appears exactly once.
- **`git fetch origin main` RE-SHALLOWS this clone.** The tell is `merge-base` returning nothing and
  git refusing "unrelated histories" against your own `main`, with a queue read that looks stale.
  `test -f .git/shallow && git fetch --unshallow origin`.
- **After every merge `grep -c '^### .*<your-id>'` the backlog** — the two-deletions trap auto-merges
  with no conflict markers.
- **`Lane:` and `Gate:` are FIELDS** — each needs its own bullet at line start.
- **`projectOverview.md` sits ON its ratchet.** Delete whole lines; rewording lands line-neutral.
  Retiring a `closed (2026-08-2x)` note that carries its own journal link is the honest lever, and
  I have taken the easy ones — expect to trim your own paragraph instead.
- **Never merge `main` or edit the tree while a local e2e run is live.** The tell is
  `Parsing ecmascript source code failed` and tests at **0ms**. Committing mid-run is safe.
- **`SegmentedTabs` renders `role="tab"`, not `role="button"`.**
- **Guard every open-the-sheet retry with `if (await page.getByRole('dialog').count() === 0)`** — a
  retry that re-taps a button the open sheet aria-hides finds nothing.
- **A shared write path is verified with the FULL e2e suite, never hand-picked specs.** It earned its
  fifteen minutes twice this run: it caught the failure that became PS-14, and a DB-pollution defect
  in my own new spec that CI would have hidden forever.
- **For "the write did not land", read the Playwright trace, not the screenshot.** Unzip
  `test-results/<spec>/trace.zip` → `0-trace.network` → `request.postData._sha1` into `resources/`.
  An absent key rather than a wrong value points at the function's argument, not the state.
- **`goal-invalidation.spec.ts:57` fails in this sandbox on `main` too** — LB-19 carries it, it is
  green on CI, and it failed on every full run this session. Do not spend a session on it.
