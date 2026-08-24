# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly, emoji included. That
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread.

**Updated:** 2026-08-24 · **By:** the eighth Lane B run · **Next ID:** `LB-8`

## Now
**Open: the Q-486 PR.** Everything else this run merged — #353, #355, #358, #359, #361.

**Q-486 touches `lib/local-store/dead-letter-signal.ts`, a Lane A path — claimed here.** Its backlog
entry assigns Lane B and names that file as the mechanism; the four sites it fixes are in
`components/workout-screen.tsx`. Release the claim when the branch merges.

## This run (2026-08-23/24) — each has a journal entry in `docs/overview/entries/`

- **Merged and journalled, no state owed:** Q-362b (#296), Q-421 (#300), BF-4's Lane B half (#311),
  Q-326 (#313), LB-1 (#316), Q-415/Q-417 (#320), Q-323's display half (#326), Q-387's Lane B half
  (#330), Q-406 (#331), Q-418's screen half (#332). Read their entries in `docs/overview/entries/`
  rather than re-deriving any of it. **Two carry a deliberate NOT-done:** `day-overlay-sheet.tsx`
  survives for **LB-3**, and Q-406's last two call sites wait on Q-395a's missing drawings.
- **LB-6** (#361) — sixteen writes revalidated around their push, not after it. The entry said six;
  its finder looked only at the six lines ABOVE each call. Custom Rules is **55**.
- **Q-486** — the four swallowed `queueMutation` calls warn and toast. **The entry's fix shape was
  wrong and not followed:** the badge counts outbox ROWS the Data & Sync card retries or discards,
  and a throw leaves no row. **Its Known-Issues row and backlog `Keep:` both stay** — the failure
  needs a broken local SQLite on a device, so the fix is read, not observed.
- **BF-6** (#355) — the finished-logging control moves above End of Day. **Zero presses in seven
  weeks**, and the calibration excludes an unmarked day rather than treating it as light.
- **BF-8** (#353) — a deload session says so on both workout surfaces. Owner-confirmed: he trained
  one believing it was full. Both asked `isDeloadActive` (the PHASE) rather than today's session.
- **Q-409's Lane B half** (#346), **Q-327** (#338) — a recipe link becomes a meal (unstated yield is
  ASKED about, not assumed one plate); the meal photo tile Q-396's column was waiting for.
- **Q-398** (#333) — plan meals become saved meals. **It uncovered a live outage:** five
  `app/api/nutrition/meal-plan*` routes validated an unassigned `raw`, so the whole meal-plan write
  surface answered 400 to every request. Fixed there, with `scripts/check-json-body-parsed.js`.

## Next
`node scripts/next-item.js --lane B`, and **re-verify the premise first** — most entries taken this
run had one that had drifted. The tool says what is startable, never whether it is true.

**⛔ BLOCKED: Q-395's drawings are not in the repository.** `unit-options.png`, which Q-395a names as
its reference, is nowhere in the tree — `docs/design/` holds cardio, score-row and AI-coach mockups
and nothing for nutrition. **Do not take Q-395a/b/c**, and do not convert Q-406's last two call
sites, until they are committed under `docs/design/`. Raised with the owner 2026-08-23.

Non-blocked candidates: **Q-407**, **Q-486**, **Q-321**, **Q-420**. LB-3 sits low, as its own
placement says.

## Do not re-litigate
- **`lib/coach/**` is Lane A** — settled against the import trace, not the path list.
- **`floor(pct/10)` is the right RPE prefill** (Q-423, refuted on production data).
- **`DayOverlaySheet` is unreachable** — measured twice; do not fix bugs inside it. **LB-3** decides
  its three affordances and deletes the file.
- **Q-354: a spec must TAP, not click**, and **`toBeVisible()` does not mean in-viewport**. Both read
  exactly like a dead control. `scrollIntoViewIfNeeded()` is not always enough either — for a control
  near the end of a long page it stops with the box **under the fixed bottom nav**, and the tap lands
  on another tab. `el.scrollIntoView({ block: 'center' })` then `page.touchscreen.tap()`.
- **Seeded user missing only `date_of_birth`.** Still standing: `FactorBar` is not colour-only;
  absent scores are handled on all 14 surfaces; Q-309 refuted as a user-facing bug, Q-354 real and
  parked; `radiogroup` beat `group`+`aria-pressed`; `coach-content.tsx`'s `scrollIntoView` is right.

## Owed (device / physical)
- A **test print** of the meal label, black band first (Q-389) — 0.49–0.66 mm per module.
- The meal-label **camera scan**, the Web Share hand-off, and the two new fonts (Q-389).
- A **TalkBack pass** over More → Goals and More → Edit Profile (Q-261, Q-350).
- Home with the **"Accent ring"** style (Q-281) — the band word is 7.5 px.
- A **drain run** confirming `/admin/oura-ble` holds still while the log streams (Q-532).
- **Q-450's device path** — the E2E run took the web fallback, not SQLite + outbox.
- **Q-421's MET card**, **BF-4's `getPhoto` bound**, **Q-326's reassign dialog**.
- **LB-1's four controls**, **#320's two cards**, **Q-398's copy**, **Q-327's camera branch** — all
  take the web fallback here, so every local-store mirror and outbox mutation in them, and the
  native camera prompt, are verified by reading only.
- **Q-418's whole point** — every number on that screen needs a Polar H10, and the sandbox has none.

## Claimed paths
None held. This run released `packages/shared/src/nutrition/{calorie-balance,save-plan-meal,
log-plan-meal}.ts`, one line of `lib/cache-groups.ts`, and the five meal-plan API routes above.

## Gotchas worth carrying
- **This clone is SHALLOW and `git fetch origin main` RE-SHALLOWS it** — `origin/main` then reads as
  **one** commit and the merge dies with *"refusing to merge unrelated histories"*. Nothing is wrong
  with the repo. `git fetch --unshallow origin` before every merge; `test -f .git/shallow` checks it.
- **A fixture dated `now() - N hours` is a UTC instant and the app windows by the USER's local day.**
  Between 00:00 and 02:00 Brisbane it lands on the previous day and the spec fails on CI while
  passing locally. Anchor to **midday on the resolved local day**. Cost `one-calorie-budget` a run.
- **`scripts/local-db/seed.sql` dates its workouts RELATIVE to the run day**, one every second day,
  so a spec pinned to a recent fixed date eventually collides with a seeded row on a fresh CI
  database — as `getByText('Bench Press') resolved to 2 elements`. Pin a year back.
- **The aged local seed bites `goal-invalidation.spec.ts`** — it needs **today's** `body_metrics` row
  to carry steps. It fails identically on clean `main`; top the row up rather than debugging a diff.
- **`get_check_runs` lags; the merge attempt is the reliable check.** Check the date on resume too.
- **A backgrounded `pnpm dev` dies with its task** — `setsid nohup pnpm dev > log 2>&1 &` survives;
  `E2E_BASE_URL=http://localhost:3000` points Playwright at it. **And a long-lived one DEGRADES**:
  `meal-label.spec.ts` failed repeatedly, on this branch and on commits before it, until the dev
  server was restarted — then passed first try. Restart it before believing a heavy spec's failure.
- **`projectOverview.md` and this baton sit ON their ratchet baselines, and RAISING one costs you the
  merge race.** **Trim; do not raise** — or move a fully-resolved Known Issue to the archive, which
  is what the wrap-up rule wants anyway.
- **On a doc conflict, ask whether the two sides are the SAME entry rewritten or two independent
  ones.** "Keep both" duplicated a Q-387 bullet and a Q-406 entry when they were the former.
- **The sandbox serves the MET table as SYNTHETIC fixtures**, so any activity's energy estimate is
  **0** here. Seed a session plus a `workout_hr_stats` row with `avg_bpm` for a real earned figure.
- **Mutation-check every guard**, and check what a passing assertion would ACCEPT.
- **Two `page.route` rules, both from #359 and both now in `e2e/README.md`:** never `expect` inside
  the handler (a throw skips `fulfill` and breaks the request you are asserting about), and stubbing
  an `/api/` route needs `serviceWorkers: 'block'` — the SW re-issues those and Playwright never
  sees them.
