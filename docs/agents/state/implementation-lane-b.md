# Implementation Agent (B) — baton

**Updated:** 2026-09-25 · **Session title:** `🚧 Implementation Agent (B) 🟢` · **Next ID:** LB-158 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

**READY is 0** — everything is parked, owner-gated or owed a device look. Shipped 2026-09-25: LB-148,
RV-178, RV-122, RV-101, LB-149, RV-102, RV-67, RV-79, RV-68, LB-155, RV-74, BF-177, RV-99's 2nd defect,
LB-154, BF-165 + DV-2, LB-157 (filed), the mid-entry-heading check, BF-61. Six owe only device looks.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** With READY at 0 the
bottleneck is elsewhere: **116 device checks owed** (`--sittings` groups them) and three owner questions.
Do not invent work — if READY is still 0, say so and stop. **`DV-12` is the owner's stated #1 and is the
one to argue out of its gate**; the 2026-09-25 source measurement and the reason a chart-only fix may not
move his number are ON THAT ENTRY, not here. **RV-117/118/119 are `Lane: O` — leave them.**

## Blocked / owed

- **PARKED:** `LB-155` on **`LB-156`** (Lane A: five cache keys need group entries); `header-row-width`
  (BF-139 + BF-96) on **`LB-157`** — the row is 224.0 px and the date gets **7.4 px** in daylight, so no
  shrink-only fix exists. **Owner:** `LB-157`, `LB-152` (which RV-99 shrank from ~113 sites to **14**),
  `LB-153` — all `Lane: O`, ungated, inline `Ask:`. **Claimed paths: none.**

## Lessons that cost real time

- **DON'T TRUST THE ENTRY — VERIFY ITS PATHS, MECHANISM, AND WHETHER IT CHANGES WHAT RENDERS.** Twenty-two
  running: wrong defect, wrong hook, wrong count, wrong lane, a fix with nowhere to go. **A change that
  alters what renders without fixing a disagreement is the OWNER'S:** `Lane: O` + `Ask: owner`, never
  `Gate: owner` (it parks). A stale `Gate: device` is the mirror — argue it out, do not work around it.
- **A REGRESSION TEST CAN BE GREEN ON THE BUG IT GUARDS.** BF-61 shipped with a mechanism and a spec and
  failed on the device twice — the spec tapped after the row had rested open, the half already fixed.
  **Control-run the EXISTING tests against unfixed source too** (stash SOURCE, keep the spec), and where
  the real window is under one CDP round-trip assert the PROPERTY rather than racing it.
- **CONVERTING A READ TO `cachedFetch` IS NOT MECHANICAL; THREE SHAPES MUST NOT BE:** a read-after-write,
  an offline-first hydration read feeding `applyDelta`, and a delta BASELINE. A new key also needs a group
  entry in LANE A's `cache-groups.ts` — which parks most of LB-155.
- **RE-READ YOUR OWN DIFF AGAINST THE CODE IT TALKS TO.** DV-2's `go(-2)` was wrong on a path no test here
  can reach: **releasing a history entry does not REMOVE it**. Two nav probes that read as dead controls —
  a `touchscreen.tap` below the fold (`tapHitTested`), and a `next dev` cold route's hung RSC.
- **THE GATE RUNS AFTER THE BASE MERGE:** `check:rules` · `pnpm lint` (WARNINGS vs base: 811) · `pnpm test`
  (with `DATABASE_URL`, or ~211 skip — never hand-pick) · `pnpm build` · `tsc` · `check-test-typecheck`.
  **`/tmp/claude-0/resolve-docsize.sh`** resolves the two files that conflict on nearly every PR (history
  is append-only → keep BOTH, main's first; `.size` → `--fix`) and refuses anything else. A doc-size-only
  remerge is NOT re-gated; one bringing source IS. **REBUILD `changelog.ts`/`package.json` FROM
  `origin/main`, NEVER SPLICE.**
- **CI: `curl -sS api.github.com/…/commits/<sha>/check-runs` WORKS UNAUTHENTICATED here**, the cheapest and
  least-laggy read. `get_check_runs` does not exist; `list_workflow_runs` IGNORES `branch`. Five required
  checks; **wait for advisory E2E only when the PR touches an e2e spec** (~34 min).
- **Read a gate's exit code DIRECTLY, never through a pipe** — a piped grep read as "clean" let `--fix`
  RAISE this shrink-only file's baseline. COMMIT before `stash`/`checkout`; `git checkout -- <f>` restores
  from the INDEX. vitest has NO DOM project. **ASSERT EVERY SCRIPTED `replace`, on LINE STARTS.**
