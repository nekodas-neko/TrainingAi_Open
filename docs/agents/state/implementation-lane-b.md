# Implementation Agent (B) — baton

**Updated:** 2026-09-25 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-154 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

Shipped 2026-09-25: LB-148, RV-178, RV-122, RV-99's one defect (#1615), RV-101 (#1621), LB-149
(#1623), RV-102 (#1627). RV-101 owes only its device look (`Verify: device`, `workouts` sitting).

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** RV-99 heads the lane but
is blocked on LB-152; expect RV-67, RV-68, RV-79. **The owner's top priority is tab/page switch
speed**, so `DV-12` heads it once the phone is free. **A BLOCKED ENTRY NEEDS A FIELD, NOT A
PARAGRAPH** — it must LEAD its bullet. **RV-117/118/119 are `Lane: O`.** **BF-177's plan is STALE.**

## Blocked / owed

- **LB-152** (hex→token restyle) and **LB-153** (chart palette merge) are the owner's — `Lane: O`,
  ungated, inline `Ask:`. A question filed there COMES BACK; write the brief, then build. Device
  checks are DV's to RUN, mine to RECORD.

## Claimed paths — none.

## Lessons that cost real time

- **DON'T TRUST THE ENTRY — VERIFY ITS PATHS, MECHANISM, AND WHETHER IT CHANGES WHAT RENDERS.**
  Fifteen running were wrong: RV-122's fix could not work; RV-99 was a restyle sold as a refactor;
  RV-101's contrast used the wrong background and its fix had nowhere to go; LB-149's hypothesis had
  no lever (`workers: 1` already); RV-102 called two tables "identical" (13 keys vs 10) and
  mis-assigned its lane. **A change that alters what renders without fixing a disagreement is the
  OWNER'S:** `Lane: O` + `Ask: owner — <summary>`, never `Gate: owner`, which parks it.
- **A BACKLOG EDIT IS A CODE CHANGE** — queue tooling runs `next-item.js` against the live backlog, so
  a docs-only diff turned #1623 red. Never hand-pick affected tests; run `pnpm test`. Its cap is on
  ROWS, so >10 READY with batches is not truncation.
- **THE GATE RUNS AFTER THE BASE MERGE:** `check:rules` · `pnpm lint` (repo-wide; compare the WARNING
  COUNT to base) · `pnpm test` · `pnpm build` · `tsc`. Doc-size is BASE-RELATIVE.
- **THE DOC-SIZE FILES CONFLICT ON EVERY PR** and main moves every ~8 min, so a 12-min gate loses the
  race (#1623 refused twice). History is append-only (keep BOTH, main's first); the `.size` is a real
  disagreement (`--fix`). Script it; do NOT re-gate a doc-size-only remerge.
- **REBUILD `changelog.ts`/`package.json` FROM `origin/main`, NEVER SPLICE** — `package.json` does NOT
  conflict when both sides pick the same version. Collided four times in one day.
- **CI READS:** `list_workflow_runs` IGNORES `branch`; `get_check_runs` does not exist; `get_status`
  is the legacy API; `get_job_logs failed_only`+`tail_lines` can return ONLY the Postgres dump
  (LB-54) — fetch `logs_url` and grep locally. The ruleset is ACTIVE, so trying the merge is a safe
  probe that names the blocker.
- **CONTROL-RUN every new test against `origin/main` and MUTATION-TEST the guard** — stash only the
  SOURCE files; `git stash -u` takes the new test and proves nothing.
- **A scanner matches ITSELF and the COMMENTS explaining the fix**; `ls-files a b -- '*.ts'` UNIONS
  pathspecs (filter in JS); a regex cannot balance parens; grep the TRACKED tree or `.next/` answers.
- **Read a gate's exit code DIRECTLY**, never through a pipe. COMMIT before `stash`/`checkout`. `tsc`
  checks neither auth-gated pages nor tests — run `check-test-typecheck.js`; vitest has no DOM
  project, so a component guard is a source scan in a `.ts`.
- **⚠ ASSERT EVERY SCRIPTED `str.replace`** — this file sat three PRs stale because one no-oped.