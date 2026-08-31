# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-31 · **By:** the twentieth Lane B run · **Next ID:** `LB-39`

## Now
**Merged this run: Q-410 (#699, v1.411.0), Q-187 (#700, v1.412.0), Q-276 (#701, v1.413.0), LB-34
(#702, v1.413.1), LB-33 + LB-38 (#704).** Nothing has been near a device.

**⚠ `tsc` TYPECHECKS NOTHING UNDER `__tests__` — LB-37, and it changes what "TSC_OK" means.**
`tsconfig.json` excludes `**/__tests__/**`. Appending `const x: number = "not a number"` to a spec
produces **zero** errors. So across ~700 unit-test files a spec can reference a type that does not
exist, call a function with the wrong arity, or assert against an interface that has since changed
shape, and nothing says so. **`e2e/` is NOT excluded** and is checked normally. Found by accident —
a spec written this run used two types it never imported and passed. Do not delete the exclude line
before measuring what it hides; the entry says to record the count either way.

**LANE B'S QUEUE HEAD IS EXHAUSTED, and that is a finding rather than a complaint.** Of the fifteen
entries above where work was possible: **five were Lane A** by the path rule (Q-275, Q-272, Q-278,
Q-279, Q-283 — now annotated, which took READY from 39 to 34), LB-12 is the Orchestrator's, Q-354 is
decided-against in its own text, Q-297 is residue, Q-251/252/253 are infra, Q-231 and BF-84 need
owner decisions, Q-222/Q-214a/Q-155/Q-1a/Q-44 are Lane A, Q-181 and Q-151 are WATCH ONLY, and
**Q-138 declines to be a dedicated PR in its own words**. Three queue-head entries now say "do not
build me". **Annotate the lane of anything you derive** — the next session should not re-derive it.

**BF-84 is position 1, and READ THE ENTRY rather than this line** — PR #705 was reshaping it as this
was written, reporting the owner had settled the surface as one greyed button on Home's training
card. On `main` it still carried two questions: which surface (Home shows ONE recommended session, so
"a button for each session" only fits the session list or week strip), and whether rest is a stored
**fact** (Lane A — row, sync domain, inference path) or a hint for today's screen (Lane B). The
second decides the lane; the entry recommends a fact. **Whichever is still open, do not build past
it.**

**A HEISENBUG SHOULD BE MADE TO REPORT ITSELF (LB-38).** The share-code e2e decode fails ~1 run in 2
under file load and **never** in isolation, so it could not be caught on demand. Putting the
measurement into the assertion message settled it in one run: a captured failure reads
**ink = 0.1735**, inside the normal 0.172–0.179 band, so the canvas is drawn correctly and the pixels
arrive intact — **capture eliminated, the fault is in the decode**. Two hypotheses are now falsified
and recorded so nobody re-derives them. **When a flake will not reproduce, ship the instrument, not
another retry.**

**Reasoning from one measurement to a mechanism cost this run twice.** Both guesses above were
plausible and each took under two minutes to falsify once *tested* rather than argued. Read the code
path before proposing the cause.

**Mutation-check every guard — ~30 this run, all killed, and seven across the two runs before could
not fail as written.** Three source greps once matched their own explanatory comments; strip comments
before matching, or match the CALL (`/name\s*\(/`).

**Before moving or renaming a user-visible affordance, `grep -rln` the OLD accessible name across
`e2e/`.** A sibling sweep of the *code* missed the spec whose whole subject was the moved button;
only E2E caught it.

**An entry's premises are not evidence** — five stale in a row now. Correct them IN the entry, not
only in a plan, and decline a wrong instruction in writing (LB-34 proposed an Undo toast; nothing had
been written yet, so the honest offer is "Save a copy").

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**` are Lane A**
  whatever the edit looks like — the **path**, not the nature of the edit. `lib/health/*` counts when
  an API route reaches it (`score-availability.ts` does). `lib/walk/interval-plan.ts` does **not** —
  only `segment-stats.ts` is API-reached. `scripts/**` is the Orchestrator's.
- **Q-354 is live and is a trap for spec authors, not a user bug.** `locator.click()` does **nothing**
  on the Nutrition screen — no toast, no request, no error — because the date-swipe `useDrag`
  swallows mouse input and mouse is what Playwright sends. Use `tap()`, which is the faithful input
  anyway. A spec this run walked into it while not looking for it.
- **`stableBox`/`tapCentre` (`e2e/fixtures.ts`) before any coordinate dispatch OR geometry
  assertion** — neither `touchscreen.tap` nor `Input.dispatchTouchEvent` checks actionability, and a
  local pass is not evidence against that race.
- **`hydrateUserPreferences` NEVER deletes a key the bag lacks**; the one pair the app clears is brand
  preset / custom hue via `EXCLUSIVE_GROUPS`.
- **A mirror effect uses `usePersistedPreference`, never `savePreference`** — the same line is a PATCH
  on every mount. **The guard compares the VALUE**: StrictMode spends a first-run ref.
- **A `fetch()` of a `data:` URL is a `connect-src` request** and the CSP forbids it.
- **A `SwipeActions` row owns horizontal gestures starting on it**; the nutrition container's own drag
  steps the DAY and is invisible on today — test on a past day.
- **BF-39's grouping rule** — `meal_group_id`, never `saved_meal_id`; one row is not nested.
- **Back-dismissal's logic is [`sheet-back-stack.ts`](../../../lib/hooks/sheet-back-stack.ts)** —
  depth and a module-level self-pop counter, both load-bearing. Never call `useSheetBackDismiss` at a
  call site.
- **`EndOfDayReview` renders unconditionally**; **Log Food is one sheet per screen**.
- **`min-h-[Npx]` does nothing on a `<button>` or `role="button"`** — a bare element-selector floor in
  `globals.css` beats the utility. Drive height with padding (LB-32). **A bottom sheet is
  `fixed bottom-0`**, so its height moves only its TOP edge.
- **A route with no caller fails no test** — when an entry says a storage half shipped, grep for a
  client caller before believing the feature exists.
- **The sandbox renders no exercise clip** (`raw.githubusercontent.com` is proxy-dropped) — verify
  with same-origin substitutes asserting `naturalWidth > 0`.

## Owed (device / physical)
**Nothing from the last six runs is device-verified.**
[`device-verification-queue.md`](../../device-verification-queue.md) groups by screen — work a
section, not an entry. The whole **Nutrition** section is owed and is best done in one sitting.

Added this run:
- **Q-410:** only the pacer's SPEED rung has ever executed. The **cadence and heart-rate rungs need a
  Polar H10** — bands tracking the legs, the Stopped state at a crossing, the strap-drop fallback and
  the band colours at arm's length are all verified by reading. **LB-36** holds it.
  `BAND_TOLERANCE = 0.10` is a proposal, not a measurement.
- **Q-187:** `getLocalStore` is null on web, so the day-fill took the API fallback, never the SQLite
  write plus outbox.
- **LB-34:** nothing has scanned a real label — the branch needs a camera.

Carried: BF-57 needs **two phones, two accounts and a printer** (`MIN_MM_PER_MODULE` 0.49 is a
convention until one disagrees); BF-75's ≥4.5:1 contrast; BF-52's tile wrap; Q-467, Q-499, Q-538,
Q-305 at S25 width, Q-477 across local midnight, BF-10, LB-5, Q-328/Q-321/Q-486, Q-389, a TalkBack
pass. **Q-315 needs a DESKTOP.**

## Claimed paths
None held.

## Gotchas worth carrying
- **Piping a run through `grep` without `--line-buffered` hides its output until it exits** — the
  watched file stays empty and a slow run is indistinguishable from a hung one. This run reported a
  20-minute "reproduction" while **no process was running at all**. Check `ps` before believing a
  hang.
- **`awk` matching an entry id matches SUBSTRINGS** — `Q-51` finds `Q-510` first. Anchor on the id
  plus its trailing space.
- **An e2e spec that writes real rows must use unique-per-run names.** Which planned meals are
  already logged is derived by matching ingredient NAMES, so a second run on the same day finds run
  one's food and fails for a reason unrelated to the code. CI gets a fresh DB and never shows it.
- **`git fetch origin main` RE-SHALLOWS this clone** — the tell is `refusing to merge unrelated
  histories`. Fix with `git fetch --unshallow origin`.
- **Never check a gate through a pipe** — `pnpm check:rules | tail` exits with tail's status. Quote
  the **"Ran N of N"** count, never the word "pass". It was 65 this run.
- **`main` will land a PR under YOUR open one**, and `total_count: 0` follows: stale base, runner
  backlog, or a wedged run (the only way out is a new commit with real content).
- **`get_check_runs` and a run's `updated_at` lag by 20+ minutes; a job-log fetch 404s either way; and
  the E2E artifact upload is `if: failure()`, so zero artifacts means passed OR still running.**
  Only per-step `list_workflow_jobs` timings settle it. Attempting the merge is the reliable read of
  the *required* checks.
- **E2E takes 15–40 min, is NOT a required check, and CATCHES REAL BUGS.** Never dismiss a red E2E
  without reading the log — but a failure reproduced on clean `main` is not your PR's.
- **A killed background run exits 143/144, which reads like a failure and is not** — a `pkill` in the
  same compound command will do it to your own suite.
- **`git add -A` with two items in flight sweeps the other into your commit.** Stage paths.
- **`docs/doc-size-baseline-history.md` is APPEND-ONLY** — a conflict is two *additions*: keep both
  and correct the from→to figures to the merged reality. **A backlog conflict is not always two
  deletions** — read the headings. **Rebuild `package.json`/`changelog.ts` from
  `git show origin/main:...`; never splice a hunk.**
- **A resolved Known-Issues entry should SHRINK, not grow** — trimming one to fit paid for a row this
  run with no baseline raise.
- **Playwright needs `DATABASE_URL` prefixed in** — the session-start hook unsets it, and the failure
  surfaces in `zero-data.setup.ts` while your spec reports `did not run`.
- **Never merge `main` or edit the tree while a local e2e run is live** — the tell is
  `Parsing ecmascript source code failed` with tests at **0ms**. Checking out a branch mid-run
  silently reverts instrumentation you are relying on.
- **A red local e2e that is green in CI is probably the aged seed** — `body_metrics.steps` ends days
  before "today".
- **Changing a DEFAULT argument silently changes what existing tests assert.** Pin the old value.
- **`expect.poll` over a canvas is pathological** — ~5.5 M numbers over CDP per read. Bounded retry.
- **The chips and Body Battery card render on `/`, not `/session-select`** — the Workout tab shares
  the component without them, so a spec pointed at the wrong tab passes its stub and finds nothing.
