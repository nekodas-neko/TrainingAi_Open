# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-02 · **By:** the twenty-second Lane B run · **Next ID:** `LB-52`

> **A mistyped ID in this file silently advances the whole lane's numbering.** The previous baton
> wrote an `LB-` number in the hundreds where it meant a `BF-` one, and
> `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` — the command CLAUDE.md tells you to
> allocate with — dutifully returned it. **Check the max it reports is an entry that actually exists**
> (`grep -rn` for it and look for a `### ` heading). This note deliberately does not spell the bad id
> out: writing it here would keep it winning the sort, which is the trap it is warning about.

## Now

**Merged this run:** BF-104 (#793), BF-109 (#796), LB-47 (#798), LB-38 analysis (#799), Q-407 (#804),
Q-407 routing (#805), LB-38 second capture (#806), LB-38 refutation (#807). `main` is at **v1.433.0**.
`pnpm check:rules` read **Ran 67 of 67** for the entire run.

**Nothing has been near a device** — ~35 screens owed.

**READY is LB-38 alone**, and it is a research task rather than a build: see below. Everything else in
Lane B is `KEEP:` residue, `VERIFY:` device checks, or waiting on the owner. **A successor with no
device should expect to reach the end of what can proceed and say so** rather than starting a KEEP
entry.

### Waiting on the owner

- **LB-47: on a real session-level deload the intensity toggle vanishes silently.** No control, no
  reason given. One explanatory line where it would be is cheap and probably right; it is a product
  call.
- **LB-47: a real "run this at full intensity" path** needs a regeneration `/prescribe` cannot do —
  the route takes no intensity input. Lane A plus the owner.
- **Q-407's remainder is now Lane A's** (#805): the coach does not yet open by stating what it already
  knows instead of asking. Prompt and tool ordering in `lib/coach/**`.

## The six lessons this run actually cost something

### 1. A guard matching text that survives the feature being disabled is not a guard

**Six instances.** Every one passed on first write and was caught only by mutating the fix away:
`expect(src).toContain('<MacroCalorieWarning')` against `{false && …}`; `/rescaleRemaining\(\{/`
against `const rescale = null && …`; an e2e `toHaveCount(0)` against a page that failed to render; and
on LB-47 a split check — `indexOf` for the condition, `toContain` for the sentence — that passed
against `{false ? "This prescription lowered…"`, because the unreachable branch's text is still in the
file **and** the same condition appears in the heading ternary above.

**Pin the condition and its consequent in ONE pattern.** Never as two assertions. And put a positive
anchor before every absence check.

**Verify the mutation applied** (`grep` for it) before recording that a test survived — a mutation
that does not change the file is not a mutation.

### 2. An entry can measure right and conclude wrong — check what the SCREEN does

**LB-47** measured production to the row and concluded the `Full` override "reverts nothing". The
figures held exactly — but on that prescription the toggle **is not rendered at all**
(`phase: 'deload'` → `isDeloadActive` → `pre-workout-screen.tsx` gates the control on it), so the fix
it proposed was already the behaviour and the real defect was a card *claiming* a revert.

### 3. `next-item.js` reads FIELDS, not prose — twice, two different ways

- A `Keep:` rewrite that drops `Lane:` and `Verify:` makes an entry print as `⟨lane unstated⟩` with an
  empty note (BF-109).
- **A shipped Lane B half needs its `Lane:` re-routed or the entry sits in NEITHER queue** (#805).
  Q-407 carried a prose paragraph naming its split since August; the runner never read it, so after
  the B half shipped it still headed Lane B's READY list while Lane A could not see it at all.

### 4. Do not compare a number against a band measured somewhere else

LB-38's dump read ink **0.0807** against a recorded band of **0.172–0.179** — half, a textbook
mid-repaint signature. I wrote it up as confirming the hypothesis and built the gate for it. Ink is
**per-style**: `Ingredients · centred` reads **0.0800** on a passing run. The band belonged to another
test's style. The gate was reverted unshipped.

**The check that caught it was cheap and generic: measure the healthy case before shipping a fix.**

### 5. `grep -E "passed|failed"` on a Playwright run lies, twice over

`tail -1` returns `2 passed` for a run that **failed** (failures print first, the duration goes on the
last summary line), and the `[WebServer]` lines contain `0 failed`, so grepping the output for
`failed` matches a clean run. Both misread a run here. **Detect failure by an artefact, not text.**

### 6. A timed-out mutation sweep leaves a mutation applied

The 10-minute tool timeout cut a sweep mid-loop, so the restore never ran and the mutation stayed in
the tree. **Diff before continuing**, and run the rest one at a time.

## LB-38 — where it actually stands

**Three confident readings, all mine, all wrong, all caught by one more measurement rather than more
thought** — the ink band (lesson 4); a matrix diff of 134/625 between runs that use *different meals*;
and a render race whose mechanism required styles to encode different payloads, when every style logs
`len=22` with the same token and the renders never interleave anyway. Full workings in
[`2026-09-02-lb-38-symbol-is-perfect.md`](../../overview/entries/2026-09-02-lb-38-symbol-is-perfect.md)
and [`2026-09-02-lb-38-race-refuted.md`](../../overview/entries/2026-09-02-lb-38-race-refuted.md).

**Established:** the failing symbol is geometrically perfect (25×25 at exactly 13 px, textbook timing
and alignment), its format info matches a passing symbol's, and it decodes to null under all four
binarizer × `TRY_HARDER` combinations **even cropped to the symbol alone with a quiet zone**. Detector,
decoder config, geometry, ink and the render race are all eliminated.

**Next:** capture `qr.modules` at draw time and compare against what was drawn — that separates *the
library made a bad symbol* from *the drawing put a good one down wrongly*. Neither is checked.
**Copy any dump out of `test-results/` before running anything else**; the first was destroyed by a
cleanup loop, which is why the failing matrix is committed as text.

## Do not re-litigate

- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`,
  `lib/cache-groups.ts` are Lane A** — the **path**, not the nature of the edit. Under `lib/walk/`,
  only `segment-stats.ts` is API-reached; `walk-pacer.ts` and `interval-plan.ts` are **Lane B's**.
  `scripts/**` is the Orchestrator's, except a shrink-only baseline line the check itself demands.
- **A Lane B half needing a Lane A argument is TWO entries.** The split paid off again: BF-104 was
  PARKED behind LB-49 and became the queue head the moment LB-49 merged.
- **`components/workout-screen.tsx` is a shrink-only hotspot at 1833 lines and you will hit it.** A
  five-line `useMemo` pushed it to 1840 and failed the gate. Derive further down —
  `pre-workout-screen.tsx` already held both inputs, so `workout-screen.tsx` stayed untouched.
- **An e2e spec that stubs an `/api` route needs `test.use({ serviceWorkers: 'block' })`.** The worker
  re-issues every `/api/` request and Playwright cannot intercept a service-worker fetch, so the stub
  applies or not depending on whether the worker has claimed the page — passing locally, failing on CI
  with the real route answering. The Custom Rules gate catches it.
- **Q-354 is live and is a trap for spec authors.** `locator.click()` does nothing on the Nutrition
  screen — the date-swipe `useDrag` swallows it. Use `tapCentre`. **On More, `.click()` works fine.**
- **An e2e spec CAN talk to Postgres** — `new Client({ connectionString: process.env.DATABASE_URL })`.
  Better than stubbing: it works on CI's fresh database. **`seed.sql` creates no meal plan and no
  `food_logs`**, so build your own fixture and tear it down in `afterAll`.
- **Playwright strict mode matches more than you meant.** `getByText('per portion')` also matched a
  footnote; `getByRole('tab', {name: '½×'})` also matched `1½×`. Reach for `exact: true` early.
- **A `memo`ed row inside a `.map()` takes SCALARS.** A string is fine to pass uncached — it compares
  by value. `check-memo-prop-stability.js` enforces it.
- **`hydrateUserPreferences` NEVER deletes a key the bag lacks**; a mirror effect uses
  `usePersistedPreference`, never `savePreference`; a `fetch()` of a `data:` URL is a `connect-src`
  request the CSP forbids; `min-h-[Npx]` does nothing on a `<button>` (a bare element selector in
  `globals.css` beats it — drive height with padding); a route with no caller fails no test; and
  `/more` SSRs a skeleton, so `curl` finds no tab content and that is not a bug.

## Claimed paths

None held.

## Gotchas worth carrying

- **`git fetch origin main` RE-SHALLOWS this clone** — the tell is `refusing to merge unrelated
  histories`. Fix with `git fetch --unshallow origin`. It happened twice more this run.
- **Never check a gate through a pipe** (`pnpm check:rules | tail` exits with tail's status) **and
  never chain the push onto the same line as the gate.**
- **Check for conflict markers BEFORE `git add -A`**; a resolved file can still list `UU`.
- **`docs/doc-size-baseline-history.md` is APPEND-ONLY** — a conflict there is two *additions*, keep
  both. **Recompute every `.size` from the merged file**, as `wc -l` **+ 1** (the check counts
  `split('\n').length`; that off-by-one cost a gate run).
- **A `projectOverview.md` merge can leave a DUPLICATED `**Version:**` header** — both sides add a
  status block at the same anchor. Delete the stale one.
- **The backlog's two-deletions trap did not bite this run**, because both PRs *edited* their entries
  into `Keep:` form rather than deleting them, so the conflicts were edit-against-edit and `keep both`
  was right. Read the headings; do not apply the rule by reflex.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:…`; never splice a hunk.**
- **`get_check_runs` lagged 15–25 minutes ALL RUN and read `total_count: 0` twice.** When it looks
  frozen, **attempt the merge** — it validates against real branch protection and refuses if a
  required check has not passed. That was the reliable read eight times this run. `405 has merge
  conflicts` means `main` moved.
- **E2E is NOT a required check.** Making it required is branch protection (Q-297, owner's call).
- **Parallel agents move `main` under you constantly** — BF-104 needed two rounds of merging
  `origin/main`, Q-407 two more. **Playwright needs `DATABASE_URL` prefixed in**; the hook unsets it.
- **A backgrounded shell dies when the tool call returns.** Long sweeps run in the foreground with an
  explicit timeout — and see lesson 6 above for what a timeout leaves behind.
- **A local full-suite failure that will not reproduce is usually the environment** — one appeared, a
  re-run was clean, and **CI's fresh database passed**, which is the adjudicator. Record it as
  unexplained; never call it a flake without CI.
- **`tsc` TYPECHECKS NOTHING UNDER `__tests__`** — `e2e/` **is** checked. Both vitest projects run
  `environment: 'node'`, so **a `.tsx` cannot even be imported**: anything asserted directly rather
  than by source-scan lives in a `.ts`.
- **Custom Rules catches real bugs in code COPIED from a passing file.** `check-hex-literals` refused
  `#f59e0b` copied out of `macro-targets-pane.tsx`. `--accent-amber` through `color-mix` is the token;
  `components/cardio/time-picker-sheet.tsx` is the pattern.
- **The check:rules count is `Ran N of N` and moves** — never hardcode it, never quote "pass". It was
  **67 of 67** for this entire run.
