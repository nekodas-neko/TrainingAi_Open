# Implementation Agent (B) — baton

**Updated:** 2026-09-25 · **Session title:** `🚧 Implementation Agent (B) 🟢` · **Next ID:** LB-158 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

Shipped 2026-09-25: LB-148, RV-178, RV-122, RV-101, LB-149, RV-102, RV-67 (closed), RV-79, RV-68,
LB-155 (enforcement + 3 conversions), RV-74, BF-177, RV-99's 2nd defect, LB-154, **BF-165 + DV-2**, **LB-157 (filed, not built)**. RV-101/RV-68/RV-74/BF-165/DV-2 owe only device looks (`Verify: device`, in `--sittings`).

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** READY is down to 3 and the
top two are the `nutrition-ui-uplift` and remaining FAILED-on-device batches. **The owner's top
priority is tab/page switch speed.** **RV-117/118/119 are `Lane: O` — leave them.**

## Blocked / owed

- **PARKED: LB-155 on `LB-156`** (Lane A: five cache keys need group entries); **`header-row-width`
  (BF-139 + BF-96) on `LB-157`** — measured, the row is 224.0 px and the date gets **7.4 px** in daylight,
  so no shrink-only fix exists. **LB-152** (which RV-99 shrank from ~113 sites to **14**) and **LB-153**
  are the owner's too — all `Lane: O`, ungated, inline `Ask:`.

## Lessons that cost real time

- **DON'T TRUST THE ENTRY — VERIFY ITS PATHS, MECHANISM, AND WHETHER IT CHANGES WHAT RENDERS.** Now
  **twenty-one** running: wrong defect, wrong hook, wrong count, wrong lane, a fix with nowhere to go.
  **A change that alters what renders without fixing a disagreement is the OWNER'S:** `Lane: O` +
  `Ask: owner`, never `Gate: owner` (which parks it).
- **CONVERTING A READ TO `cachedFetch` IS NOT MECHANICAL, AND THREE SHAPES MUST NOT BE:** a
  read-after-write, an offline-first hydration read feeding `applyDelta`, and a delta BASELINE (a cached
  pre-workout XP makes the gain read 0). A new key also needs a group entry in LANE A's `cache-groups.ts`.
- **RE-READ YOUR OWN DIFF AGAINST THE CODE IT TALKS TO, not just against the entry.** DV-2's `go(-2)`
  was wrong on a path no test here can reach — the back handler raises the leave prompt ON TOP of an open
  sheet — because **releasing a history entry does not REMOVE it**. Two nav-probe traps that read as dead
  controls: a `touchscreen.tap` below the fold (`tapHitTested`), and a `next dev` cold route's hung RSC.
- **THE GATE RUNS AFTER THE BASE MERGE:** `check:rules` · `pnpm lint` (WARNING COUNT vs base: 811) ·
  `pnpm test` (with `DATABASE_URL`, or ~211 skip — never hand-pick, a docs-only backlog diff turned #1623
  red) · `pnpm build` · `tsc` · `check-test-typecheck`. Doc-size is BASE-RELATIVE; history is append-only
  (keep BOTH, main's first), the `.size` is a real disagreement (`--fix`), a doc-size-only remerge is NOT
  re-gated. **REBUILD `changelog.ts`/`package.json` FROM `origin/main`, NEVER SPLICE.**
- **CI: `curl -sS api.github.com/…/commits/<sha>/check-runs` WORKS UNAUTHENTICATED here**, the cheapest
  and least-laggy read. `list_workflow_runs` IGNORES `branch`; `get_check_runs` does not exist;
  `get_job_logs failed_only`+`tail_lines` can return ONLY the Postgres dump. **Claimed paths: none.**
- **CONTROL-RUN every new test against `origin/main`; MUTATION-TEST the guard.** A worktree with
  symlinked `node_modules` breaks Next's resolution, so for an e2e control `git stash push -- <source
  files only>`, keeping the spec. `git checkout -- <file>` restores from the INDEX and silently reverted a
  whole CSS half once.
- **A FIGURE FROM AN UNPINNED SCANNER IS A GUESS WITH A NUMBER ATTACHED.** Six traps so far: a regex
  cannot balance parens or angle brackets; `{ method }` shorthand has no colon; a same-line grep misses
  multi-line calls; a scanner matches ITSELF and the COMMENTS about the fix; and **two agreeing scanners
  are not corroboration when they share a blind spot** — a co-render scan is not a shared-MEANING scan.
- **Read a gate's exit code DIRECTLY, never through a pipe** — a piped grep read as "clean" let `--fix`
  RAISE this shrink-only file's baseline. COMMIT before `stash`/`checkout`. vitest has NO DOM project, so
  a component guard is a source scan and React is not testable here. **ASSERT EVERY SCRIPTED `replace`.**
