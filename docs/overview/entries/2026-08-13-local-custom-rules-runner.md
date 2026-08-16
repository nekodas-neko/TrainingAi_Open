# 2026-08-13 — the local custom-rules gate runs all 31 steps, and prints the count (Q-206)

**Branch:** `claude/trainingai-backlog-v0abea`

`pnpm check:rules` (`scripts/run-custom-rules.js`) parses `.github/workflows/ci.yml` with `js-yaml`,
takes the job whose `name` is `Custom Rules`, and executes every one of its 31 run-steps under
`bash -e` — the same shell GitHub uses for `run:` on `ubuntu-latest`. It ends with `Ran 31 of 31
Custom Rules steps.`, so an under-count is a number on screen rather than a silent subset. `pnpm
ci:local` now calls it in place of the three check scripts it used to name.

## The entry's premise was wrong in both directions, and the fix is unchanged

Q-206 was filed as "4 of 35". Measured against `main` today:

| | count |
|---|---|
| run-steps in the `Custom Rules` job | **31** |
| of those, invoking a `scripts/*.js` | **20** |
| inline grep steps, no script | **11** |
| `scripts/check-*.js` on disk | **20** — and all 20 are wired into the job |
| of the 31, run by the old `pnpm ci:local` | **3** |

So the glob the entry blamed was never the weak gate — it runs 20 of 31 (65%). The weak gate was
`pnpm ci:local`, which ran 3 (9.7%), and that is where the entry's "~11%" came from. Twenty
`check-*.js` files existed on 2026-08-12 when the entry was written, so the "four such scripts"
count was wrong on the day.

Neither correction changes the fix: the 11 inline steps are the ones no glob can reach, and they
cover UTC date slicing, hardcoded session names, safe-area stacking, local-SQLite PRAGMAs, nested
buttons, `JSON.parse` of LLM output and hand-rolled `invalidateCache` — the last of which shipped
through a green local gate on #1279.

The entry's warning about regex-scraping `run:` blocks is why this reads the YAML with a parser and
prints its count. The `--list` flag exists so the test can pin the enumeration without paying for a
second execution.

## Verified

Full suite green — 461 files (367 passed, 94 skipped), 3,797 tests (3,261 passed, 536 skipped), zero
failures. `tsc --noEmit` clean, lint 0 errors / 119 pre-existing warnings. `pnpm check:rules` runs
31 of 31 and passes.

**Mutation-verified, all four:**

- Wrote `lib/__mutation-probe.ts` with `new Date().toISOString().slice(0, 10)` → step 1 *No UTC date
  slicing* FAILs, exit 1. Removed → clean.
- Wrote `components/__probe/probe.tsx` calling `invalidateCache([...])` directly → step 11 *No
  hand-rolled invalidateCache outside lib/cache-groups.ts* FAILs, exit 1. Removed → clean. This is
  the #1279 bug class, and it is one of the 11 the old gate could not see.
- Narrowed the runner's step filter to script steps only (20 of 31) → the enumeration test fails.
- Dropped `check:rules` out of `ci:local` → the gate-wiring test fails.

**Not exercised:** nothing on the device, and nothing needed to be — this touches no route, no
component, no local-store path and no native code. `pnpm dev` was not run for the same reason: the
diff is a script, a test, two `package.json` script lines, a devDependency and docs. No version bump
or changelog entry, since nothing here is user-visible.

**One judgement call worth naming:** `js-yaml` is a new devDependency (`^5.2.3`, already in the
lockfile transitively). The alternative was hand-parsing the workflow, which is precisely the trap
the backlog entry documented.
