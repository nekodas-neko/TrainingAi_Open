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

- **LB-155 is PARKED on `LB-156`** (Lane A: five cache keys need registering in the groups whose writes
  change them). **`header-row-width` (BF-139 + BF-96) is PARKED on `LB-157`** — measured: the row is
  224.0 px, the chips take 200–209 in daylight, the date gets **7.4 px**, and no format fits, so there is
  no shrink-only fix left. **LB-152** (which RV-99 shrank from ~113 sites to **14**) and **LB-153** are
  the owner's too — all `Lane: O`, ungated, inline `Ask:`.

## Lessons that cost real time

- **DON'T TRUST THE ENTRY — VERIFY ITS PATHS, MECHANISM, AND WHETHER IT CHANGES WHAT RENDERS.** Now
  **twenty-one** running: wrong defect, wrong hook, wrong count, wrong lane, a fix with nowhere to go.
  **A change that alters what renders without fixing a disagreement is the OWNER'S:** `Lane: O` +
  `Ask: owner`, never `Gate: owner` (which parks it).
- **CONVERTING A READ TO `cachedFetch` IS NOT MECHANICAL, AND THREE SHAPES MUST NOT BE:** a
  read-after-write, an offline-first hydration read feeding `applyDelta`, and a delta BASELINE (a cached
  pre-workout XP makes the gain read 0). A new key also needs a group entry in LANE A's `cache-groups.ts`.
- **RE-READ YOUR OWN DIFF AGAINST THE CODE IT TALKS TO, not just against the entry.** DV-2's `go(-2)`
  was wrong on a reachable path and no test here could reach it: the back handler raises the leave
  prompt ON TOP of an open sheet. **Releasing a history entry does not REMOVE it** — it only stops the
  surface popping it — so the distance is `1 + <pushed surfaces>`, counted, never the stack depth.
  A `touchscreen.tap` below the fold hits nothing and reads as a dead control (`tapHitTested`), and a
  `next dev` cold route hangs its RSC fetch the same way — warm the destination before any nav probe.
- **THE GATE RUNS AFTER THE BASE MERGE:** `check:rules` · `pnpm lint` (compare the WARNING COUNT to base:
  811) · `pnpm test` (with `DATABASE_URL` set, or ~211 files skip — and NEVER hand-pick, since a
  docs-only backlog diff turned #1623 red) · `pnpm build` · `tsc` · `check-test-typecheck`. Doc-size is BASE-RELATIVE, and its
  files conflict on every PR while main moves every ~8 min: history is append-only (keep BOTH, main's
  first), the `.size` is a real disagreement (`--fix`), and a doc-size-only remerge is NOT re-gated.
  **REBUILD `changelog.ts`/`package.json` FROM `origin/main`, NEVER SPLICE.**
- **CI: `curl -sS api.github.com/…/commits/<sha>/check-runs` WORKS UNAUTHENTICATED here** and is the
  cheapest, least-laggy read there is. `list_workflow_runs` IGNORES `branch`; `get_check_runs` does not
  exist; `get_job_logs failed_only`+`tail_lines` can return ONLY the Postgres dump (LB-54). Five required
  checks; E2E `in_progress` is NOT a blocker. **Claimed paths: none.**
- **CONTROL-RUN every new test against `origin/main`; MUTATION-TEST the guard.** A worktree with
  symlinked `node_modules` breaks Next's resolution, so for an e2e control `git stash push -- <source
  files only>`, keeping the spec. `git checkout -- <file>` restores from the INDEX and silently reverted a
  whole CSS half once.
- **A FIGURE FROM AN UNPINNED SCANNER IS A GUESS WITH A NUMBER ATTACHED.** Six traps so far: a regex
  cannot balance parens or angle brackets; `{ method }` shorthand has no colon; a same-line grep misses
  multi-line calls; a scanner matches ITSELF and the COMMENTS about the fix; and **two agreeing scanners
  are not corroboration when they share a blind spot** — a co-render scan is not a shared-MEANING scan.
- **Read a gate's exit code DIRECTLY**, never through `| tail`. COMMIT before `stash`/`checkout`. `tsc`
  checks neither auth-gated pages nor tests; vitest has NO DOM project, so a component guard is a source
  scan in a `.ts` and React behaviour is not unit-testable here at all. **⚠ ASSERT EVERY SCRIPTED
  `str.replace`** — this file sat three PRs stale because one no-oped.
