# Implementation Agent (B) — baton

**Updated:** 2026-09-25 · **Session title:** `🚧 Implementation Agent (B) 🟢` · **Next ID:** LB-156 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

Shipped 2026-09-25: LB-148, RV-178, RV-122, RV-99's defect, RV-101, LB-149, RV-102, RV-67 (closed),
RV-79, RV-68, LB-155. RV-101 and RV-68 owe only their device looks (`Verify: device`, in `--sittings`).

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** RV-99 heads the lane but
is blocked on LB-152; then LB-154, LB-155's ~20 conversions, `motion-polish`, BF-177 (plan STALE).
**The owner's top priority is tab/page switch speed**, so `DV-12` heads it once the phone is free.
**A BLOCKED ENTRY NEEDS A FIELD, NOT A PARAGRAPH.** **RV-117/118/119 are `Lane: O` — leave them.**

## Blocked / owed

- **LB-152** (hex→token restyle) and **LB-153** (chart palette merge) are the owner's — `Lane: O`,
  ungated, inline `Ask:`. A question filed there COMES BACK; write the brief, then build. Device
  checks are DV's to RUN, mine to RECORD. **Claimed paths: none.**

## Lessons that cost real time

- **DON'T TRUST THE ENTRY — VERIFY ITS PATHS, MECHANISM, AND WHETHER IT CHANGES WHAT RENDERS.**
  Fifteen running were wrong: RV-122's fix could not work; RV-99 was a restyle sold as a refactor;
  RV-101's contrast used the wrong background and its fix had nowhere to go; LB-149's hypothesis had
  no lever (`workers: 1` already); RV-102 called two tables "identical" (13 keys vs 10) and
  mis-assigned its lane. **A change that alters what renders without fixing a disagreement is the
  OWNER'S:** `Lane: O` + `Ask: owner — <summary>`, never `Gate: owner`.
- **A BACKLOG EDIT IS A CODE CHANGE** — queue tooling runs `next-item.js` against the live backlog, so
  a docs-only diff turned #1623 red. Never hand-pick affected tests; run `pnpm test`.
- **THE GATE RUNS AFTER THE BASE MERGE:** `check:rules` · `pnpm lint` (compare the WARNING COUNT to
  base) · `pnpm test` · `pnpm build` · `tsc`. Doc-size is BASE-RELATIVE.
- **THE DOC-SIZE FILES CONFLICT ON EVERY PR** and main moves every ~8 min, so a 12-min gate loses the
  race (#1623 refused twice). History is append-only (keep BOTH, main's first); the `.size` is a real
  disagreement (`--fix`). Script it; do NOT re-gate a doc-size-only remerge.
- **REBUILD `changelog.ts`/`package.json` FROM `origin/main`, NEVER SPLICE** — `package.json` does
  NOT conflict when both sides pick the same version. Collided four times in one day.
- **CI READS:** `list_workflow_runs` IGNORES `branch`; `get_check_runs` does not exist; `get_status`
  is the legacy API; `get_job_logs failed_only`+`tail_lines` can return ONLY the Postgres dump
  (LB-54) — fetch `logs_url` and grep locally. The ruleset is ACTIVE: trying the merge names the blocker.
- **CONTROL-RUN every new test against `origin/main`; MUTATION-TEST the guard.** Stash only SOURCE
  files — `git stash -u` takes the new test and proves nothing.
- **FIVE scanner traps bit in one day, each a different mechanism, each producing an authoritative
  wrong number:** a regex cannot balance parens; requiring `(` right after the name misses
  `fn<T>(…)`; `{ method }` shorthand has no colon; a same-line grep misses multi-line calls; **a
  generic can contain parens** (`import('…')`), so skip type args by balancing ANGLE brackets. Also:
  a scanner matches ITSELF and the COMMENTS explaining the fix; `ls-files a b -- '*.ts'` UNIONS
  pathspecs (filter in JS); grep the TRACKED tree or `.next/` answers. **Two scanners agreeing is not
  corroboration when they share a blind spot** — that is how 199 was published as 191, "verified".
- **Read a gate's exit code DIRECTLY**, never through a pipe. COMMIT before `stash`/`checkout`. `tsc`
  checks neither auth-gated pages nor tests (`check-test-typecheck.js`); vitest has no DOM project,
  so a component guard is a source scan in a `.ts`.
- **⚠ ASSERT EVERY SCRIPTED `str.replace`** — this file sat three PRs stale because one no-oped.