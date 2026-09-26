# Implementation Agent (B) — baton

**Updated:** 2026-09-26 · **Session title:** `🚧 Implementation Agent (B) 🟢` · **Next ID:** LB-162 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

Shipped 2026-09-26: **DV-12** (#1675), **RV-203 ① ③** (#1676), **LB-160** (#1677), **LB-161**;
eighteen more on 2026-09-25 — the journal entries are the list.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** READY was **0** at
2026-09-26 04:00, with nothing left to convert. The bottleneck is not this lane's: **~116 device
checks owed** (`--sittings`) and the owner questions. **Do not invent work — if READY is 0, say so
and stop.** Before saying it, check the parks are real — `BF-94` on `BF-61` LOOKS stale and is not
(BF-61 owes a device pass on the same swipe tray). Verifying that is what found LB-161: the two
`check-backlog-pointers` advisories, one of which was arguing against a correct entry.

## Blocked / owed

- **PARKED:** `LB-155` on **`LB-156`**; `RV-203` ② on **`LB-158`** (both Lane A); `header-row-width`
  (BF-139 + BF-96) on **`LB-157`**. **Owner (`Lane: O`, ungated, inline `Ask:`):** `LB-157`,
  `LB-152` (14 sites, not ~113), `LB-153`, `LB-159`. **Claimed paths: none.**

## Lessons that cost real time

- **DON'T TRUST THE ENTRY — VERIFY ITS PATHS, MECHANISM, AND WHETHER IT CHANGES WHAT RENDERS.**
  Twenty-four running. RV-203 ② asked to look a barcode up in a table that **has no barcode column**;
  the answer was a Lane A entry, not an implementation. **A change that alters what renders without
  fixing a disagreement is the OWNER'S:** `Lane: O` + `Ask: owner`, never `Gate: owner` (it parks).
- **A REGRESSION TEST CAN BE GREEN ON THE BUG IT GUARDS — CONTROL-RUN IT.** Stash the SOURCE, keep
  the spec, confirm it FAILS. Done for BF-61, DV-12 and RV-203; DV-12 also had me publish two wrong
  causes (a ResizeObserver that never fires on a tab switch, a "0 cost" that was a 1500 ms probe).
- **MEASURE A COUNT, NOT A TIME, IN `next dev`** — unminified + on-demand compile made a `resizeDelay`
  A/B unreadable; canvas `font`-setter calls gave 578 → 0. `pnpm start` cannot boot here (creds).
- **A POPULATION YOU GREPPED IS A FLOOR** — LB-160 was filed at 37 files and was **88** (the grep
  used one of five regexes). Write the CHECK, then count from it.
- **THE GATE RUNS AFTER THE BASE MERGE:** `check:rules` · `pnpm lint` (WARNINGS vs base: 811) ·
  `pnpm test` (with `DATABASE_URL`, or ~211 skip) · `pnpm build` · `tsc` · `check-test-typecheck` ·
  `check-doc-index-size` · `check-backlog-pointers` · `check-doc-links`. Two files conflict on nearly
  every PR: `doc-size-baseline-history.md` is append-only → keep BOTH, main's first; a `.size` →
  `--fix`. `docs/implementation-backlog.md` is UNRATCHETED (LA-129) — no `.size`. A doc-size-only
  remerge is NOT re-gated; one bringing source IS. **REBUILD `changelog.ts`/`package.json` FROM
  `origin/main`, NEVER SPLICE.**
- **CI: `curl -sS api.github.com/…/commits/<sha>/check-runs` WORKS UNAUTHENTICATED here**, the
  cheapest and least-laggy read. `get_check_runs` does not exist; `list_workflow_runs` IGNORES
  `branch`. Five required checks; **wait for advisory E2E only when the PR touches an e2e spec**
  (~34 min). Run a new spec locally first: `npx playwright test <file>` starts its own `pnpm dev`,
  which doubles as the dev-server pass. In CI a re-run means a PUSH, which restarts E2E too.
- **Read a gate's exit code DIRECTLY, never through a pipe** — a piped grep read as "clean" let
  `--fix` RAISE this file's baseline, and read a FAILING `check-test-typecheck` as 0. COMMIT before
  `stash`/`checkout`. vitest has NO DOM project. **ASSERT EVERY SCRIPTED `replace`, on LINE
  STARTS**, and note an unanchored alternation matches SHORTEST-first (`cup` before `cups`).
