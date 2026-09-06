# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-03 · **By:** the twenty-second Lane B run · **Next ID:** `LB-54`

> **A mistyped ID in this file silently advances the whole lane's numbering.** A previous baton
> wrote an `LB-` number in the hundreds where it meant a `BF-` one, and
> `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` — the command CLAUDE.md tells you to
> allocate with — dutifully returned it. **Check the max it reports is an entry that actually exists**
> (`grep -rn` for a `### ` heading). This note does not spell the bad id out: writing it here would
> keep it winning the sort.

## Now

**Merged:** BF-104, BF-109, LB-47, LB-38 (#799/#806/#807, **solved #812**), Q-407 (#804/#805),
BF-107, BF-108 (#818), BF-105 (#827), Q-529 (#829), Q-516 (#839), the LB-52 baton PR (#824).
**Open and unmerged: #840 (BF-111) and #853 (BF-110).** `main` is at **v1.436.3**;
`pnpm check:rules` read **Ran 67 of 67** throughout.

**Nothing has been near a device** — ~40 screens owed, and for BF-105, BF-110 and BF-111 the device
is the whole verdict rather than a formality.

**READY is not the same as "the queue is empty".** Twice this run the list read READY (0) while real
Lane B work sat in it: **Q-516** under UNCLASSIFIED, because two bare lane mentions disagreed and
`laneFromLines` correctly refuses to guess; and **BF-94** behind a `Needs:` that had been discharged
two days earlier while its live blocker sat in prose. When READY hits 0, audit the parked and
unclassified rows before believing it. Start from `node scripts/next-item.js --lane B`, never a
hand-scan.

### Waiting on the owner

- **LB-47: on a real session-level deload the intensity toggle vanishes silently.** No control, no
  reason given. One explanatory line where it would be is cheap and probably right; a product call.
- **LB-47: a real "run this at full intensity" path** needs a regeneration `/prescribe` cannot do —
  the route takes no intensity input. Lane A plus the owner.
- **Q-407's remainder is now Lane A's** (#805): the coach does not yet open by stating what it already
  knows instead of asking. Prompt and tool ordering in `lib/coach/**`.
- **Does the app's own QR scanner need LB-38's rotation tolerance?** The e2e helper is fixed; the
  in-app scanner uses a different decoder and was not audited.

## The lessons this run actually cost something

### 1. Reproduce the failure AWAY from the system you suspect, first

**This solved LB-38 after days.** The failure was chased through the renderer, the binarizer, ink
density, a matrix diff and a render race — every one an expensive capture inside Playwright, every
conclusion wrong. What settled it in seconds was encoding and decoding 3000 tokens in a plain script
with no browser: **`@zxing/library` cannot read certain *valid* QR symbols upright** (3.83%,
deterministic per token, independent of ECC, version, mask and quiet zone; `decodeQrRotating` takes
it to 0.13%).

**Before instrumenting the system you suspect, try to reproduce the failure without it.** Three
confident readings died to this — the ink band below, a matrix diff across runs using *different
meals*, and a race needing payloads that never differ.

### 2. An entry is often wrong about its OWN code — read the code before believing it

**FIVE this run** — plus BF-105 (its "sibling has the same gap" was false) and **Q-516**, which asked
for server work that had shipped the day before. Each stated as settled fact in the backlog:

- **LB-47** measured production to the row and concluded the `Full` override "reverts nothing". The
  figures held exactly — but on that prescription the toggle **is not rendered at all**, so the fix it
  proposed was already the behaviour and the real defect was a card *claiming* a revert.
- **BF-107** asserted a sibling screen had the same gap. `done-activity-screen.tsx` navigates away on
  save, so it never could.
- **BF-108** blamed the completion path. `resetSession()` is called on both save paths and on Back —
  the completion path has always been clean. The real gap was an *abandoned* session demoted by
  `onRehydrateStorage` with its setup fields left populated.

An entry's *measurement* is usually sound; its *conclusion about the screen* is the part to re-derive.

### 3. A guard matching text that survives the feature being disabled is not a guard

**Six instances.** Every one passed on first write and was caught only by mutating the fix away:
`expect(src).toContain('<MacroCalorieWarning')` against `{false && …}`; `/rescaleRemaining\(\{/`
against `const rescale = null && …`; an e2e `toHaveCount(0)` against a page that failed to render; and
on LB-47 a split check — `indexOf` for the condition, `toContain` for the sentence — that passed
against `{false ? "This prescription lowered…"`, because the unreachable branch's text is still in the
file **and** the same condition appears in the heading ternary above.

**Pin the condition and its consequent in ONE pattern.** Never as two assertions. Put a positive
anchor before every absence check. **Verify the mutation changed THE THING UNDER TEST**, not merely
that the file differs: a BF-111 mutation reported applied and hit the first match, which was inside a
comment the test strips — green against a mutation that changed nothing.

### 4. `next-item.js` reads FIELDS, not prose — twice, two different ways

- A `Keep:` rewrite that drops `Lane:` and `Verify:` makes an entry print as `⟨lane unstated⟩` with an
  empty note (BF-109).
- **A shipped Lane B half needs its `Lane:` re-routed or the entry sits in NEITHER queue** (#805).
  Q-407 carried a prose paragraph naming its split since August; the runner never read it.

### 5. Do not compare a number against a band measured somewhere else

LB-38's dump read ink **0.0807** against a recorded band of **0.172–0.179** — half, a textbook
mid-repaint signature, written up as confirming the hypothesis and built into a gate. Ink is
**per-style**: that style reads **0.0800** on a *passing* run; the band belonged to another test's.
The gate was reverted unshipped. **Measure the healthy case before shipping a fix.**

### 6. Two ways a test run reports success it did not have

`grep -E "passed|failed"` on Playwright lies twice: `tail -1` returns `2 passed` for a run that
**failed** (failures print first, the duration goes last), and the `[WebServer]` lines contain
`0 failed`. **Detect failure by an artefact, not text.** And the 10-minute tool timeout cuts a
mutation sweep mid-loop, leaving the mutation in the tree — **diff before continuing**.

## Do not re-litigate

- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`,
  `lib/cache-groups.ts` are Lane A** — the **path**, not the nature of the edit. Under `lib/walk/`,
  only `segment-stats.ts` is API-reached; `walk-pacer.ts` and `interval-plan.ts` are **Lane B's**.
  `scripts/**` is the Orchestrator's, except a shrink-only baseline line the check itself demands.
- **A Lane B half needing a Lane A argument is TWO entries** — BF-104 was PARKED behind LB-49 and
  became the queue head the moment LB-49 merged.
- **`components/workout-screen.tsx` is a shrink-only hotspot at 1833 lines and you will hit it.** A
  five-line `useMemo` pushed it to 1840 and failed the gate. Derive further down —
  `pre-workout-screen.tsx` already held both inputs, so `workout-screen.tsx` stayed untouched.
- **An e2e spec that stubs an `/api` route needs `test.use({ serviceWorkers: 'block' })`.** The worker
  re-issues every `/api/` request and Playwright cannot intercept a service-worker fetch, so the stub
  applies or not depending on whether the worker has claimed the page — passing locally, failing on CI
  with the real route answering. The Custom Rules gate catches it.
- **Q-354 is a trap for spec authors:** `locator.click()` does nothing on Nutrition — the date-swipe
  `useDrag` swallows it, so use `tapCentre`. **On More, `.click()` works fine.**
- **An e2e spec CAN talk to Postgres** — `new Client({ connectionString: process.env.DATABASE_URL })`,
  which beats stubbing because it works on CI's fresh database. **`seed.sql` creates no meal plan and
  no `food_logs`**, so build your own fixture and tear it down in `afterAll`. And **strict mode
  matches more than you meant** — `getByText('per portion')` also matched a footnote,
  `getByRole('tab', {name: '½×'})` also matched `1½×`; reach for `exact: true` early.
- **A `memo`ed row inside a `.map()` takes SCALARS.** A string is fine to pass uncached — it compares
  by value. `check-memo-prop-stability.js` enforces it.
- **`hydrateUserPreferences` NEVER deletes a key the bag lacks**; a mirror effect uses
  `usePersistedPreference`, never `savePreference`; a `fetch()` of a `data:` URL is a `connect-src`
  request the CSP forbids; `min-h-[Npx]` does nothing on a `<button>` (a bare `globals.css` element
  selector beats it — drive height with padding); and `/more` SSRs a skeleton, so `curl` finds no tab
  content and that is not a bug.

## Claimed paths

None held.

## Gotchas worth carrying

- **`npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`, and CI's `Build` job does.** A type
  exported only for the tests, left unexported, passed `tsc` clean here and **failed Build on CI**.
  The gate that covers tests is **`node scripts/check-test-typecheck.js`** (`tsconfig.tests.json`,
  per-file baseline — currently *320 type errors across 90 test files, none above baseline*). Run it.
  `e2e/` **is** covered by plain `tsc`. Both vitest projects run `environment: 'node'`, so **a `.tsx`
  cannot even be imported**: anything asserted directly rather than by source-scan lives in a `.ts`.
- **Merging under concurrency is a race this run kept losing.** `main` moved roughly every ten minutes
  while a CI cycle takes five to seven, so any PR touching `docs/doc-size/*`, `package.json` or
  `changelog.ts` — which is every PR — can go `dirty` before its checks finish. **BF-108 took five
  rounds.** The correct tool, `enable_pr_auto_merge`, **is unavailable on this repo**: it answers
  *"Protected branch rules not configured for this branch."* Filed for the owner; until then, resolve
  and re-push immediately rather than batching other work first.
- **`git fetch origin main` RE-SHALLOWS this clone** — the tell is `refusing to merge unrelated
  histories`. Fix with `git fetch --unshallow origin`. It happened repeatedly this run.
- **Never check a gate through a pipe** (`pnpm check:rules | tail` exits with tail's status), never
  chain the push onto the same line as the gate, and **check for conflict markers before `git add -A`**.
- **`docs/doc-size-baseline-history.md` is APPEND-ONLY** — a conflict there is two *additions*, keep
  both. **Recompute every `.size` from the merged file**, as `wc -l` **+ 1** (the check counts
  `split('\n').length`; that off-by-one cost a gate run).
- **A `projectOverview.md` merge can leave a DUPLICATED `**Version:**` header** — both sides add a
  status block at the same anchor. Delete the stale one.
- **The backlog's two-deletions trap did not bite this run**, because both PRs *edited* their entries
  into `Keep:` form rather than deleting them, so the conflicts were edit-against-edit and `keep both`
  was right. Read the headings; do not apply the rule by reflex.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:…`; never splice a hunk.**
- **`get_check_runs` lagged 15–25 minutes ALL RUN and read `total_count: 0` repeatedly.** When it
  looks frozen, **attempt the merge** — it validates against real branch protection and refuses if a
  required check has not passed. `405 has merge conflicts` means `main` moved. **E2E IS required now
  — wait for SIX checks, not five.** The owner added it to `main`'s ruleset per LA-22; the old "E2E
  is not required" fact was true until 2026-08-26 and was carried a day past its expiry. **Playwright
  needs `DATABASE_URL` prefixed in**; the session-start hook unsets it.
- **`enable_pr_auto_merge` DOES NOT WORK HERE and the reason is not what LB-52 first said.** *Allow
  auto-merge* is on and `main` is protected — by a **Ruleset**, which GitHub's auto-merge API does
  not recognise; it wants classic branch protection and reports *"Protected branch rules not
  configured for this branch"*. Reproduced on two PRs. So every merge is hand-caught: **fourteen
  attempts over seven PRs in two days**, each green on its own merits. Do not re-diagnose this from
  the error string alone — that is how the entry got it wrong twice.
- **A backgrounded shell dies when the tool call returns.** Long sweeps run in the foreground with an
  explicit timeout — and see lesson 6 for what a timeout leaves behind.
- **A local full-suite failure that will not reproduce is usually the environment.** The one seen this
  run was `DATABASE_URL` unset by the session hook, not a defect — prefix it back in before believing
  a red. **CI's fresh database is the adjudicator.**
- **Custom Rules catches real bugs in code COPIED from a passing file.** `check-hex-literals` refused
  `#f59e0b` copied out of `macro-targets-pane.tsx`. A grandfathered literal is not an allowed one;
  `--accent-amber` through `color-mix` is the token.
- **The check:rules count is `Ran N of N` and moves** — never hardcode it, never quote "pass". It was
  **67 of 67** for this entire run.
