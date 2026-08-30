# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-30 · **By:** the sixteenth Lane B run · **Next ID:** `LB-26`

## Now
Merged this run: **#587** (Q-112a, one door for the day review), **#590** (three stranded e2e
assertions), **#592** (Q-112b, the read-through inside the wrap-up), **#595** (LB-19's premise
replaced). Filed: **LB-23**, **LB-24**, **LB-25**. Open: the `Reference:` field PR (LB-22).

**Lane B's nutrition queue is finished.** The artboard-parity set (BF-24, BF-26, BF-29/30/31, LB-16)
has shipped or sits on a device gate; the Q-112 chain hands to Lane A at **Q-112c**, which blocks
Q-112d and Q-112e; **Q-524** is tagged `[nutrition]` and reaches four `app/api` routes, so it is
Lane A by the path rule; **LB-25** (body temperature has no route at all) is Lane A.

**What is genuinely left for B, in order:** LB-19's remaining half (`meal-label`'s repaint race —
the mechanism is written down, the probe it needs is not), then **Q-282**, which is blocked on a
DECISION not on work. Q-282's linter half shipped; touch targets and contrast need a rendered page.
Its Espresso scope needs the emulator (Q-250, unlanded), while `@axe-core/playwright` against the
existing E2E job would do it today. **Do not decide it yourself** — put it to the owner: axe-core on
the current harness, shrink-only baseline so existing violations record rather than block; the cost
is one dependency and a gate that could go flaky; reversing it is deleting a CI step.

## The finding that should change how you start
**Treat every entry as a hypothesis, including one Lane B wrote itself.** LB-19 said two flaky specs
were a sandbox time budget and prescribed `test.setTimeout`. Measuring both showed neither is:
`goal-invalidation` failed on a locator that never resolves because the seed's newest steps row was
five days old, and `meal-label` fails intermittently on a canvas read that its own ink poll cannot
guard. **The prescription would have fixed neither, and the entry told the next session not to look.**
Ten premises were wrong or stale the run before, two of them deciding whose lane the work was.
Check the file/line claims before writing code.

## Next
`node scripts/next-item.js --lane B` first — and it now has a **REFERENCE** section, so a map entry
no longer heads the list. Read past position 6 and apply the path rule to each candidate yourself.

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**` are Lane A** whatever the edit
  looks like. The rule is the **path**, not the nature of the edit. `lib/health/readiness-payload.ts`
  counts: three routes consume it.
- **`scripts/**` is not answered by the path rule.** LB-22 was taken by Lane B on the ambiguity rule
  — B filed it and B is the tool's user. Record the claim if you take another.
- **The day read-through has ONE implementation.** `components/health/day-detail/day-read-through.tsx`
  is rendered by `/health/day` **and** the evening wrap-up, off the same `day-log:<date>` key. Do not
  add a fetch to it: the two hosts need different strategies.
- **`EndOfDayReview` is rendered unconditionally** — `open` only drives Radix. A hook in its body
  fires on every Nutrition visit; anything that fetches goes in a child of `SheetContent`.
- **Back-dismissal's decision logic is [`lib/hooks/sheet-back-stack.ts`](../../../lib/hooks/sheet-back-stack.ts)**,
  with the hook reduced to React wiring. Two mechanisms, both load-bearing: **depth** and a
  **module-level self-pop counter**. Never call `useSheetBackDismiss` at a call site. **Its
  three-deep case is covered ONLY by those unit tests.**
- **Log Food is one sheet per screen.** `FoodLoggerSheet` renders **no sheet of its own** at
  `capture`; `SavedMealsSheet` is the screen.
- **`kept` and `library` both carry a `savedMealId`.** Anything deciding provenance reads
  `DraftMeal.source`, never the id.

## Owed (device / physical)
**Nothing from the last two runs is device-verified**, and that is the binding constraint.
[`device-verification-queue.md`](../../device-verification-queue.md) groups Lane B's `Gate: device`
entries by screen — work a section, not an entry. **Start at N4**, the rebuilt Log Food screen.
These runs add: the day review's single door (the reminders' `extra.route` is inert off Android),
the wrap-up's taller sheet and its second footer button, meal-type tags, the planner's library
surface, and the recipe-picture import — whose **native `Camera.getPhoto` branch is the path the
owner will actually use and is unexercised**. Carried: Q-467, Q-499, Q-538, Q-305 at S25 width,
Q-477 across local midnight, BF-10, LB-5, Q-328/Q-321/Q-486, Q-389, a TalkBack pass, Q-450/Q-418
(needs a Polar H10). **Q-315 needs a DESKTOP.**

## Claimed paths
None held.

## Gotchas worth carrying
- **`main` lands a PR every few minutes.** Two merges failed with `405 has merge conflicts` between
  a clean base check and the merge call. Expect to re-merge and re-resolve; keep PRs tight.
- **A backlog conflict is not always two deletions.** One this run was main **adding** an entry
  directly above one this branch had **rewritten** — keep both sides would restore the old heading,
  keep one drops the new entry. Read the headings before choosing, every time.
- **`get_check_runs` returning `total_count: 0` has THREE causes** — a stale base, a runner backlog,
  and a **wedged run**. A run that has not started creates no check runs, so the zero says nothing.
- **A run can wedge in a state GitHub will neither cancel nor re-run.** `rerun` → 403, `cancel` →
  409 is the signature. The only way out is a **new commit** with real content, never an empty one.
- **E2E takes 15–40 min and the base WILL drift under it.** Merge on the five REQUIRED checks when
  E2E cannot be informative — a docs/scripts change, or a re-push whose diff against an
  already-E2E-green head is version/changelog only. Say so plainly when you do.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:...`; never splice a hunk.**
  Re-check the version: `main` took the number twice while a PR of mine was open.
- **`git fetch origin main` RE-SHALLOWS this clone.** The tell is `merge-base` returning nothing.
  `test -f .git/shallow && git fetch --unshallow origin`.
- **After every merge `grep -c '^### .*<your-id>'` the backlog** — the two-deletions trap auto-merges
  with no conflict markers.
- **`Lane:`, `Gate:`, `Keep:` and now `Reference:` are FIELDS** — each needs its own bullet at line
  start. `check-backlog-pointers.js` fails on a `Reference:`-worthy entry that states it in prose.
- **`projectOverview.md` sits ON its ratchet.** Delete whole lines; rewording lands line-neutral.
  Trimming the oldest dated notes (they carry journal links) is the honest lever.
- **Never merge `main` or edit the tree while a local e2e run is live.** The tell is
  `Parsing ecmascript source code failed` and tests at **0ms**.
- **A red local vitest run is worth attributing before it is believed.** One this run was branch
  staleness: another session had just fixed that exact test on `main`.
- **`SegmentedTabs` renders `role="tab"`, not `role="button"`.**
- **Guard every open-the-sheet retry with `if (await page.getByRole('dialog').count() === 0)`.**
- **A shared write path is verified with the FULL e2e suite, never hand-picked specs.**
- **Screenshot a new screen at 412 dp before shipping it.** Two accessible-name collisions on the
  stepped wrap-up were invisible in the diff and obvious in the picture.
- **`getByText` matches SUBSTRINGS.** A short step title sat inside a sentence one line below it.
