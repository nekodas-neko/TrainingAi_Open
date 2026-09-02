# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-02 · **By:** the twenty-second Lane B run · **Next ID:** `LB-52`

## Now

**Merged this run:** BF-104 (#793), BF-109 (#796), LB-47 (#798), LB-38 (#799). `main` is at
**v1.431.2**. **Nothing has been near a device** — the owed list is ~35 screens.

**The READY list is down to one, and it is LB-38, which I did not close.** Its next step is a fresh
dump capture, and its *cause* is unknown — see below. Everything else in Lane B is `KEEP:` residue,
`VERIFY:` device checks, or waiting on the owner. **A successor with no device should expect to reach
the end of what can proceed and should say so rather than starting a KEEP entry**; two questions are
sitting with the owner and are named under *Owner-blocked* below.

### The habit that mattered most, again: mutate every assertion before believing it

**Six guards this run passed on first write and were wrong**, each caught only by mutating the fix
away. This is the fourth consecutive run where this was the single highest-value habit, and the shape
is always the same — **an assertion that matches text which survives the feature being disabled**:

- `expect(src).toContain('<MacroCalorieWarning')` passed against `{false && <MacroCalorieWarning`.
- `expect(src).toMatch(/rescaleRemaining\(\{/)` passed against `const rescale = null && rescale…`.
- An e2e `toHaveCount(0)` passed against a page that **failed to render**. Put a positive anchor
  before every absence check.
- And the sharpest one, on LB-47: I split the check into `indexOf` for the condition and `toContain`
  for the sentence, and it passed against `{false ? "This prescription lowered…"`. **Two** reasons at
  once — the text of an unreachable branch is still in the file, *and* the same condition appears in
  the heading ternary directly above, so the `indexOf` still found one after the body's was deleted.
  **Pin the condition and its consequent in ONE pattern**, never as two assertions.

A mutation that does not change the file is not a mutation: **verify the mutation applied** (`grep`
for it) before recording that a test survived it. On LB-109 I recorded a survivor that turned out to
be a `python3 -c` heredoc that never matched.

### An entry can be right in its measurement and wrong in its conclusion

**LB-47 is the worked example and it is worth reading before trusting any entry's conclusion.** It
measured production correctly to the row — 5 prescriptions, 1 session-level deload with 0 exercises
carrying `preDeload`, 2 per-exercise, 0 with both — and concluded the `Full` override "reverts
nothing". Re-measured: the figures hold exactly. **But on that prescription the toggle is not rendered
at all** (`phase: 'deload'` → `aiDynamicFallbackPhaseStatus` sets `isDeloadActive` →
`pre-workout-screen.tsx` gates the whole control on it). So `Full` is not an override that does
nothing; it is not offerable, and the fix the entry proposed was already the behaviour.

**Check what the SCREEN does with the data, not only what the data says.** The reachable defect turned
out to be worse and different: `blocked.length === 0` meant both "everything reverted" and "nothing was
deloaded", and the card rendered *"Every exercise is back to its pre-deload weights and sets, and these
sets count toward your 1RM"* — both clauses false.

### Do not compare a number against a band measured somewhere else

**The most expensive mistake of this run, and it was mine, not an entry's.** LB-38's dump had ink
**0.0807** against a recorded normal band of **0.172–0.179**. I read that as half the normal ink — a
textbook mid-repaint signature — wrote it up as confirming the entry's hypothesis, and implemented the
canvas-settling gate the entry prescribes for exactly that case.

Logging ink on a **passing** run before shipping showed it is **per-style**: `Ingredients · centred`
**0.0800**, `Black band` 0.1341, `Plaque` 0.0914, `Big code` 0.1732. **0.0807 is normal for the style
it came from.** The band belonged to a different test's style. The gate was reverted unshipped; the
figures now live in `darkFraction`'s comment, which previously said "~0.17" and is what made the error
easy.

**The check that caught it was cheap and generic: before shipping a fix, measure the healthy case.** I
only logged the ink to prove the gate was not inert.

## Do not re-litigate

- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`,
  `lib/cache-groups.ts` are Lane A** whatever the edit looks like — the **path**, not the nature of
  the edit. `lib/health/*` counts when an API route reaches it. Under `lib/walk/`, only
  `segment-stats.ts` is API-reached: `walk-pacer.ts` and `interval-plan.ts` are **Lane B's**.
  `scripts/**` is the Orchestrator's — except a shrink-only baseline line the check itself demands
  you remove.
- **A Lane B half that needs a Lane A argument is TWO entries.** Split it, `Needs:` the engine half.
  LB-49/LB-50 are the worked examples, and **the split paid off this run**: BF-104 was PARKED behind
  LB-49 and became the queue head the moment LB-49 merged.
- **`components/workout-screen.tsx` is a shrink-only hotspot at 1833 lines and you will hit it.** A
  five-line `useMemo` there pushed it to 1840 and failed the gate. Derive further down instead —
  `pre-workout-screen.tsx` already held both inputs, so the computation moved there and
  `workout-screen.tsx` was left untouched.
- **Q-354 is live and is a trap for spec authors, not a user bug.** `locator.click()` does **nothing**
  on the Nutrition screen — the date-swipe `useDrag` swallows it. Use `tapCentre`. **On More,
  `.click()` works fine** — the trap is Nutrition-specific.
- **An e2e spec CAN talk to Postgres** — `new Client({ connectionString: process.env.DATABASE_URL })`.
  Usually better than stubbing a route: it works on CI's fresh database and exercises the real
  pipeline. **`scripts/local-db/seed.sql` creates no meal plan and no `food_logs`**, so build your own
  fixture and tear it down in `afterAll`.
- **Playwright strict mode will match more than you meant.** Three times this run: `getByText('per
  portion')` also matched a footnote, `getByRole('tab', {name: '½×'})` also matched `1½×`, and
  `getByText(/These macros come to/)` needed care. Reach for `exact: true` early.
- **A `memo`ed row inside a `.map()` takes SCALARS.** `check-memo-prop-stability.js` enforces it. A
  string is fine to pass uncached — it compares by value.
- **`stableBox`/`tapCentre` before any coordinate dispatch OR geometry assertion.**
- **`hydrateUserPreferences` NEVER deletes a key the bag lacks.** **A mirror effect uses
  `usePersistedPreference`, never `savePreference`.** **A `fetch()` of a `data:` URL is a
  `connect-src` request** and the CSP forbids it.
- **`min-h-[Npx]` does nothing on a `<button>` or `role="button"`** — a bare element-selector floor in
  `globals.css` beats the utility. Drive height with padding.
- **A route with no caller fails no test** — grep for a client caller before believing a feature exists.
- **`/more` SSRs a skeleton** — a `curl` finds none of the tab content and that is not a bug.

## Owner-blocked

Two questions came out of this run and neither should be answered by a successor on its own:

- **LB-47: on a real session-level deload the intensity toggle vanishes silently.** No control, no
  reason. One explanatory line where it would be is cheap and probably right, but it is a product call.
- **LB-47: a real "run this at full intensity" path** needs a regeneration `/prescribe` cannot do (the
  route takes no intensity input). Lane A plus the owner.

Carried: whether E2E becomes a required check (Q-297, branch protection is the owner's); LB-38's own
`Gate:`-free status; the ~35 device checks.

## Claimed paths

None held.

## Gotchas worth carrying

- **`git fetch origin main` RE-SHALLOWS this clone** — the tell is `refusing to merge unrelated
  histories`. Fix with `git fetch --unshallow origin`.
- **Never check a gate through a pipe** (`pnpm check:rules | tail` exits with tail's status) **and
  never chain the push onto the same line as the gate.** Read the result, then decide, separately.
- **`grep -E "passed|failed" | tail -1` on a Playwright run LIES.** The line reporter prints failures
  first and puts the duration on the last summary line, so `tail -1` returns `2 passed (1.6m)` for a
  run that failed. **The tell is the count**: this file reports 3 when green (2 setups + 1 test), and
  a run reporting 2 has failed. I spent three runs re-testing a "passing" run that had failed.
- **Check for conflict markers BEFORE `git add -A`.** `git status | grep '^UU'` reports nothing once
  they are staged. **And a file can be resolved and still be listed `UU`** — `git add` it explicitly.
- **`docs/doc-size-baseline-history.md` is APPEND-ONLY** — a conflict there is two *additions*, keep
  both. **Recompute every `.size` from the merged file; never keep either side.** They are
  `wc -l` **+ 1** — the check counts `split('\n').length`, and that off-by-one cost a gate run.
  On one branch this run the number was recomputed **three times** as the base moved underneath it.
- **A `projectOverview.md` merge can leave a DUPLICATED `**Version:**` header** — both sides add a
  status block at the same anchor, and keeping both keeps two headers. Delete the stale one.
- **The backlog's two-deletions trap did NOT bite this run and the reason is worth knowing:** both my
  PRs *edited* their entries into `Keep:` form rather than deleting them, so the conflicts were
  edit-against-edit and `keep both` was right. Read the headings; do not apply the rule by reflex.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:…`; never splice a hunk.**
- **`get_check_runs` lagged 15–25 minutes ALL RUN and read `total_count: 0` twice.** When it looks
  frozen, **attempt the merge**: it validates against real branch protection and refuses if a required
  check has not passed. That is the reliable read; it worked four times this run. `405 has merge
  conflicts` means `main` moved, not that your branch is broken.
- **E2E is NOT a required check.** Making it required is branch protection (Q-297, owner's call).
- **Parallel agents move `main` under you constantly** — BF-104 needed **two** rounds of merging
  `origin/main` between opening the PR and merging it.
- **Playwright needs `DATABASE_URL` prefixed in** — the session-start hook unsets it.
- **A backgrounded shell dies when the tool call returns.** Long mutation sweeps run in the foreground
  with an explicit timeout, or they are silently truncated **and leave a mutation applied**.
- **A local full-suite failure that will not reproduce is usually the environment.** One appeared this
  run, a re-run was clean at 744 files / 6,320 tests, and **CI's fresh database passed** — which is the
  adjudicator. Record it as unexplained; do not call it a flake and do not dismiss it without CI.
- **`tsc` TYPECHECKS NOTHING UNDER `__tests__`** — `e2e/` **is** checked normally. Vitest runs
  `environment: 'node'` in both projects, so **a `.tsx` cannot even be imported**: anything asserted
  directly, rather than by source-scan, has to live in a `.ts`.
- **Custom Rules catches real bugs in code COPIED from a passing file** — a grandfathered pattern is
  not an allowed one. `check-hex-literals` refused `#f59e0b` copied straight out of
  `macro-targets-pane.tsx`. `--accent-amber` through `color-mix` is the token;
  `components/cardio/time-picker-sheet.tsx` is the pattern.
- **`next-item.js` reads FIELDS, not prose.** Replacing an entry with a `Keep:` form dropped its
  `Lane:` and `Verify:` lines and it printed as `⟨lane unstated⟩` with an empty device note — invisible
  to the tool an implementer is told to start from. Keep both fields on a `Keep:` entry.
- **The check:rules count is `Ran N of N` and moves** — never hardcode it, never quote "pass". It was
  **67 of 67** for this entire run.
