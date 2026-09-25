# Implementation Agent (B) — baton

**Updated:** 2026-09-25 · **Session title:** `🚧 Implementation Agent (B) 🟢` · **Next ID:** LB-157 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

Shipped 2026-09-25: LB-148, RV-178, RV-122, RV-101, LB-149, RV-102, RV-67 (closed), RV-79, RV-68,
LB-155 (enforcement + 3 conversions), RV-74, BF-177, RV-99's 2nd defect, LB-154. RV-101/RV-68/RV-74 owe only device looks (`Verify: device`, in `--sittings`).

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** `back-gesture-sitting`
(BF-165 + DV-2) heads it, then `header-row-width` (BF-139 + BF-96) — both FAILED on device, so both
are open work, not verification debt. **The owner's top priority is tab/page switch speed.**
**RV-117/118/119 are `Lane: O` — leave them.**

## Blocked / owed

- **LB-155 is PARKED on `LB-156`** (Lane A: register five cache keys in the groups whose writes change
  them). Its remaining 10 conversions cannot be done from here without breaching the cache rule or the
  lane split. **LB-152** (hex→token restyle, which RV-99 shrank from ~113 sites to **14**) and **LB-153**
  (chart palette) are the owner's — `Lane: O`, ungated, inline `Ask:`.

## Lessons that cost real time

- **DON'T TRUST THE ENTRY — VERIFY ITS PATHS, MECHANISM, AND WHETHER IT CHANGES WHAT RENDERS.** Now
  **twenty-one** running: wrong defect, wrong hook, wrong count, wrong lane, a fix with nowhere to go.
  **A change that alters what renders without fixing a disagreement is the OWNER'S:** `Lane: O` +
  `Ask: owner`, never `Gate: owner` (which parks it).
- **CONVERTING A READ TO `cachedFetch` IS NOT MECHANICAL, AND THREE SHAPES MUST NOT BE:** a
  read-after-write, an offline-first hydration read feeding `applyDelta`, and a delta BASELINE (a cached
  pre-workout XP makes the gain read 0). A new key also needs a group entry in LANE A's `cache-groups.ts`.
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
- **CONTROL-RUN every new test against `origin/main` in a `git worktree`; MUTATION-TEST the guard.**
  `git checkout -- <file>` restores from the INDEX, which never held your change — it silently reverted a
  whole CSS half once. Stash only SOURCE files.
- **FIVE scanner traps, each producing an authoritative wrong number:** a regex cannot balance parens;
  requiring `(` after the name misses `fn<T>(…)`; `{ method }` shorthand has no colon; a same-line grep
  misses multi-line calls; a generic can contain parens (`import('…')`). A scanner also matches ITSELF and
  the COMMENTS about the fix. **Two agreeing scanners are not corroboration when they share a blind spot**
  — a co-render scan is not a shared-MEANING scan: its biggest cluster was a token used as identity.
- **Read a gate's exit code DIRECTLY**, never through `| tail`. COMMIT before `stash`/`checkout`. `tsc`
  checks neither auth-gated pages nor tests; vitest has NO DOM project, so a component guard is a source
  scan in a `.ts` and React behaviour is not unit-testable here at all. **⚠ ASSERT EVERY SCRIPTED
  `str.replace`** — this file sat three PRs stale because one no-oped.
