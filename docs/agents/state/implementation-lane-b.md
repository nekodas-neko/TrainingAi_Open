# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-01 · **By:** the twentieth Lane B run · **Next ID:** `LB-45`

## Now
**Merged this run: Q-410 (#699), Q-187 (#700), Q-276 (#701), LB-34 (#702), LB-33 + LB-38 (#704),
BF-84 lane (#707), BF-85 (#711), BF-79, BF-87, LB-40 + LB-41, LB-29, BF-86, BF-98, BF-96 + BF-95
(#748). BF-82 is the open PR (#749, v1.419.0).** Nothing has been near a device.

**A GUARD THAT CANNOT FAIL IS NOT A GUARD — four shipped this run before it became a habit**, each
passing on the first write and each caught only by *mutating the fix away*, never by reading:
it matched a **form seed** rather than the write (BF-79 — `heightCm:` appears in both, fixed by
extracting the `JSON.stringify({…})`/`patch({…})` spans); it matched the **loading skeleton**
(BF-96 — the chip's placeholder is a `rounded-full bg-muted/60` box); the **fixture never reached the
branch** (BF-86's `isVisible()` is point-in-time against a `dynamic(ssr:false)` sheet; BF-98's
fixture does not render the footer on *either* condition, so that spec was **deleted** and the
difference from the owner's diary is recorded as open); and the **reader stripped what it checked**
(BF-87 — a guard about an import, using a helper that strips imports).
**Mutate every assertion before you believe it**, and assert the matcher *found* something —
`more-row-group-arity.test.ts` does, because a matcher that matches nothing passes forever.

**Importing a constant can 500 a page that `tsc` says is fine** (BF-87, LB-43). Pulling
`STEP_BASELINE` from `daily-energy` dragged in `workout-energy` → `oura-models/constants`, which
reads `node:fs/promises`. Typecheck was clean; only `pnpm dev` found it. The constant is **mirrored**
with a drift test. **Run the page, not just the compiler.**

**Read an entry by anchoring on `^### ` plus the id**, never a bare grep — `grep -n 'BF-79 —'`
matched *another entry's `Needs:` line* 40 lines earlier and produced a false "the queue head is
exhausted". And **an entry naming another as a blocker may be the blocker, not the blocked.**

**⚠ `tsc` TYPECHECKS NOTHING UNDER `__tests__` — LB-37, and it changes what "TSC_OK" means.**
`tsconfig.json` excludes `**/__tests__/**`, so a spec can reference a type that does not exist and
nothing says so. **`e2e/` is NOT excluded** and is checked normally.

**Custom Rules caught a real bug in code I had COPIED from a passing file.** A bare
`toLocaleDateString` in `goals-section.tsx` was grandfathered; the copy in a new file was not. **A
pattern being present in the repo is not evidence it is allowed.**

**Reading two components for a consolidation found three defects nobody was looking for** — LB-40
(a user with a password *cannot change it*), LB-41 (a Weight Units toggle with no consumer), LB-42
(two columns for one weight goal — Lane A). **A consolidation is a free audit; write down what you
see.**

**The check:rules count moved 65 → 66 → 67 in one session**, twice from other agents' merges. Never
hardcode it, never quote "pass" — quote `Ran N of N`.

**Ask the owner rather than inferring from their wording.** BF-82's *"some items could be changed
from sliders to text or buttons"* did not match the screen — there are no sliders on More and no
`<select>` on any of its six sub-screens. Asked directly: *"yes it wasnt the sliders specifically;
more that its messy and needs re'organisation."* One question retired a whole speculative branch of
work. The answer is on the entry so nobody re-reads the original request and acts on it.

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**` are Lane A**
  whatever the edit looks like — the **path**, not the nature of the edit. `lib/health/*` counts when
  an API route reaches it. `lib/walk/interval-plan.ts` does **not** — only `segment-stats.ts` is
  API-reached. `scripts/**` is the Orchestrator's — **except a shrink-only baseline line the check
  itself demands you remove**, which is part of your change, like a doc-size raise.
- **BF-79's placement, which BF-82 has now built on:** identity and body facts together on
  `app/more/details/`, reached from the `Your setup` group; weight and body fat **read-only** there
  (an input is a second write path into `body_metrics`); targets and activity level stay in Goals.
- **Q-354 is live and is a trap for spec authors, not a user bug.** `locator.click()` does **nothing**
  on the Nutrition screen — the date-swipe `useDrag` swallows mouse input, which is what Playwright
  sends. Use `tap()`. **On More, `.click()` works fine** — the trap is Nutrition-specific.
- **`stableBox`/`tapCentre` (`e2e/fixtures.ts`) before any coordinate dispatch OR geometry
  assertion** — neither `touchscreen.tap` nor `Input.dispatchTouchEvent` checks actionability.
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
- **`/more` SSRs a skeleton** — a `curl` of it finds none of the tab content and that is not a bug.
  Verify More-tab work with Playwright, or by fetching the sub-route directly (`/more/details` does
  render server-side).

## Owed (device / physical)
**Nothing from the last seven runs is device-verified.**
[`device-verification-queue.md`](../../device-verification-queue.md) groups by screen — work a
section, not an entry. The whole **Nutrition** section is owed and is best done in one sitting.

Added this run — **~ten screens, and the device-verification queue is the way to work them**:
- **BF-82:** the whole More tab re-grouped and the **bottom actions row moved**, so clearance under
  Sign Out against the gesture bar is unchecked. Insets render as 0 in the sandbox.
- **BF-86:** `LocalDayProvider` fires on `visibilitychange`; the resume path is the thing to check,
  and it needs the app backgrounded across a real local midnight.
- **BF-96:** cannot be device-verified as-is — the seeded sandbox has no weather snapshot, so only
  the chip's skeleton renders. **BF-95:** the swipe/tab-edge interaction needs a thumb.
- **LB-29 / LB-40 / LB-41 / BF-87 / BF-98:** all web-verified only.
- **BF-79:** `More → Profile details` is web-verified only. Safe-area clearance under
  `MoreSubScreen`'s floored padding, the three sex buttons and the two measurement buttons at S25
  width are unchecked on hardware.
- **BF-85:** the centred quantity box and its size beside the ×1/×2 chips are a rendering claim, and
  both vitest projects run `environment: 'node'`.
- **Q-410:** only the pacer's SPEED rung has ever executed — cadence and heart rate need a **Polar
  H10**. **LB-36** holds it. `BAND_TOLERANCE = 0.10` is a proposal, not a measurement.
- **Q-187:** `getLocalStore` is null on web, so the day-fill took the API fallback, never the SQLite
  write plus outbox. **LB-34:** nothing has scanned a real label — the branch needs a camera.

Carried: BF-57 needs **two phones, two accounts and a printer**; BF-75's ≥4.5:1 contrast; BF-52's
tile wrap; Q-467, Q-499, Q-538, Q-305 at S25 width, Q-477 across local midnight, BF-10, LB-5,
Q-328/Q-321/Q-486, Q-389, a TalkBack pass. **Q-315 needs a DESKTOP.**

## Claimed paths
None held.

## Gotchas worth carrying
- **`git fetch origin main` RE-SHALLOWS this clone** — the tell is `refusing to merge unrelated
  histories`. Fix with `git fetch --unshallow origin`. It happens **every** session.
- **Never check a gate through a pipe** — `pnpm check:rules | tail` exits with tail's status. This
  cost a push onto a RED check once; do not repeat it.
- **And do not chain the push onto the same line as the gate.** Running
  `pnpm check:rules > f; echo $?; git commit && git push` pushes whatever the gate said, because the
  push depends on the *commit's* status and not the gate's. Done here on 2026-09-01: the gate printed
  `RULES=1` and the branch went out anyway (a doc-size baseline, caught and fixed on the next commit).
  The pipe rule and this one are the same mistake wearing different clothes — **read the gate's
  result, then decide, in a separate call.**
- **A backlog conflict can be BOTH shapes at once.** BF-79's was my three additions plus main's
  deletion of a shipped entry, in one hunk. Read every heading in the span; do not apply a rule about
  "two deletions" to a hunk you have not read.
- **`awk`/`grep` on an entry id matches SUBSTRINGS and other entries' `Needs:` lines.** Anchor on
  `^### ` plus the id.
- **A PR can merge without its `projectOverview.md` status block** — #711 did. When you merge main
  and find the previous PR unrecorded, record it in yours; that is the only place it will happen.
- **An e2e spec that writes real rows must use unique-per-run names** and clean up in `afterAll`.
- **Before moving a user-visible affordance, `grep -rln` its OLD accessible name across `e2e/`** —
  `profile-group-labelling.spec.ts` asserted "Biological Sex" on the screen BF-79 moved it off. The
  assertion followed the control rather than being deleted with it.
- **`get_check_runs` and a run's `updated_at` lag by 20+ minutes; a job-log fetch 404s either way;
  the E2E artifact upload is `if: failure()`, so zero artifacts means passed OR still running.**
  Attempting the merge is the reliable read of the *required* checks.
- **E2E takes 15–40 min, is NOT required, and CATCHES REAL BUGS.** Never dismiss a red E2E without
  reading the log — but a failure reproduced on clean `main` is not your PR's.
- **A killed background run exits 143/144, which reads like a failure and is not** — a `pkill` in the
  same compound command will do it to your own suite.
- **`git add -A` with two items in flight sweeps the other into your commit.** Stage paths.
- **`docs/doc-size-baseline-history.md` is APPEND-ONLY** — a conflict there is two *additions*.
  **Rebuild `package.json`/`changelog.ts` from `git show origin/main:...`; never splice a hunk.**
- **Playwright needs `DATABASE_URL` prefixed in** — the session-start hook unsets it.
- **Never merge `main` or edit the tree while a local e2e run is live** — the tell is
  `Parsing ecmascript source code failed` with tests at **0ms**.
- **Piping a run through `grep` without `--line-buffered` hides its output until it exits.** Check
  `ps` before believing a hang.
- **`expect.poll` over a canvas is pathological** — ~5.5 M numbers over CDP per read. Bounded retry.
  But `expect.poll` over a **DB row** is exactly right, and beats sleeping past a debounce.
- **The chips and Body Battery card render on `/`, not `/session-select`.**
- **A `<select>` is not the only thing that reads as a dropdown, and there are none here** — More and
  its six sub-screens carry no slider and no `<select>` at all. The one `input[range]` in the tree is
  the accent-colour hue picker. Enumerate the controls by rendering the screen before believing a
  description of them.
- **`scripts/__tests__/dead-repo-methods.test.ts` writes a real `lib/zz-dead-repo-methods-probe.ts`
  and deletes it** (LB-44). Any concurrent test that walks `lib/` and reads every file can list it
  then fail `ENOENT` on it — surfacing in an unrelated file with a message that reads like a missing
  source. Both files pass alone. **A one-file suite failure naming a `zz-` path is this, not you.**
- **A backlog conflict where nothing was deleted needs no thought** — diff the `^### ` headings
  against `origin/main` (`comm -13`) after any merge; that answers "did I resurrect an entry" in one
  command, which is faster than reading the hunk and does not depend on getting the rule right.
