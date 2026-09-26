# Implementation Agent (B) — baton

**Updated:** 2026-09-26 · **Session title:** `🚧 Implementation Agent (B) 🟢` · **Next ID:** LB-164 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

Shipped 2026-09-26: **DV-12** (#1675), **RV-203 ① ③** (#1676), **LB-160** (#1677), **LB-161** (#1685), **RV-207** (#1693, #1695), **LB-162** (#1700), **OR-162 per-switch half** (#1716), **DV-21 + a second dead channel** (#1720), **BF-61 narrowed and handed to DV** (#1722), **TN-85** (#1727), **BF-204 + BF-206**; eighteen more on 2026-09-25 — the journal is the list.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** BugFix and review sweep 63 refilled the queue on 2026-09-26: **BF-205** (the Home "Reorder sections" button has no drag at all — `@dnd-kit` is a dependency and `components/config/sortable-row.tsx` is the pattern to copy), then **RV-208**…**RV-215**. **`TN-82` is NOT simply next**: it removes the two scales from the morning sheet, which is an IA change to a daily screen, so it owes a mockup and a yes first. The queue sat at 0 for a day and a half before this; when it empties, say so and stop rather than inventing work.

## Blocked / owed

- **PARKED:** `LB-155` on **`LB-156`**; `RV-203` ② on **`LB-158`** (both Lane A); `header-row-width` (BF-139 + BF-96) on **`LB-157`**. **Owner (`Lane: O`, ungated):** `LB-157`, `LB-152` (14 sites, not ~113), `LB-153`, `LB-159`, **`LB-163`** (Home's Log tiles — a mockup is owed, and it is ungated BECAUSE the mockup does not exist yet; gate it once he has seen one). **Own follow-up:** `LB-162`, `TN-84`'s two copy deviations, and **`OR-162`'s arrival half** — 180/320/43 font writes on ARRIVING at a tab, a different mechanism from the per-switch re-render and unmeasurable here. **Claimed paths: none.**

## Lessons that cost real time

- **DON'T TRUST THE ENTRY — VERIFY ITS PATHS, MECHANISM, AND WHETHER IT CHANGES WHAT RENDERS.**
  Twenty-seven running: "seven quick wins" was five (RV-207); one asked to query a column that does
  not exist (RV-203 ②). **A change that alters what renders is the OWNER'S:** `Lane: O` + `Ask:`.
  `Gate: owner` PARKS it — gate only once a mockup has been SHOWN; producing one is ungated work.
- **RENDER IT — `npx playwright test` drives the real app at 412 px dark.** It caught a two-clause
  sleep line running to THREE lines (TN-85) and proved the pen's six-cat spread (BF-204); neither
  was visible from source. A screenshot is not a press, though: `active:` and stuck-`hover:` still
  need the S25. **The seeded account is POOR** — no HR readings, cards off by default — so stub the
  route and set `ta_ss_cards` in an init script, and probe what it draws before promising a number.
- **A REGRESSION TEST CAN BE GREEN ON THE BUG IT GUARDS — CONTROL-RUN IT.** Stash the SOURCE, keep
  the spec, confirm it FAILS. A literal is the wrong thing to pin — `rv68`'s `setToggling(null)`
  broke on a sound refactor while the property it guards held (RV-207). Pin the property.
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
