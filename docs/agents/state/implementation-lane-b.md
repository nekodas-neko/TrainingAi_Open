# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-02 · **By:** the twenty-first Lane B run · **Next ID:** `LB-52`

## Now

**Merged this run:** BF-82, LA-45, Q-531, BF-64, BF-99, BF-100, LB-46, BF-103 (#773), BF-101 (#776),
LA-52 (#779), Q-187 (#782). `main` is at **v1.428.0**. **Nothing has been near a device** — the owed
list is now ~17 screens.

**Also this run, and worth as much as the code:** BF-104 and BF-102 were split into **LB-49** and
**LB-50** because their Lane B halves each needed Lane A engine work first; **Q-297** was closed down
to two residues, one of them the owner's; **Q-138** was reclassified `Reference:`. Lane B's READY
list went from **11 entries to 5**, and the five are genuinely startable.

### The habit that mattered most: mutate every assertion before believing it

Four guards this run passed on first write and were **wrong**, each caught only by mutating the fix
away:

- `.map(displayBodyFat)` **point-free survived a sed** that changed nothing — a mutation that does
  not change the file is not a mutation. Re-mutated as `.map(r => r.bodyFat)`, which fails.
- The Q-187 wiring guard matched `/rescaleRemaining\(\{/` **anywhere in the file**, so
  `const rescale = null && rescaleRemaining({…})` passed it: text present, feature dead. **Anchor on
  the assignment**, not on the call appearing.
- A `check-*.js`-shaped scan **found its own matcher and its own test name** (#773 → #775), and
  `main` went red on it. A source scan's first finding is very often its own documentation.
- An e2e spec passed **once** and would then have failed forever, because its own successful run left
  the value it asserted on already correct (BF-101's steps goal at 10,000). **Drive the field to a
  known-different value first**, and run the spec twice before believing it.

### A spec that fails for its own reasons looks exactly like a broken feature

BF-100 cost four spec traps and six implementation traps, all reporting the same
`expected 840, received 0`. And I published a wrong finding from one — "tab-to-tab scroll is broken"
— which was never true: the shell keeps tab screens mounted, so Health's container read 840 while the
URL said `/nutrition`. **Instrument the run before drawing a conclusion from it.**

### Measure production before designing around a fixture

`/api/admin/db-query` settled LB-46 in two minutes (**not a bug** — `reevaluateForToday` self-reverts
per-exercise deloads, and the card was faithful). The same query then showed **BF-64, merged hours
earlier, may revert nothing on a real session-level deload**: of 5 stored prescriptions, 1 has a
session deload, 2 have per-exercise, **0 have both**, and BF-64 reused the second mechanism to
implement the first. Filed as **LB-47**, not reverted. **A hand-built fixture combining two
mechanisms production keeps apart is not evidence.**

### An entry can be confidently wrong about its own code

Q-187 said `fillableMeals` *"already answers which meals are still ahead of you, which is exactly the
set a re-scale would act on."* It answers the **opposite** — meals whose hour has already *come*,
because logging food nobody ate is what it exists to prevent. Using it would have handed a skipped
lunch's calories to dinner. **Read the helper, not the entry's description of it.**

## Do not re-litigate

- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`,
  `lib/cache-groups.ts` are Lane A** whatever the edit looks like — the **path**, not the nature of
  the edit. `lib/health/*` counts when an API route reaches it. Under `lib/walk/`, only
  `segment-stats.ts` is API-reached: `walk-pacer.ts` and `interval-plan.ts` are **Lane B's**.
  `scripts/**` is the Orchestrator's — except a shrink-only baseline line the check itself demands
  you remove.
- **A Lane B half that needs a Lane A argument is TWO entries.** Do not build across the line and do
  not skip the entry — split it, `Needs:` the engine half, and the queue tool parks it correctly.
  LB-49 and LB-50 are the worked examples.
- **Q-354 is live and is a trap for spec authors, not a user bug.** `locator.click()` does **nothing**
  on the Nutrition screen — the date-swipe `useDrag` binds mouse and pointer and swallows it, which is
  what Playwright sends. Use `tapCentre`. Measured again on Q-187: a *forced* click on `Show N meals`
  leaves `aria-expanded` at `false`; a touch tap at the same coordinates opens it every time.
  **On More, `.click()` works fine** — the trap is Nutrition-specific.
- **An e2e spec CAN talk to Postgres** — `new Client({ connectionString: process.env.DATABASE_URL })`,
  as `food-logging-complete.spec.ts` and `plan-rescale.spec.ts` do. This is usually better than
  stubbing a route: it works on CI's fresh database and it exercises the page's own pipeline.
  **`scripts/local-db/seed.sql` creates no meal plan and no `food_logs`**, so anything touching those
  builds its own fixture and tears it down in `afterAll`.
- **A `memo`ed row inside a `.map()` takes SCALARS.** A hook is not allowed there and an object
  literal is re-created every render, defeating the memo while the component keeps its wrapper.
  `meal-macro-bars.tsx` and `plan-meal-row.tsx` are the references; `check-memo-prop-stability.js`
  enforces it.
- **BF-79's placement:** identity and body facts on `app/more/details/`; weight and body fat
  **read-only** there (an input is a second write path into `body_metrics`); targets and activity
  level stay in Goals.
- **`stableBox`/`tapCentre` before any coordinate dispatch OR geometry assertion** — neither
  `touchscreen.tap` nor `Input.dispatchTouchEvent` checks actionability.
- **`hydrateUserPreferences` NEVER deletes a key the bag lacks.** **A mirror effect uses
  `usePersistedPreference`, never `savePreference`.** **A `fetch()` of a `data:` URL is a
  `connect-src` request** and the CSP forbids it.
- **`min-h-[Npx]` does nothing on a `<button>` or `role="button"`** — a bare element-selector floor in
  `globals.css` beats the utility. Drive height with padding.
- **A route with no caller fails no test** — when an entry says a storage half shipped, grep for a
  client caller before believing the feature exists.
- **`/more` SSRs a skeleton** — a `curl` finds none of the tab content and that is not a bug. Use
  Playwright, or fetch the sub-route directly.

## Owed (device / physical)

**Nothing from the last eight runs is device-verified.**
[`device-verification-queue.md`](../../device-verification-queue.md) groups by screen — work a
section, not an entry.

Added this run: **BF-82** (the whole More tab re-grouped, bottom actions row moved — clearance under
Sign Out is unchecked); **LA-45** (the body-fat card extracted); **Q-531**; **BF-64** (and see LB-47
before trusting it); **BF-99**; **BF-100** (scroll restoration — the whole feature is a device claim);
**BF-103** (`My Foods` is longer than `Meals` and three tabs share 412 dp); **BF-101** (six controls
in an already-dense collapsible, offer button two lines tall); **LA-52** (slowing mid-segment and
stopping at a crossing — LB-36's device checks 2 and 3, which could not have passed before it);
**Q-187** (two numbers now share a line that held one).

Carried: BF-57 needs **two phones, two accounts and a printer**; BF-75's contrast; Q-410's cadence and
HR rungs need a **Polar H10**; LB-34 needs a camera; Q-315 needs a **desktop**; a TalkBack pass.

## Claimed paths

None held.

## Gotchas worth carrying

- **`git fetch origin main` RE-SHALLOWS this clone** — the tell is `refusing to merge unrelated
  histories`, and also `git log origin/main` printing **one** commit and `merge-base --is-ancestor`
  answering `no`. Fix with `git fetch --unshallow origin`. It happened repeatedly this run, and once
  made me misread the merge order and report that a PR had merged over a red `main` when it had not.
- **Never check a gate through a pipe** (`pnpm check:rules | tail` exits with tail's status) **and
  never chain the push onto the same line as the gate** — `check:rules > f; git commit && git push`
  pushes whatever the gate said, because the push depends on the *commit's* status. Read the result,
  then decide, in a separate call.
- **Check for conflict markers BEFORE `git add -A`.** `git status | grep '^UU'` reports nothing once
  they are staged, so `git add -A; git status | grep UU` always says clean.
- **After every merge, diff the `^### ` headings against `origin/main`** (`comm -13` / `comm -23`).
  That answers "did I resurrect or drop an entry" in one command and does not depend on getting the
  two-deletions rule right by reading. A backlog conflict can be **both** shapes in one hunk.
- **`docs/doc-size-baseline-history.md` is APPEND-ONLY** — a conflict there is two *additions*, keep
  both. **Recompute every `.size` from the merged file; never keep either side of the conflict.** On
  one branch this run the number was recomputed **three times** as the base moved underneath it, and
  neither side of any conflict was ever right.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:…`; never splice a hunk** — the
  conflict falls inside a `changes:` array and both sides share the version header above the marker.
- **`get_check_runs` lags by 20+ minutes and can read `total_count: 0` on a PR whose CI is running.**
  `0` several minutes after a push usually means a **stale base** — fetch, merge, push. When it looks
  frozen, **attempt the merge**: it validates against real branch protection and refuses if a
  required check has not passed. That is the reliable read, and it worked three times this run.
- **E2E is NOT a required check** — measured 2026-09-01, PR #776 merged with its E2E job still
  `in_progress`. Making it required is branch protection, which is the owner's call (Q-297).
- **Playwright needs `DATABASE_URL` prefixed in** — the session-start hook unsets it.
- **A backgrounded shell dies when the tool call returns.** A long mutation sweep must run in the
  foreground with an explicit timeout, or it is silently truncated part-way — and it will leave a
  mutation applied to your working tree. Diff against a snapshot afterwards.
- **`tsc` TYPECHECKS NOTHING UNDER `__tests__`** (LB-37) — `e2e/` **is** checked normally.
- **Importing a constant can 500 a page that `tsc` says is fine** — a transitive `node:fs/promises`.
  Run the page, not just the compiler. Traverse the import graph before pulling from a new module.
- **Custom Rules catches real bugs in code COPIED from a passing file** — a grandfathered pattern is
  not an allowed one.
- **`scripts/__tests__/dead-repo-methods.test.ts` writes a real `lib/zz-…-probe.ts` and deletes it.**
  A one-file suite failure naming a `zz-` path is that, not you.
- **The check:rules count is `Ran N of N` and moves** — never hardcode it, never quote "pass". It was
  **67 of 67** for this entire run.
