# Implementation Agent (B) — baton

**Updated:** 2026-09-27 · **Session title:** `🚧 Implementation Agent (B) 🟢` · **Next ID:** LB-166 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

Shipped 2026-09-26: **DV-12** (#1675), **RV-203 ① ③** (#1676), **LB-160** (#1677), **LB-161** (#1685), **RV-207** (#1693, #1695), **LB-162** (#1700), **OR-162 per-switch half** (#1716), **DV-21 + a second dead channel** (#1720), **BF-61 narrowed and handed to DV** (#1722), **TN-85** (#1727), **BF-204 + BF-206** (#1730), **BF-205** (#1739), **BF-208 + the BF-206 revert** (#1741), **RV-208 part one** (#1743), **RV-209 steps 1–2** (#1748), **RV-202 ③ + LB-165** (#PR); eighteen more on 2026-09-25 — the journal is the list.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Next is **RV-210**…**RV-215**, review sweep 63. `RV-208` is PART-DONE and stays queued: its time-casing and `formatKg` halves are **Lane A's** (`app/api/day-timeline/route.ts`, `packages/shared/format/units.ts`), and its palette half is design work of its own. **`TN-82` is NOT simply next**: it removes the two scales from the morning sheet, which is an IA change to a daily screen, so it owes a mockup and a yes first. The queue sat at 0 for a day and a half before this; when it empties, say so and stop rather than inventing work.

## Blocked / owed

- **PARKED:** `LB-155` on **`LB-156`**; `RV-203` ② on **`LB-158`** (both Lane A); `header-row-width` (BF-139 + BF-96) on **`LB-157`**. **Owner (`Lane: O`, ungated):** `LB-157`, `LB-152` (14 sites, not ~113), `LB-153`, `LB-159`, **`LB-163`** (Home's Log tiles — a mockup is owed, and it is ungated BECAUSE the mockup does not exist yet; gate it once he has seen one). **Own follow-up:** `LB-162`, `TN-84`'s two copy deviations, **`LB-164`** (the Coach label, reverted and put to him), and **`OR-162`'s arrival half** — 180/320/43 font writes on ARRIVING at a tab, a different mechanism from the per-switch re-render and unmeasurable here. **Claimed paths: none.**

## Lessons that cost real time

- **TRACE A SHIPPED FIX TO THE PIXEL BEFORE BUILDING ON IT.** RV-202 ③ needed to label a rules prescription; tracing whether one is ever on screen found it never is (`LB-165`) — not stored, response body ignored by both callers, `workout-data` reads stored state. The entry's evidence (HTTP 200 where there was a 502) was a real measurement OF THE ROUTE, and the conclusion drawn from it was about a layer it did not test. That shape — a sound measurement, a conclusion one layer up — is the one to look for, because it reads as verified.
- **`check-component-size` REFUSES AN APPEND TO A HOTSPOT, AND THE RIGHT ANSWER IS THE EXTRACTION YOU ALREADY OWED.** 19 lines onto `workout-screen.tsx` was refused; moving `WorkoutDataSeed`/`freshExercises` out beside the new helper (all three ask the same question of the same payload) took net growth to ZERO. Do not trim comments to squeeze under — extract, then keep the reasoning.
- **AGEING A CACHE SEED IN THE HARNESS DOES NOT HOLD:** `readCacheSync` prefers `sessionStorage` but `cachedFetch` reads its own `localStorage` copy and calls `onData` with it, so ageing one leaves the other to overwrite — and `route.abort()` on the API did not stop a fresh payload either. **Serve the aged payload through `route.fulfill`** and `serviceWorkers: 'block'` (the SW's `/api/` branch answers before Playwright's router). Three attempts went into learning that.
- **A HUNDRED-SITE DEBT IS BETTER FROZEN PER-FILE SHRINK-ONLY THAN SWEPT BLIND.** RV-209 left 103 sub-floor literals across 24 files unconverted on purpose: a hundred class edits nothing verifies is a worse risk than the debt, and one wrong class on a card read mid-set is a real cost. A per-file shrink-only baseline with an EXACT-match assertion makes every future touch pay a little down and makes a stale number visible instead of silently tolerated. Ship the token and the sites the entry actually names; ratchet the rest.
- **`pnpm test` CAN EXIT 1 WITH ZERO TESTS FAILED** — `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` is a vitest WORKER-TEARDOWN race, reported as `Errors 1` beside `1105 passed`. It did not reproduce on a re-run of the file or of the suite. Read the failure COUNT, not the exit code alone, then re-run before touching anything — but never call a real red a flake on this precedent.
- **A SWEEP ENTRY IS NOT ONE LANE'S** — RV-208's five items split across Lane A (`app/api`, `packages/shared`), design work and copy. Ship the half you own COMPLETE and write who owns each of the rest onto the entry; do not half-do all five.
- **`public/cats/` IS BUILD OUTPUT** — the pen backdrops and every cat sprite come from `scripts/collection-art/scenes.mjs` through `build.mjs`, and `collection-sprites.test.ts` fails a hand-edited SVG.
- **A FIX JUSTIFIED BY A MISREAD OF THE OWNER GETS REVERTED, NOT KEPT BECAUSE IT SHIPPED.** #1730 labelled the Coach FAB on the reading that he had asked what it was; he meant the MOON in the pen backdrop (BF-208). The clearance half was measured from CSS and stands; the restyle was never requested, so it is reverted and filed as `LB-164`. Already-merged is not a reason to keep an unasked-for change to the screen he opens first — and a reading of what someone MEANT is a hypothesis, never to be listed beside a measured finding as though both were established.
- **DON'T TRUST THE ENTRY — VERIFY ITS PATHS, MECHANISM, AND WHETHER IT CHANGES WHAT RENDERS.**
  Twenty-seven running: "seven quick wins" was five (RV-207); one asked to query a column that does
  not exist (RV-203 ②). **A change that alters what renders is the OWNER'S:** `Lane: O` + `Ask:`.
  `Gate: owner` PARKS it — gate only once a mockup has been SHOWN; producing one is ungated work.
- **RENDER IT — `npx playwright test` drives the real app at 412 px dark.** It caught a two-clause
  sleep line running to THREE lines (TN-85) and proved the pen's six-cat spread (BF-204); neither
  was visible from source. A screenshot is not a press, though: `active:` and stuck-`hover:` still
  need the S25. **The seeded account is POOR** — no HR readings, cards off by default — so stub the
  route and set `ta_ss_cards` in an init script, and probe what it draws before promising a number.
- **A REGRESSION TEST CAN BE GREEN ON THE BUG IT GUARDS — CONTROL-RUN IT.** Stash the SOURCE, keep the spec, confirm it FAILS. A literal is the wrong thing to pin — `rv68`'s `setToggling(null)` broke on a sound refactor while the property it guards held (RV-207). Pin the property. **And make a FLAKE say so:** BF-205's drag spec failed one run in three in a way indistinguishable from the defect, until it asserted the pickup separately. Two causes, both worth knowing — `getByRole('button', {name})` matched 12 elements for 6 handles (Home's cards are `role="button"` and the name resolved onto both; use an attribute selector), and `@dnd-kit`'s `PointerSensor` activates instantly ONLY when the press lands on the handle, everything else getting a 200 ms delay and `preventActivation` on interactive elements — so re-measure and check `elementFromPoint` before pressing.
- **A `memo` WITHOUT A COMPARATOR SKIPS NOTHING HERE.** Every tab re-show bumps `epoch`, the screens refetch, and `setState` gets a value-identical NEW array. It is not a resize: `ResizeObserver` gives 5 callbacks during load and ZERO on a switch (OR-162, DV-12's spec).
- **WHEN A DEVICE DEFECT DOES NOT REPRODUCE HERE, THAT IS THE FINDING — DON'T SHIP A THIRD GUESS.** BF-61's window turned out to be wider than a CDP round-trip and the web passed 4 of 4; a CDP tap enters the renderer directly while a real tap goes through the compositor's hit test, so the harness cannot see what is left. Re-laned to `DV` with a three-step instrumented probe.
- **WRITE THE SOURCE GUARD, NOT JUST THE FIX — DV-21's found a SECOND dead notification channel the same minute**, and BF-206's guards every future FAB. Where a defect is invisible from every layer above it, the scan IS the sibling-surface sweep.
- **THE GATE RUNS AFTER THE BASE MERGE:** `check:rules` · `pnpm lint` (WARNINGS vs base: 828) · `pnpm test` (with `DATABASE_URL`, or ~211 skip) · `pnpm build` · `tsc` · `check-test-typecheck` · `check-doc-index-size` · `check-backlog-pointers` · `check-doc-links`. A doc-size-only remerge is NOT re-gated; one bringing source IS. On a conflict: a `.size` → `--fix` (it only RAISES; `--tighten` is the compaction sweep's, never yours); **`changelog.ts`/`package.json` REBUILD from `origin/main`, never splice**; a baseline REASON now goes in its own `docs/doc-size/history/<date>-<branch>.md` (LB-130), not the batched log.
- **CI: `curl -sS api.github.com/…/commits/<sha>/check-runs` WORKS UNAUTHENTICATED here**, the
  cheapest and least-laggy read. `get_check_runs` does not exist; `list_workflow_runs` IGNORES
  `branch`. Five required checks; **wait for advisory E2E only when the PR touches an e2e spec**
  (~34 min). Run a new spec locally first: `DATABASE_URL=… npx playwright test <file>` starts its
  own `pnpm dev`, which doubles as the dev-server pass; without the env it fails in `setup`.
  `enable_pr_auto_merge` right after opening; it refuses on an already-green PR.
- **Read a gate's exit code DIRECTLY, never through a pipe** — a piped `git merge` exit was read as
  0 and a branch got pushed mid-conflict. COMMIT before `stash`/`checkout`. vitest has NO DOM
  project. **ASSERT EVERY SCRIPTED `replace` — and write the file BEFORE the final assert**, or a
  raised assertion leaves conflict markers on disk that the next `git add -A` stages. An unanchored
  alternation matches SHORTEST-first (`cup` before `cups`).
