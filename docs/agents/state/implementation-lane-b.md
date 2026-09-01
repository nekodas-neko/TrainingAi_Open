# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-01 · **By:** the twentieth Lane B run · **Next ID:** `LB-43`

## Now
**Merged: Q-410 (#699), Q-187 (#700), Q-276 (#701), LB-34 (#702), LB-33 + LB-38 (#704), BF-84 lane
(#707), BF-85 (#711, v1.414.2). BF-79 is the open PR.** Nothing has been near a device.

**THE QUEUE HEAD WAS EXHAUSTED AND IS NOT ANY MORE — BF-79 was startable the whole time, and the
reason it looked otherwise is worth carrying.** The entry that `next-item.js` prints at position 1
is not always the one your grep finds: `grep -n 'BF-79 —'` matched **another entry's `Needs:` line**
40 lines earlier and I read that entry instead, concluding it was blocked on itself. **Anchor on
`^### ` when reading an entry**, never on a bare id — this is the same substring trap as `Q-51`
finding `Q-510`, in a shape the old note did not cover.

**An entry that says another entry blocks it may be the BLOCKER, not the blocked.** BF-82 carried
`Needs: BF-79`, so BF-79 went first and BF-82 inherits its placement decision. Read both directions
before believing a queue is stuck.

**⚠ `tsc` TYPECHECKS NOTHING UNDER `__tests__` — LB-37, and it changes what "TSC_OK" means.**
`tsconfig.json` excludes `**/__tests__/**`, so a spec can reference a type that does not exist and
nothing says so. **`e2e/` is NOT excluded** and is checked normally.

**A GUARD THAT MATCHES THE WHOLE FILE CANNOT TELL A WRITE FROM A READ.** BF-79's first source guard
asserted each profile column has one writer, and deleting the write still passed — the screen also
*seeds* the same field into form state. Fixed by extracting the `JSON.stringify({…})` / `patch({…})`
spans and matching only inside them. **This is the fifth guard in this repo that could not fail as
written**, and the previous four were all "it matched its own comment". Strip comments AND imports,
match the CALL, and mutate every assertion — six mutations here, all killed only after the fix.

**Custom Rules caught a real bug in my own new code, in code I had COPIED from a passing file.**
`goals-section.tsx` rendered a date with a bare `toLocaleDateString`; the copy in a new file failed
`check-timezone-rendering.js` immediately because the original was grandfathered and the copy was
not. **A pattern being present in the repo is not evidence it is allowed.** Both use
`formatDateDisplay` now and the grandfather list shrank by one in the same commit.

**Reading two components for a consolidation found three defects nobody was looking for** — LB-40
(a user with a password *cannot change it*: the form never renders the field the route requires),
LB-41 (a Weight Units toggle with no consumer anywhere), LB-42 (two columns for one weight goal,
with different readers — Lane A). Filed, not fixed, because two are out of the entry's scope and one
is a schema decision. **A consolidation is a free audit; write down what you see.**

**The check:rules count moved 65 → 66 → 67 in one session**, twice from other agents' merges. Never
hardcode it, never quote "pass" — quote `Ran N of N`.

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**` are Lane A**
  whatever the edit looks like — the **path**, not the nature of the edit. `lib/health/*` counts when
  an API route reaches it. `lib/walk/interval-plan.ts` does **not** — only `segment-stats.ts` is
  API-reached. `scripts/**` is the Orchestrator's — **except a shrink-only baseline line the check
  itself demands you remove**, which is part of your change, like a doc-size raise.
- **BF-79's decisions, so the More IA pass (BF-82) does not re-open them:** identity and body facts
  together on `app/more/details/`; weight and body fat **read-only** there (an input is a second
  write path into `body_metrics`); targets and activity level stay in Goals; Goals links to the
  fields it demands but can no longer edit.
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

Added this run:
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
